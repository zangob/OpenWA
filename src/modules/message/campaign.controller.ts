import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto, SendCampaignTestDto, StartCampaignDto } from './dto/campaign.dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { MessageBatch } from './entities/message-batch.entity';

@ApiTags('campaigns')
@Controller('sessions/:sessionId/campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  private view(batch: MessageBatch) {
    return {
      batchId: batch.batchId,
      sessionId: batch.sessionId,
      name: batch.name,
      status: batch.status,
      message: batch.messageTemplate,
      recipients: batch.recipients,
      progress: batch.progress,
      options: batch.options,
      currentIndex: batch.currentIndex,
      test: {
        chatId: batch.testChatId,
        messageId: batch.testMessageId,
        sentAt: batch.testSentAt,
      },
      results: batch.results,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      createdAt: batch.createdAt,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a campaign draft (validates recipients, no sending yet)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 201, description: 'Draft created with resolved/invalid recipient counts' })
  async create(@Param('sessionId') sessionId: string, @Body() dto: CreateCampaignDto) {
    const { batch, invalid } = await this.campaignService.createDraft(sessionId, dto);
    return {
      ...this.view(batch),
      validRecipients: batch.progress.total,
      invalidRecipients: invalid.length,
      invalid: invalid.slice(0, 20),
    };
  }

  @Get()
  @ApiOperation({ summary: 'List campaigns for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  async list(@Param('sessionId') sessionId: string) {
    const batches = await this.campaignService.listCampaigns(sessionId);
    return batches.map(b => this.view(b));
  }

  @Get(':batchId')
  @ApiOperation({ summary: 'Get a campaign (status, progress, per-recipient results)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async get(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    return this.view(await this.campaignService.getCampaign(sessionId, batchId));
  }

  @Post(':batchId/test')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send one test message to the operator's own number" })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async test(
    @Param('sessionId') sessionId: string,
    @Param('batchId') batchId: string,
    @Body() dto: SendCampaignTestDto,
  ) {
    return this.view(await this.campaignService.sendTest(sessionId, batchId, dto));
  }

  @Post(':batchId/start')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start the campaign (requires a sent test). Sends 1-by-1 with the given delay.' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async start(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string, @Body() dto: StartCampaignDto) {
    return this.view(await this.campaignService.start(sessionId, batchId, dto));
  }

  @Post(':batchId/pause')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a running campaign (resumable)' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async pause(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    return this.view(await this.campaignService.pause(sessionId, batchId));
  }

  @Post(':batchId/resume')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused campaign' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async resume(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    return this.view(await this.campaignService.resume(sessionId, batchId));
  }

  @Post(':batchId/cancel')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a campaign' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiParam({ name: 'batchId', description: 'Campaign batch ID' })
  async cancel(@Param('sessionId') sessionId: string, @Param('batchId') batchId: string) {
    return this.view(await this.campaignService.cancel(sessionId, batchId));
  }
}
