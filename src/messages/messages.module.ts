import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema, MessageArchive, MessageArchiveSchema } from './schemas/message.schema';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessageArchivingService } from './message-archiving.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: MessageArchive.name, schema: MessageArchiveSchema },
    ]),
    ConversationsModule,
    ConfigModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessageArchivingService],
  exports: [MessagesService],
})
export class MessagesModule {}
