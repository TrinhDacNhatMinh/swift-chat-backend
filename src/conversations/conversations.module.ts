import { Module, forwardRef } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { GroupMemberService } from './group-member.service';
import { ConversationsController } from './conversations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagesModule } from '../messages/messages.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [PrismaModule, forwardRef(() => MessagesModule), RedisModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, GroupMemberService],
  exports: [ConversationsService, GroupMemberService],
})
export class ConversationsModule {}
