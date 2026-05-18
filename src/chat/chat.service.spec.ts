import { Test, TestingModule } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import { ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MessagesService } from '../messages/messages.service';
import { FriendsService } from '../friends/friends.service';
import { FcmService } from '../fcm/fcm.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('ChatService', () => {
  let service: ChatService;
  let conversations: Record<string, jest.Mock>;
  let messages: Record<string, jest.Mock>;
  let friends: Record<string, jest.Mock>;
  let fcm: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let mockServer: any;

  beforeEach(async () => {
    conversations = {
      isParticipant: jest.fn(),
      conversationExists: jest.fn(),
      updateTimestamp: jest.fn().mockResolvedValue(undefined),
      markAsRead: jest.fn().mockResolvedValue(undefined),
    };
    messages = {
      create: jest.fn(),
      softDelete: jest.fn(),
      editMessage: jest.fn(),
    };
    friends = {
      getFriendIdsBatch: jest.fn(),
    };
    fcm = {
      sendPushToOfflineParticipants: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      setServer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ConversationsService, useValue: conversations },
        { provide: MessagesService, useValue: messages },
        { provide: FriendsService, useValue: friends },
        { provide: FcmService, useValue: fcm },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);

    // Set up mock server
    mockServer = {
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    };
    service.setServer(mockServer);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // setServer()
  // =========================================================================
  describe('setServer()', () => {
    it('should set server and pass it to notificationsService', () => {
      const server = { to: jest.fn() } as any;
      service.setServer(server);
      expect(notifications.setServer).toHaveBeenCalledWith(server);
    });
  });

  // =========================================================================
  // joinRoom()
  // =========================================================================
  describe('joinRoom()', () => {
    it('should return true when user is participant', async () => {
      conversations.isParticipant.mockResolvedValue(true);

      const result = await service.joinRoom('u1', 'c1');

      expect(result).toBe(true);
    });

    it('should throw WsException when user is not participant', async () => {
      conversations.isParticipant.mockResolvedValue(false);

      await expect(service.joinRoom('u1', 'c1')).rejects.toThrow(WsException);
    });
  });

  // =========================================================================
  // sendMessage()
  // =========================================================================
  describe('sendMessage()', () => {
    const dto = { conversationId: 'c1', content: 'hello' };

    it('should throw when conversation does not exist', async () => {
      conversations.conversationExists.mockResolvedValue(false);

      await expect(service.sendMessage('u1', 'User', dto)).rejects.toThrow(
        WsException,
      );
    });

    it('should throw when user is not participant', async () => {
      conversations.conversationExists.mockResolvedValue(true);
      conversations.isParticipant.mockResolvedValue(false);

      await expect(service.sendMessage('u1', 'User', dto)).rejects.toThrow(
        WsException,
      );
    });

    it('should save message, update timestamp, and trigger FCM on success', async () => {
      conversations.conversationExists.mockResolvedValue(true);
      conversations.isParticipant.mockResolvedValue(true);
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

  // =========================================================================
  // deleteMessage()
  // =========================================================================
  describe('deleteMessage()', () => {
    it('should throw WsException when message not found', async () => {
      messages.softDelete.mockResolvedValue(null);

      await expect(
        service.deleteMessage('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should return deleted message on success', async () => {
      const deleted = { _id: 'msg1', is_deleted: true };
      messages.softDelete.mockResolvedValue(deleted);

      const result = await service.deleteMessage('u1', {
        messageId: 'msg1',
        conversationId: 'c1',
      });

      expect(result).toEqual(deleted);
    });
  });

  // =========================================================================
  // editMessage()
  // =========================================================================
  describe('editMessage()', () => {
    it('should throw WsException when message not found or deleted', async () => {
      messages.editMessage.mockResolvedValue(null);

      await expect(
        service.editMessage('u1', {
          messageId: 'msg1',
          conversationId: 'c1',
          content: 'new',
        }),
      ).rejects.toThrow(WsException);
    });

    it('should return edited message on success', async () => {
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

  // =========================================================================
  // markRead()
  // =========================================================================
  describe('markRead()', () => {
    it('should delegate to conversationsService.markAsRead', async () => {
      await service.markRead('u1', { conversationId: 'c1', messageId: 'msg1' });

      expect(conversations.markAsRead).toHaveBeenCalledWith('u1', 'c1', 'msg1');
    });
  });

  // =========================================================================
  // broadcastPresenceToFriends()
  // =========================================================================
  describe('broadcastPresenceToFriends()', () => {
    it('should broadcast to all friends in single batch', async () => {
      friends.getFriendIdsBatch
        .mockResolvedValueOnce(['f1', 'f2'])
        .mockResolvedValueOnce([]); // empty = stop

      await service.broadcastPresenceToFriends('u1', 'online');

      expect(mockServer.to).toHaveBeenCalledWith('user:f1');
      expect(mockServer.to).toHaveBeenCalledWith('user:f2');
    });

    it('should iterate multiple batches until empty', async () => {
      // First batch returns full batch (100), second returns partial, triggering stop
      const batch1 = Array.from({ length: 100 }, (_, i) => `f${i}`);
      const batch2 = ['fExtra'];
      friends.getFriendIdsBatch
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2);

      await service.broadcastPresenceToFriends('u1', 'offline');

      expect(friends.getFriendIdsBatch).toHaveBeenCalledTimes(2);
      expect(friends.getFriendIdsBatch).toHaveBeenCalledWith('u1', 0, 100);
      expect(friends.getFriendIdsBatch).toHaveBeenCalledWith('u1', 100, 100);
    });

    it('should not throw on error (logs instead)', async () => {
      friends.getFriendIdsBatch.mockRejectedValue(new Error('redis down'));

      await expect(
        service.broadcastPresenceToFriends('u1', 'online'),
      ).resolves.not.toThrow();
    });
  });
});
