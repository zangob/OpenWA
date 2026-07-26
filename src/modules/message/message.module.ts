import { Module, DynamicModule, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageService } from './message.service';
import { BulkMessageService } from './bulk-message.service';
import { BulkUploadService } from './bulk-upload.service';
import { CampaignService } from './campaign.service';
import { MessageController } from './message.controller';
import { CampaignController } from './campaign.controller';
import { SessionModule } from '../session/session.module';
import { Message } from './entities/message.entity';
import { MessageBatch } from './entities/message-batch.entity';

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
  imports: [TypeOrmModule.forFeature([Message, MessageBatch], 'data'), SessionModule, ...queueModules],
  controllers: [MessageController, CampaignController],
  providers: [MessageService, BulkMessageService, BulkUploadService, CampaignService, ...queueProviders],
  exports: [MessageService, BulkMessageService, BulkUploadService, CampaignService],
})
export class MessageModule {}
