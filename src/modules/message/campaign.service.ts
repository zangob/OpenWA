import {
  Injectable,
  Logger,
  Optional,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { MessageBatch, BatchStatus, BatchProgress } from './entities/message-batch.entity';
import { CreateCampaignDto, SendCampaignTestDto, StartCampaignDto } from './dto/campaign.dto';
import { SessionService } from '../session/session.service';
import { EventsGateway } from '../events/events.gateway';
import { normalizePhone } from './utils/phone.util';
import { sendCampaignMessage, CampaignTemplate } from './utils/campaign-message.util';
import { QUEUE_NAMES, CampaignJobData } from '../queue/queue-names';

export interface InvalidRecipient {
  input: string;
  reason: string;
}

/** Build the BullMQ job id for a given campaign tick (deterministic → dedup). */
export function campaignJobId(batchId: string, index: number): string {
  return `campaign-${batchId}-${index}`;
}

/** Shared job options so the service (first tick) and processor (next ticks) match. */
export function campaignJobOptions(batchId: string, index: number, delayMs: number) {
  return {
    jobId: campaignJobId(batchId, index),
    delay: Math.max(0, delayMs),
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: true,
    removeOnFail: true,
  };
}

@Injectable()
export class CampaignService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CampaignService.name);
  private readonly queueEnabled: boolean;

  constructor(
    @InjectRepository(MessageBatch, 'data')
    private readonly batchRepository: Repository<MessageBatch>,
    private readonly sessionService: SessionService,
    private readonly eventsGateway: EventsGateway,
    private readonly configService: ConfigService,
    @Optional()
    @InjectQueue(QUEUE_NAMES.CAMPAIGN)
    private readonly campaignQueue?: Queue<CampaignJobData>,
  ) {
    this.queueEnabled = configService.get<boolean>('queue.enabled', false);
  }

  /**
   * On boot, re-enqueue a tick for any campaign left in PROCESSING (e.g. the
   * server crashed between a send and enqueuing the next tick). Deterministic
   * job ids dedupe against any delayed job that already survived in Redis.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.queueEnabled || !this.campaignQueue) return;
    try {
      const running = await this.batchRepository.find({
        where: { kind: 'campaign', status: BatchStatus.PROCESSING },
      });
      for (const batch of running) {
        await this.campaignQueue.add(
          'tick',
          { batchId: batch.batchId, index: batch.currentIndex },
          campaignJobOptions(batch.batchId, batch.currentIndex, 0),
        );
        this.logger.log(`Resumed campaign ${batch.batchId} at index ${batch.currentIndex}`);
      }
    } catch (err) {
      this.logger.error(`Campaign resume-on-boot failed: ${String(err)}`);
    }
  }

  private ensureQueue(): Queue<CampaignJobData> {
    if (!this.queueEnabled || !this.campaignQueue) {
      throw new ServiceUnavailableException(
        'Campaigns require the Redis-backed queue. Start Redis and set QUEUE_ENABLED=true.',
      );
    }
    return this.campaignQueue;
  }

  private requireEngine(sessionId: string) {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException(`Session '${sessionId}' is not active. Start the session first.`);
    }
    return engine;
  }

  // ── Draft creation ────────────────────────────────────────────────────────

  async createDraft(
    sessionId: string,
    dto: CreateCampaignDto,
  ): Promise<{ batch: MessageBatch; invalid: InvalidRecipient[] }> {
    const engine = this.requireEngine(sessionId);

    // Validate the message template up front.
    const template = dto.message;
    if (template.type === 'text' && !template.text?.trim()) {
      throw new BadRequestException('Text message requires non-empty text');
    }
    if (template.type === 'image' && !template.image?.base64 && !template.image?.url) {
      throw new BadRequestException('Image message requires an image (base64 or url)');
    }

    const invalid: InvalidRecipient[] = [];
    const seen = new Set<string>();
    const recipients: NonNullable<MessageBatch['recipients']> = [];

    // Numbers
    for (const entry of dto.recipients.numbers ?? []) {
      const norm = normalizePhone(entry.phone, dto.defaultCountryCode);
      if (!norm.valid || !norm.chatId) {
        invalid.push({ input: `${entry.name} <${entry.phone}>`, reason: norm.error || 'Invalid number' });
        continue;
      }
      if (seen.has(norm.chatId)) continue;
      seen.add(norm.chatId);
      recipients.push({ chatId: norm.chatId, name: entry.name, type: 'number' });
    }

    // Groups — validate against the session's actual groups where possible.
    const groupIds = dto.recipients.groups ?? [];
    if (groupIds.length > 0) {
      let groupMap = new Map<string, string>();
      try {
        const groups = await engine.getGroups();
        groupMap = new Map(groups.map(g => [g.id, g.name]));
      } catch (err) {
        this.logger.warn(`Could not fetch groups for validation: ${String(err)}`);
      }
      for (const gid of groupIds) {
        const chatId = gid.includes('@') ? gid : `${gid}@g.us`;
        if (!chatId.endsWith('@g.us')) {
          invalid.push({ input: gid, reason: 'Not a valid group id' });
          continue;
        }
        if (seen.has(chatId)) continue;
        seen.add(chatId);
        recipients.push({ chatId, name: groupMap.get(chatId) || chatId, type: 'group' });
      }
    }

    if (recipients.length === 0) {
      throw new BadRequestException(
        `No valid recipients. ${invalid.length} invalid entr${invalid.length === 1 ? 'y' : 'ies'}.`,
      );
    }

    const batchId = `campaign_${randomUUID().split('-')[0]}`;
    const progress: BatchProgress = {
      total: recipients.length,
      sent: 0,
      failed: 0,
      pending: recipients.length,
      cancelled: 0,
    };

    const batch = this.batchRepository.create({
      batchId,
      sessionId,
      kind: 'campaign',
      name: dto.name ?? null,
      status: BatchStatus.DRAFT,
      messageTemplate: template,
      recipients,
      messages: [], // legacy column is non-null; campaigns use `recipients`
      options: {
        delayBetweenMessages: 30000,
        randomizeDelay: true,
        stopOnError: false,
        defaultCountryCode: dto.defaultCountryCode,
      },
      progress,
      results: [],
      currentIndex: 0,
      testChatId: null,
      testMessageId: null,
      testSentAt: null,
      startedAt: null,
      completedAt: null,
    });

    await this.batchRepository.save(batch);
    this.logger.log(`Created campaign draft ${batchId}: ${recipients.length} recipients, ${invalid.length} invalid`);
    return { batch, invalid };
  }

  // ── Test send ─────────────────────────────────────────────────────────────

  async sendTest(sessionId: string, batchId: string, dto: SendCampaignTestDto): Promise<MessageBatch> {
    const batch = await this.getCampaign(sessionId, batchId);
    if (batch.status !== BatchStatus.DRAFT && batch.status !== BatchStatus.TEST_SENT) {
      throw new BadRequestException(`Cannot send a test while campaign is '${batch.status}'`);
    }
    const engine = this.requireEngine(sessionId);

    const norm = normalizePhone(dto.phone, batch.options?.defaultCountryCode);
    if (!norm.valid || !norm.chatId) {
      throw new BadRequestException(`Invalid test number: ${norm.error || 'unknown'}`);
    }

    const result = await sendCampaignMessage(engine, batch.messageTemplate as CampaignTemplate, norm.chatId, {
      name: 'Test',
    });

    batch.testChatId = norm.chatId;
    batch.testMessageId = result.id;
    batch.testSentAt = new Date();
    batch.status = BatchStatus.TEST_SENT;
    await this.batchRepository.save(batch);
    this.emitStatus(batch);
    this.logger.log(`Campaign ${batchId}: test sent to ${norm.chatId}`);
    return batch;
  }

  // ── Start ─────────────────────────────────────────────────────────────────

  async start(sessionId: string, batchId: string, dto: StartCampaignDto): Promise<MessageBatch> {
    const queue = this.ensureQueue();
    const batch = await this.getCampaign(sessionId, batchId);

    if (batch.status !== BatchStatus.TEST_SENT) {
      throw new BadRequestException('Send a test message and confirm it before starting the campaign');
    }
    this.requireEngine(sessionId);

    batch.options = {
      ...batch.options,
      delayBetweenMessages: dto.delaySeconds * 1000,
      randomizeDelay: dto.randomizeDelay ?? true,
    };
    batch.status = BatchStatus.PROCESSING;
    batch.startedAt = new Date();
    batch.currentIndex = 0;
    await this.batchRepository.save(batch);

    await queue.add('tick', { batchId, index: 0 }, campaignJobOptions(batchId, 0, 0));
    this.emitStatus(batch);
    this.logger.log(`Started campaign ${batchId}: ${batch.progress.total} recipients @ ${dto.delaySeconds}s`);
    return batch;
  }

  // ── Pause / resume / cancel ────────────────────────────────────────────────

  async pause(sessionId: string, batchId: string): Promise<MessageBatch> {
    const batch = await this.getCampaign(sessionId, batchId);
    if (batch.status !== BatchStatus.PROCESSING) {
      throw new BadRequestException(`Only a running campaign can be paused (current: '${batch.status}')`);
    }
    batch.status = BatchStatus.PAUSED;
    await this.batchRepository.save(batch);
    this.emitStatus(batch);
    return batch;
  }

  async resume(sessionId: string, batchId: string): Promise<MessageBatch> {
    const queue = this.ensureQueue();
    const batch = await this.getCampaign(sessionId, batchId);
    if (batch.status !== BatchStatus.PAUSED) {
      throw new BadRequestException(`Only a paused campaign can be resumed (current: '${batch.status}')`);
    }
    this.requireEngine(sessionId);
    batch.status = BatchStatus.PROCESSING;
    await this.batchRepository.save(batch);
    await queue.add('tick', { batchId, index: batch.currentIndex }, campaignJobOptions(batchId, batch.currentIndex, 0));
    this.emitStatus(batch);
    return batch;
  }

  async cancel(sessionId: string, batchId: string): Promise<MessageBatch> {
    const batch = await this.getCampaign(sessionId, batchId);
    if (
      batch.status === BatchStatus.COMPLETED ||
      batch.status === BatchStatus.CANCELLED ||
      batch.status === BatchStatus.FAILED
    ) {
      throw new BadRequestException(`Campaign is already '${batch.status}'`);
    }
    batch.status = BatchStatus.CANCELLED;
    batch.progress.cancelled = batch.progress.pending;
    batch.progress.pending = 0;
    batch.completedAt = new Date();
    await this.batchRepository.save(batch);
    this.emitStatus(batch);
    return batch;
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getCampaign(sessionId: string, batchId: string): Promise<MessageBatch> {
    const batch = await this.batchRepository.findOne({ where: { batchId, sessionId, kind: 'campaign' } });
    if (!batch) {
      throw new NotFoundException(`Campaign '${batchId}' not found`);
    }
    return batch;
  }

  async listCampaigns(sessionId: string): Promise<MessageBatch[]> {
    return this.batchRepository.find({
      where: { sessionId, kind: 'campaign' },
      order: { createdAt: 'DESC' },
    });
  }

  private emitStatus(batch: MessageBatch): void {
    this.eventsGateway.emitBatchStatus(batch.sessionId, {
      batchId: batch.batchId,
      status: batch.status,
      progress: batch.progress,
    });
  }
}
