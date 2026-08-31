import { Module, DynamicModule, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageService } from './message.service';
import { MessageSendService } from './message-send.service';
import { BulkMessageService } from './bulk-message.service';
import { BulkUploadService } from './bulk-upload.service';
import { CampaignService } from './campaign.service';
import { MessageTypeBackfillService } from './message-type-backfill.service';
import { PendingMessageReaperService } from './pending-message-reaper.service';
import { MessageController } from './message.controller';
import { CampaignController } from './campaign.controller';
import { SessionModule } from '../session/session.module';
import { TemplateModule } from '../template/template.module';
import { ChatMediaModule } from '../chat-media/chat-media.module';
import { Message } from './entities/message.entity';
import { Session } from '../session/entities/session.entity';
import { SendPacingService } from './send-pacing.service';
import { MessageBatch } from './entities/message-batch.entity';
import { PLUGIN_MESSAGE_PORT } from '../../core/plugins/plugin-host-ports';

// The campaign runtime (BullMQ processor + queue) only loads when the queue is
// enabled — mirrors WebhookModule so injecting the queue elsewhere stays optional.
const queueModules: Array<Type | DynamicModule> = [];
const queueProviders: Type[] = [];
if (process.env.QUEUE_ENABLED === 'true') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const queueModule = require('../queue/queue.module') as { QueueModule: Type };
  queueModules.push(queueModule.QueueModule);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const processor = require('../queue/processors/campaign.processor') as { CampaignProcessor: Type };
  queueProviders.push(processor.CampaignProcessor);
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, MessageBatch, Session], 'data'),
    SessionModule,
    TemplateModule,
    ChatMediaModule,
    ...queueModules,
  ],
  controllers: [MessageController, CampaignController],
  providers: [
    MessageService,
    MessageSendService,
    BulkMessageService,
    BulkUploadService,
    CampaignService,
    MessageTypeBackfillService,
    PendingMessageReaperService,
    SendPacingService,
    // Binds the core-owned plugin capability port to this module's service. The plugin runtime
    // resolves the token lazily via ModuleRef (PluginHostServices), which keeps its provider cycle
    // broken; this adapter is how core reaches the service without importing it.
    // An alias, not a factory, so lifecycle hooks are not dispatched twice on the same instance.
    { provide: PLUGIN_MESSAGE_PORT, useExisting: MessageService },
    ...queueProviders,
  ],
  exports: [MessageService, BulkMessageService, BulkUploadService, CampaignService, SendPacingService],
})
export class MessageModule {}
