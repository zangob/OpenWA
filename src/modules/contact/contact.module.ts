import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { ContactDbService } from './contact-db.service';
import { Contact } from './entities/contact.entity';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([Contact], 'data'), SessionModule],
  controllers: [ContactController],
  providers: [ContactService, ContactDbService],
  exports: [ContactService, ContactDbService],
})
export class ContactModule {}
