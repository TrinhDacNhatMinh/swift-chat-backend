import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { UserService } from '../user/user.service';
import {
  REDIS_CLIENT,
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from '../redis/redis.module';
import { createMockRedis } from '../__mocks__/redis.mock';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
const createMockSocket = (overrides: Record<string, any> = {}) => ({
  id: 'sock-1',
  data: { userId: 'u1', email: 'e@e.com', username: 'testuser' },
  join: jest.fn().mockResolvedValue(undefined),
  leave: jest.fn().mockResolvedValue(undefined),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  handshake: { auth: {}, headers: {} },
  ...overrides,
});

const createMockServer = () => ({
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  use: jest.fn(),
});

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let redis: ReturnType<typeof createMockRedis>;
  let chatService: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(async () => {
    redis = createMockRedis();
    chatService = {
      setServer: jest.fn(),
      joinRoom: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn(),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      editMessage: jest.fn().mockResolvedValue(undefined),
      markRead: jest.fn().mockResolvedValue(undefined),
      reactMessage: jest.fn().mockResolvedValue({ reactions: [] }),
      broadcastPresenceToFriends: jest.fn().mockResolvedValue(undefined),
    };
    userService = {
      findById: jest.fn().mockResolvedValue({ username: 'testuser' }),
      updateLastSeen: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: REDIS_PUB_CLIENT, useValue: createMockRedis() },
        { provide: REDIS_SUB_CLIENT, useValue: createMockRedis() },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('secret') },
        },
        { provide: ChatService, useValue: chatService },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);

    // Inject mock server
    mockServer = createMockServer();
    gateway.server = mockServer as any;
    gateway.afterInit(mockServer as any);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Lifecycle: handleConnection
  // =========================================================================
  describe('handleConnection()', () => {
    it('should join user room, set presence online, and broadcast on first connection', async () => {
      const client = createMockSocket();
      redis.incr.mockResolvedValue(1); // first connection

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith('user:u1');
      expect(redis.incr).toHaveBeenCalledWith('conn_count:u1');
      expect(redis.expire).toHaveBeenCalledWith('conn_count:u1', 120);
      expect(redis.set).toHaveBeenCalledWith(
        'presence:u1',
        'online',
        'EX',
        120,
      );
      expect(chatService.broadcastPresenceToFriends).toHaveBeenCalledWith(
        'u1',
        'online',
      );
    });

    it('should only refresh TTL on subsequent connections (no broadcast)', async () => {
      const client = createMockSocket();
      redis.incr.mockResolvedValue(2); // second connection

      await gateway.handleConnection(client as any);

      expect(redis.set).not.toHaveBeenCalled();
      expect(chatService.broadcastPresenceToFriends).not.toHaveBeenCalled();
      // Should refresh presence TTL instead
      expect(redis.expire).toHaveBeenCalledWith('presence:u1', 120);
    });
  });

  // =========================================================================
  // Lifecycle: handleDisconnect
  // =========================================================================
  describe('handleDisconnect()', () => {
    it('should cleanup presence, broadcast offline, and update lastSeen on last disconnect', async () => {
      const client = createMockSocket();
      redis.decr.mockResolvedValue(0); // last connection gone

      await gateway.handleDisconnect(client as any);

      expect(redis.decr).toHaveBeenCalledWith('conn_count:u1');
      expect(redis.del).toHaveBeenCalledWith('conn_count:u1');
      expect(redis.del).toHaveBeenCalledWith('presence:u1');
      expect(chatService.broadcastPresenceToFriends).toHaveBeenCalledWith(
        'u1',
        'offline',
      );
      expect(userService.updateLastSeen).toHaveBeenCalledWith('u1');
    });

    it('should only decrement count when other connections remain', async () => {
      const client = createMockSocket();
      redis.decr.mockResolvedValue(1); // still has connections

      await gateway.handleDisconnect(client as any);

      expect(redis.del).not.toHaveBeenCalled();
      expect(chatService.broadcastPresenceToFriends).not.toHaveBeenCalled();
      expect(userService.updateLastSeen).not.toHaveBeenCalled();
    });

    it('should return early when userId is not set', async () => {
      const client = createMockSocket({ data: {} });

      await gateway.handleDisconnect(client as any);

      expect(redis.decr).not.toHaveBeenCalled();
    });

    it('should not throw when updateLastSeen fails', async () => {
      const client = createMockSocket();
      redis.decr.mockResolvedValue(0);
      userService.updateLastSeen.mockRejectedValue(new Error('db error'));

      await expect(
        gateway.handleDisconnect(client as any),
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // Event: chat:join_room
  // =========================================================================
  describe('handleJoinRoom()', () => {
    it('should join room and return success', async () => {
      const client = createMockSocket();
      const result = await gateway.handleJoinRoom(
        { conversationId: 'c1' },
        client as any,
      );

      expect(chatService.joinRoom).toHaveBeenCalledWith('u1', 'c1');
      expect(client.join).toHaveBeenCalledWith('conversation:c1');
      expect(result).toEqual({ status: 'success', conversationId: 'c1' });
    });
  });

  // =========================================================================
  // Event: chat:leave_room
  // =========================================================================
  describe('handleLeaveRoom()', () => {
    it('should leave room and return success', async () => {
      const client = createMockSocket();
      const result = await gateway.handleLeaveRoom(
        { conversationId: 'c1' },
        client as any,
      );

      expect(client.leave).toHaveBeenCalledWith('conversation:c1');
      expect(result).toEqual({ status: 'success', conversationId: 'c1' });
    });
  });

  // =========================================================================
  // Event: chat:typing / chat:stop_typing
  // =========================================================================
  describe('handleTyping()', () => {
    it('should emit typing event to conversation room', async () => {
      const mockEmit = jest.fn();
      const client = createMockSocket({
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
      });

      await gateway.handleTyping({ conversationId: 'c1' }, client as any);

      expect(client.to).toHaveBeenCalledWith('conversation:c1');
      expect(mockEmit).toHaveBeenCalledWith(
        'chat:user_typing',
        expect.objectContaining({
          conversationId: 'c1',
          userId: 'u1',
        }),
      );
    });
  });

  describe('handleStopTyping()', () => {
    it('should emit stop_typing event to conversation room', async () => {
      const mockEmit = jest.fn();
      const client = createMockSocket({
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
      });

      await gateway.handleStopTyping({ conversationId: 'c1' }, client as any);

      expect(mockEmit).toHaveBeenCalledWith(
        'chat:user_stop_typing',
        expect.objectContaining({
          conversationId: 'c1',
          userId: 'u1',
        }),
      );
    });
  });

  // =========================================================================
  // Event: chat:send_message
  // =========================================================================
  describe('handleSendMessage()', () => {
    it('should save message, emit to room, and return messageId', async () => {
      const dto = {
        conversationId: 'c1',
        content: 'hello',
        clientTempId: 'tmp-1',
      };
      const saved = {
        _id: 'msg1',
        toObject: () => ({ _id: 'msg1', content: 'hello' }),
      };
      chatService.sendMessage.mockResolvedValue(saved);
      const serverEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: serverEmit }),
      } as any;

      const client = createMockSocket();
      const result = await gateway.handleSendMessage(dto, client as any);

      expect(chatService.sendMessage).toHaveBeenCalledWith(
        'u1',
        'testuser',
        dto,
      );
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:receive_message',
        expect.objectContaining({
          _id: 'msg1',
          clientTempId: 'tmp-1',
        }),
      );
      expect(result).toEqual({ status: 'sent', messageId: 'msg1' });
    });
  });

  // =========================================================================
  // Event: chat:delete_message
  // =========================================================================
  describe('handleDeleteMessage()', () => {
    it('should delete message and emit to room', async () => {
      const dto = { conversationId: 'c1', messageId: 'msg1' };
      const serverEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: serverEmit }),
      } as any;
      const client = createMockSocket();

      const result = await gateway.handleDeleteMessage(dto, client as any);

      expect(chatService.deleteMessage).toHaveBeenCalledWith('u1', dto);
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:message_deleted',
        expect.objectContaining({
          conversationId: 'c1',
          messageId: 'msg1',
          deletedBy: 'u1',
        }),
      );
      expect(result).toEqual({ status: 'deleted', messageId: 'msg1' });
    });
  });

  // =========================================================================
  // Event: chat:edit_message
  // =========================================================================
  describe('handleEditMessage()', () => {
    it('should edit message and emit to room', async () => {
      const dto = {
        conversationId: 'c1',
        messageId: 'msg1',
        content: 'edited',
      };
      const serverEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: serverEmit }),
      } as any;
      const client = createMockSocket();

      const result = await gateway.handleEditMessage(dto, client as any);

      expect(chatService.editMessage).toHaveBeenCalledWith('u1', dto);
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:message_edited',
        expect.objectContaining({
          conversationId: 'c1',
          messageId: 'msg1',
          content: 'edited',
          editedBy: 'u1',
        }),
      );
      expect(result).toEqual({ status: 'edited', messageId: 'msg1' });
    });
  });

  // =========================================================================
  // Event: chat:mark_read
  // =========================================================================
  describe('handleMarkRead()', () => {
    it('should mark read and emit read receipt', async () => {
      const dto = { conversationId: 'c1', messageId: 'msg1' };
      const clientEmit = jest.fn();
      const client = createMockSocket({
        to: jest.fn().mockReturnValue({ emit: clientEmit }),
      });

      const result = await gateway.handleMarkRead(dto, client as any);

      expect(chatService.markRead).toHaveBeenCalledWith('u1', dto);
      expect(client.to).toHaveBeenCalledWith('conversation:c1');
      expect(clientEmit).toHaveBeenCalledWith(
        'chat:read_receipt',
        expect.objectContaining({
          conversationId: 'c1',
          userId: 'u1',
          messageId: 'msg1',
        }),
      );
      expect(result).toEqual({ status: 'success' });
    });
  });

  // =========================================================================
  // Event: chat:react_message
  // =========================================================================
  describe('handleReactMessage()', () => {
    it('should react to message and emit to room', async () => {
      const dto = {
        conversationId: 'c1',
        messageId: 'msg1',
        emoji: '👍',
      };
      const updatedMessage = { reactions: [{ emoji: '👍', userId: 'u1' }] };
      chatService.reactMessage.mockResolvedValue(updatedMessage);
      
      const serverEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: serverEmit }),
      } as any;
      
      const client = createMockSocket();
      const result = await gateway.handleReactMessage(dto, client as any);

      expect(chatService.reactMessage).toHaveBeenCalledWith('u1', dto);
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:reaction_updated',
        expect.objectContaining({
          conversationId: 'c1',
          messageId: 'msg1',
          reactions: updatedMessage.reactions,
        }),
      );
      expect(result).toEqual({ status: 'success', messageId: 'msg1' });
    });
  });

  // =========================================================================
  // Event: chat:heartbeat
  // =========================================================================
  describe('handleHeartbeat()', () => {
    it('should refresh presence and connection count TTL', async () => {
      const client = createMockSocket();

      const result = await gateway.handleHeartbeat(client as any);

      expect(redis.expire).toHaveBeenCalledWith('conn_count:u1', 120);
      expect(redis.expire).toHaveBeenCalledWith('presence:u1', 120);
      expect(result).toEqual({ status: 'ok' });
    });

    it('should return early when userId is not set', async () => {
      const client = createMockSocket({ data: {} });

      await gateway.handleHeartbeat(client as any);

      expect(redis.expire).not.toHaveBeenCalled();
    });
  });
});
