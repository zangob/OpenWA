import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Chat } from './entities/chat.entity';
import { Message } from './entities/message.entity';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([Chat, Message], 'data'), SessionModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
