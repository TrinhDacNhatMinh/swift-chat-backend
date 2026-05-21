import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { WsException } from '@nestjs/websockets';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { FriendsService } from '../friends/friends.service';
import { FcmService } from '../fcm/fcm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { ReactMessageDto } from './dto/react-message.dto';

const PRESENCE_BROADCAST_BATCH_SIZE = 100;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private server: Server;

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly friendsService: FriendsService,
    private readonly fcmService: FcmService,
    private readonly notificationsService: NotificationsService,
  ) {}

  setServer(server: Server) {
    this.server = server;
    this.notificationsService.setServer(server);
    this.conversationsService.setServer(server);
  }

  async joinRoom(userId: string, conversationId: string) {
    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      conversationId,
    );
    if (!isParticipant) {
      throw new WsException('You are not a participant of this conversation');
    }
    return true;
  }

  async sendMessage(userId: string, senderName: string, dto: CreateMessageDto) {
    const conversationId = dto.conversationId;

    const conversationValid =
      await this.conversationsService.conversationExists(conversationId);
    if (!conversationValid) {
      throw new WsException('Conversation not found');
    }

    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      conversationId,
    );
    if (!isParticipant) {
      throw new WsException('Permission denied to send message');
    }

    const savedMessage = await this.messagesService.create(userId, dto);
    await this.conversationsService.updateTimestamp(conversationId);

    // Fire-and-forget push for offline participants
    this.fcmService
      .sendPushToOfflineParticipants(
        conversationId,
        userId,
        senderName,
        dto.content,
      )
      .catch((err) => this.logger.error('FCM push failed:', err));

    return savedMessage;
  }

  async deleteMessage(userId: string, dto: DeleteMessageDto) {
    // Check conversation membership before touching the message
    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      dto.conversationId,
    );
    if (!isParticipant) {
      throw new WsException(
        'Permission denied: you are not a member of this conversation',
      );
    }

    const deleted = await this.messagesService.softDelete(
      dto.messageId,
      userId,
    );
    if (!deleted) {
      throw new WsException('Message not found or you are not the sender');
    }
    return deleted;
  }

  async editMessage(userId: string, dto: EditMessageDto) {
    // Check conversation membership before touching the message
    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      dto.conversationId,
    );
    if (!isParticipant) {
      throw new WsException(
        'Permission denied: you are not a member of this conversation',
      );
    }

    const edited = await this.messagesService.editMessage(
      dto.messageId,
      userId,
      dto.content,
    );
    if (!edited) {
      throw new WsException(
        'Message not found, already deleted, or you are not the sender',
      );
    }
    return edited;
  }

  async markRead(userId: string, dto: MarkReadDto) {
    await this.conversationsService.markAsRead(
      userId,
      dto.conversationId,
      dto.messageId,
    );
  }

  async reactMessage(userId: string, dto: ReactMessageDto) {
    const isParticipant = await this.conversationsService.isParticipant(
      userId,
      dto.conversationId,
    );
    if (!isParticipant) {
      throw new WsException('Permission denied to react to this message');
    }

    const message = await this.messagesService.toggleReaction(
      dto.messageId,
      userId,
      dto.emoji,
    );

    if (!message) {
      throw new WsException('Message not found');
    }

    return message;
  }

  async broadcastPresenceToFriends(
    userId: string,
    status: 'online' | 'offline',
  ) {
    try {
      const payload = { userId, status, timestamp: new Date().toISOString() };
      let skip = 0;

      // Iterate in batches to avoid loading all friends into memory at once
      while (true) {
        const friendIds = await this.friendsService.getFriendIdsBatch(
          userId,
          skip,
          PRESENCE_BROADCAST_BATCH_SIZE,
        );

        if (friendIds.length === 0) break;

        friendIds.forEach((friendId) => {
          this.server.to(`user:${friendId}`).emit('presence:status', payload);
        });

        if (friendIds.length < PRESENCE_BROADCAST_BATCH_SIZE) break;
        skip += PRESENCE_BROADCAST_BATCH_SIZE;
      }
    } catch (error) {
      this.logger.error(
        `Failed to broadcast presence for user ${userId}:`,
        error,
      );
    }
  }
}
