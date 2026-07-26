import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createLogger } from '../../../common/services/logger.service';
import { QUEUE_NAMES, CampaignJobData } from '../queue-names';
import {
  MessageBatch,
  BatchStatus,
  BatchMessageStatus,
  BatchMessageResult,
} from '../../message/entities/message-batch.entity';
import { SessionService } from '../../session/session.service';
import { EventsGateway } from '../../events/events.gateway';
import { sendCampaignMessage, CampaignTemplate } from '../../message/utils/campaign-message.util';
import { campaignJobOptions } from '../../message/campaign.service';

// How long to wait before re-checking when the session/engine is temporarily
// unavailable. The campaign parks itself instead of failing — this is what lets
// a multi-day run survive session reconnects.
const ENGINE_WAIT_MS = 30_000;

@Processor(QUEUE_NAMES.CAMPAIGN)
export class CampaignProcessor extends WorkerHost {
  private readonly logger = createLogger('CampaignProcessor');

  constructor(
    @InjectRepository(MessageBatch, 'data')
    private readonly batchRepository: Repository<MessageBatch>,
    private readonly sessionService: SessionService,
    private readonly eventsGateway: EventsGateway,
    @InjectQueue(QUEUE_NAMES.CAMPAIGN)
    private readonly queue: Queue<CampaignJobData>,
  ) {
    super();
  }

  async process(job: Job<CampaignJobData>): Promise<void> {
    const { batchId, index } = job.data;

    const batch = await this.batchRepository.findOne({ where: { batchId, kind: 'campaign' } });
    if (!batch) {
      this.logger.warn(`Campaign ${batchId} not found; dropping tick`);
      return;
    }

    // Only a running campaign advances. Paused/cancelled/finished → stop the chain.
    if (batch.status !== BatchStatus.PROCESSING) {
      return;
    }

    // Duplicate/stale tick for an index we already sent → ignore.
    if (index < batch.currentIndex) {
      return;
    }

    const i = batch.currentIndex;
    const recipient = batch.recipients?.[i];
    if (!recipient) {
      // Nothing left to send — finalize.
      await this.finalize(batchId);
      return;
    }

    // Wait (park) if the session engine is not ready yet.
    const engine = this.sessionService.getEngine(batch.sessionId);
    if (!engine) {
      this.logger.warn(`Campaign ${batchId}: session not ready, retrying index ${i} in ${ENGINE_WAIT_MS}ms`);
      await this.queue.add(
        'tick',
        { batchId, index: i },
        // Unique job id so this "wait" retry is not deduped against the current job.
        { ...campaignJobOptions(batchId, i, ENGINE_WAIT_MS), jobId: `campaign-${batchId}-${i}-wait-${Date.now()}` },
      );
      return;
    }

    // Send the message for the current recipient.
    const result: BatchMessageResult = { chatId: recipient.chatId, status: BatchMessageStatus.PENDING };
    let success = false;
    try {
      const sent = await sendCampaignMessage(engine, batch.messageTemplate as CampaignTemplate, recipient.chatId, {
        name: recipient.name,
      });
      result.status = BatchMessageStatus.SENT;
      result.messageId = sent.id;
      result.sentAt = new Date();
      success = true;
    } catch (err) {
      result.status = BatchMessageStatus.FAILED;
      result.error = { code: 'SEND_FAILED', message: err instanceof Error ? err.message : String(err) };
      this.logger.warn(`Campaign ${batchId}: failed to send index ${i} to ${recipient.chatId}: ${String(err)}`);
    }

    // Re-load fresh to honor any pause/cancel that landed during the network send.
    const fresh = await this.batchRepository.findOne({ where: { batchId, kind: 'campaign' } });
    if (!fresh) return;

    // Someone else already advanced this index (dup delivery) → do nothing.
    if (fresh.currentIndex !== i) {
      return;
    }

    fresh.results = [...(fresh.results || []), result];
    if (success) {
      fresh.progress.sent += 1;
    } else {
      fresh.progress.failed += 1;
    }
    fresh.progress.pending = Math.max(0, fresh.progress.pending - 1);
    fresh.currentIndex = i + 1;

    const terminal =
      fresh.status === BatchStatus.CANCELLED ||
      fresh.status === BatchStatus.COMPLETED ||
      fresh.status === BatchStatus.FAILED;

    const hasMore = fresh.currentIndex < fresh.progress.total;

    if (!terminal && fresh.status === BatchStatus.PROCESSING && !hasMore) {
      fresh.status =
        fresh.progress.sent === 0 && fresh.progress.failed > 0 ? BatchStatus.FAILED : BatchStatus.COMPLETED;
      fresh.completedAt = new Date();
    }

    await this.batchRepository.save(fresh);

    this.eventsGateway.emitBatchProgress(fresh.sessionId, {
      batchId: fresh.batchId,
      status: fresh.status,
      progress: fresh.progress,
      currentIndex: fresh.currentIndex,
      last: { chatId: result.chatId, status: result.status },
    });

    // Continue the chain only while running and more recipients remain.
    if (fresh.status === BatchStatus.PROCESSING && hasMore) {
      const delay = this.computeDelay(fresh);
      await this.queue.add(
        'tick',
        { batchId, index: fresh.currentIndex },
        campaignJobOptions(batchId, fresh.currentIndex, delay),
      );
    } else if (fresh.status === BatchStatus.COMPLETED || fresh.status === BatchStatus.FAILED) {
      this.eventsGateway.emitBatchStatus(fresh.sessionId, {
        batchId: fresh.batchId,
        status: fresh.status,
        progress: fresh.progress,
      });
      this.logger.log(
        `Campaign ${batchId} ${fresh.status}: ${fresh.progress.sent} sent, ${fresh.progress.failed} failed`,
      );
    }
  }

  private computeDelay(batch: MessageBatch): number {
    const base = batch.options?.delayBetweenMessages ?? 30000;
    if (batch.options?.randomizeDelay) {
      return base + Math.floor(Math.random() * 3000);
    }
    return base;
  }

  /** Mark a campaign finished when there are no more recipients to send. */
  private async finalize(batchId: string): Promise<void> {
    const batch = await this.batchRepository.findOne({ where: { batchId, kind: 'campaign' } });
    if (!batch || batch.status !== BatchStatus.PROCESSING) return;
    batch.status = batch.progress.sent === 0 && batch.progress.failed > 0 ? BatchStatus.FAILED : BatchStatus.COMPLETED;
    batch.completedAt = new Date();
    await this.batchRepository.save(batch);
    this.eventsGateway.emitBatchStatus(batch.sessionId, {
      batchId: batch.batchId,
      status: batch.status,
      progress: batch.progress,
    });
  }
}
