import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from '../auth/guards/ws-jwt.guard';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { FriendsModule } from '../friends/friends.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    MessagesModule,
    FriendsModule,
    UserModule,
  ],
  providers: [ChatGateway, ChatService, WsJwtGuard],
})
export class ChatModule {}
