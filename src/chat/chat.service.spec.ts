import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { FriendsService } from '../friends/friends.service';
import { FcmService } from '../fcm/fcm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserService } from '../user/user.service';
import { BlockService } from '../block/block.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createMockRedis } from '../__mocks__/redis.mock';

describe('ChatService', () => {
  let service: ChatService;
  let conversations: Record<string, jest.Mock>;
  let messages: Record<string, jest.Mock>;
  let friends: Record<string, jest.Mock>;
  let fcm: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let blocks: Record<string, jest.Mock>;
  let prisma: any;
  let socketEmitter: Record<string, jest.Mock>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    conversations = {
      isParticipant: jest.fn(),
      conversationExists: jest.fn(),
      updateTimestamp: jest.fn().mockResolvedValue(undefined),
      resetHiddenAt: jest.fn().mockResolvedValue(undefined),
      markAsRead: jest.fn().mockResolvedValue(undefined),
    };
    messages = {
      create: jest.fn(),
      unsendMessage: jest.fn(),
      deleteForMe: jest.fn(),
      editMessage: jest.fn(),
      toggleReaction: jest.fn(), // [NEW]
    };
    friends = {
      getFriendIdsBatch: jest.fn(),
    };
    fcm = {
      sendPushToOfflineParticipants: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      create: jest.fn(),
    };
    users = {
      isUserBlockedBy: jest.fn().mockResolvedValue(false),
    };
    blocks = {
      isBlockedEitherDirection: jest.fn().mockResolvedValue(false),
    };
    prisma = {
      conversation: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    socketEmitter = {
      emitToRoom: jest.fn(),
      emitToUser: jest.fn(),
    };
    redis = createMockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ConversationsService, useValue: conversations },
        { provide: MessagesService, useValue: messages },
        { provide: FriendsService, useValue: friends },
        { provide: FcmService, useValue: fcm },
        { provide: NotificationsService, useValue: notifications },
        { provide: UserService, useValue: users },
        { provide: BlockService, useValue: blocks },
        { provide: PrismaService, useValue: prisma },
        { provide: SocketEmitterService, useValue: socketEmitter },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // joinRoom()

  describe('joinRoom()', () => {
    it('should return true when account is participant in joinRoom()', async () => {
      conversations.isParticipant.mockResolvedValue(true);

      const result = await service.joinRoom('u1', 'c1');

      expect(result).toBe(true);
    });

    it('should throw WsException when account is not participant in joinRoom()', async () => {
      conversations.isParticipant.mockResolvedValue(false);

      await expect(service.joinRoom('u1', 'c1')).rejects.toThrow(WsException);
    });
  });

  // sendMessage()

  describe('sendMessage()', () => {
    const dto = { conversationId: 'c1', content: 'hello' };

    it('should throw WsException when conversation does not exist in sendMessage()', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.sendMessage('u1', 'User', dto as any),
      ).rejects.toThrow(WsException);
    });

    it('should throw WsException when account is not participant in sendMessage()', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        type: 'GROUP',
        participants: [{ accountId: 'u2' }], // u1 not here
      });

      await expect(
        service.sendMessage('u1', 'User', dto as any),
      ).rejects.toThrow(WsException);
    });

    it('should throw exception if blocked (DM only)', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      conversations.conversationExists.mockResolvedValue({
        id: 'c1',
        type: 'DIRECT',
        participants: [{ accountId: 'u1' }, { accountId: 'u2' }],
      });
      blocks.isBlockedEitherDirection.mockResolvedValue(true);

      const dto: any = { content: 'hello', type: 'TEXT' };

      await expect(service.sendMessage('u1', 'c1', dto)).rejects.toThrow(
        WsException,
      );
    });

    it('should save message, update timestamp, and trigger FCM when sendMessage() succeeds', async () => {
      prisma.conversation.findUnique.mockResolvedValue({
        id: 'c1',
        type: 'GROUP',
        participants: [{ accountId: 'u1' }],
      });
      const saved = { _id: 'msg1', content: 'hello' };
      messages.create.mockResolvedValue(saved);

      const result = await service.sendMessage('u1', 'User', dto);

      expect(messages.create).toHaveBeenCalledWith('u1', dto);
      expect(conversations.updateTimestamp).toHaveBeenCalledWith('c1');
      expect(fcm.sendPushToOfflineParticipants).toHaveBeenCalledWith(
        'c1',
        'u1',
        'User',
        'hello',
      );
      expect(result).toEqual(saved);
    });
  });

  // unsendMessage()

  describe('unsendMessage()', () => {
    it('should throw WsException when message not found in unsendMessage()', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      messages.unsendMessage.mockResolvedValue(null);

      await expect(
        service.unsendMessage('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should propagate error when trying to unsend a message older than 24 hours', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      messages.unsendMessage.mockRejectedValue(
        new Error(
          'You can only unsend a message within 24 hours of sending it',
        ),
      );

      await expect(
        service.unsendMessage('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
        }),
      ).rejects.toThrow(
        new Error(
          'You can only unsend a message within 24 hours of sending it',
        ),
      );
    });

    it('should return unsent message when unsendMessage() succeeds', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      const unsent = { _id: 'msg1', is_unsent: true };
      messages.unsendMessage.mockResolvedValue(unsent);

      const result = await service.unsendMessage('u1', {
        messageId: 'msg1',
        conversationId: 'c1',
      });

      expect(result).toEqual(unsent);
    });
  });

  // deleteForMe()

  describe('deleteForMe()', () => {
    it('should throw WsException when message not found in deleteForMe()', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      messages.deleteForMe.mockResolvedValue(null);

      await expect(
        service.deleteForMe('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should return deleted message when deleteForMe() succeeds', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      const deleted = { _id: 'msg1', deleted_by: ['u1'] };
      messages.deleteForMe.mockResolvedValue(deleted);

      const result = await service.deleteForMe('u1', {
        messageId: 'msg1',
        conversationId: 'c1',
      });

      expect(result).toEqual(deleted);
    });
  });

  // editMessage()

  describe('editMessage()', () => {
    it('should throw WsException when message not found or deleted in editMessage()', async () => {
      messages.editMessage.mockResolvedValue(null);

      await expect(
        service.editMessage('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
          content: 'new',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should return edited message when editMessage() succeeds', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      const edited = { _id: 'msg1', content: 'new', is_edited: true };
      messages.editMessage.mockResolvedValue(edited);

      const result = await service.editMessage('u1', {
        messageId: 'msg1',
        conversationId: 'c1',
        content: 'new',
      });

      expect(result).toEqual(edited);
    });
  });

  // markRead()

  describe('markRead()', () => {
    it('should delegate to conversationsService.markAsRead when markRead() is called', async () => {
      await service.markRead('u1', { conversationId: 'c1', messageId: 'msg1' });

      expect(conversations.markAsRead).toHaveBeenCalledWith('u1', 'c1', 'msg1');
    });
  });

  // broadcastPresenceToContacts()

  describe('broadcastPresenceToContacts()', () => {
    it('should broadcast to all friends in single batch when broadcastPresenceToContacts() is called', async () => {
      friends.getFriendIdsBatch
        .mockResolvedValueOnce(['f1', 'f2'])
        .mockResolvedValueOnce([]); // empty = stop

      await service.broadcastPresenceToContacts('u1', 'online');

      expect(socketEmitter.emitToUser).toHaveBeenCalledWith(
        'f1',
        'presence:status',
        expect.any(Object),
      );
      expect(socketEmitter.emitToUser).toHaveBeenCalledWith(
        'f2',
        'presence:status',
        expect.any(Object),
      );
    });

    it('should iterate multiple batches until empty when broadcastPresenceToContacts() is called', async () => {
      // First batch returns full batch (100), second returns partial, triggering stop
      const batch1 = Array.from({ length: 100 }, (_, i) => `f${i}`);
      const batch2 = ['fExtra'];
      friends.getFriendIdsBatch
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2);

      await service.broadcastPresenceToContacts('u1', 'offline');

      expect(friends.getFriendIdsBatch).toHaveBeenCalledTimes(2);
      expect(friends.getFriendIdsBatch).toHaveBeenCalledWith('u1', 0, 100);
      expect(friends.getFriendIdsBatch).toHaveBeenCalledWith('u1', 100, 100);
    });

    it('should not throw on error when broadcastPresenceToContacts() encounters an error', async () => {
      friends.getFriendIdsBatch.mockRejectedValue(new Error('redis down'));

      await expect(
        service.broadcastPresenceToContacts('u1', 'online'),
      ).resolves.not.toThrow();
    });
  });

  // reactMessage()

  describe('reactMessage()', () => {
    const dto = { conversationId: 'c1', messageId: 'msg1', emoji: '👍' };

    it('should throw WsException when account is not a participant in reactMessage()', async () => {
      conversations.isParticipant.mockResolvedValue(false);

      await expect(service.reactMessage('u1', dto)).rejects.toThrow(
        WsException,
      );
      expect(messages.toggleReaction).not.toHaveBeenCalled();
    });

    it('should throw WsException when message not found in reactMessage()', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      messages.toggleReaction.mockResolvedValue(null);

      await expect(service.reactMessage('u1', dto)).rejects.toThrow(
        WsException,
      );
    });

    it('should return updated message when reactMessage() successfully adds reaction', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      const updated = {
        _id: 'msg1',
        reactions: [{ emoji: '👍', accountId: 'u1' }],
      };
      messages.toggleReaction.mockResolvedValue(updated);

      const result = await service.reactMessage('u1', dto);

      expect(messages.toggleReaction).toHaveBeenCalledWith('msg1', 'u1', '👍');
      expect(result).toEqual(updated);
    });

    it('should return updated message when reactMessage() successfully removes reaction', async () => {
      conversations.isParticipant.mockResolvedValue(true);
      const updated = { _id: 'msg1', reactions: [] };
      messages.toggleReaction.mockResolvedValue(updated);

      const result = await service.reactMessage('u1', dto);

      expect(result.reactions).toHaveLength(0);
    });
  });
});
