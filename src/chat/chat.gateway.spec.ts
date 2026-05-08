import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { UserService } from '../user/user.service';
import { SocketEmitterService } from '../common/socket-emitter/socket-emitter.service';
import {
  REDIS_CLIENT,
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from '../redis/redis.module';
import { createMockRedis } from '../__mocks__/redis.mock';
import { WsThrottlerGuard } from '../common/guards/ws-throttler.guard';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------
const createMockSocket = (overrides: Record<string, any> = {}) => ({
  id: 'sock-1',
  data: { accountId: 'u1', email: 'e@e.com', username: 'testuser' },
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
      joinRoom: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn(),
      unsendMessage: jest.fn().mockResolvedValue(undefined),
      deleteForMe: jest.fn().mockResolvedValue(undefined),
      editMessage: jest.fn().mockResolvedValue(undefined),
      markRead: jest.fn().mockResolvedValue(undefined),
      reactMessage: jest.fn().mockResolvedValue({ reactions: [] }),
      broadcastPresenceToContacts: jest.fn().mockResolvedValue(undefined),
      onClientConnected: jest.fn().mockResolvedValue(undefined),
      onClientDisconnected: jest.fn().mockResolvedValue(undefined),
      onClientHeartbeat: jest.fn().mockResolvedValue(undefined),
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
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn().mockReturnValue('secret'),
          },
        },
        { provide: ChatService, useValue: chatService },
        { provide: UserService, useValue: userService },
        {
          provide: SocketEmitterService,
          useValue: { setServer: jest.fn() },
        },
      ],
    })
      .overrideGuard(WsThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    gateway = module.get<ChatGateway>(ChatGateway);

    // Inject mock server
    mockServer = createMockServer();
    gateway.server = mockServer as any;
    gateway.afterInit(mockServer as any);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // Lifecycle: handleConnection

  describe('handleConnection()', () => {
    it('should set server instance on SocketEmitterService', () => {
      const setServerSpy = jest.spyOn(
        gateway['socketEmitterService'],
        'setServer',
      );
      expect(setServerSpy).toHaveBeenCalledWith(mockServer);
    });

    it('should join account room and delegate to chatService.onClientConnected', async () => {
      const client = createMockSocket();

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith('account:u1');
      expect(chatService.onClientConnected).toHaveBeenCalledWith('u1');
    });
  });

  // Lifecycle: handleDisconnect

  describe('handleDisconnect()', () => {
    it('should delegate to chatService.onClientDisconnected', async () => {
      const client = createMockSocket();

      await gateway.handleDisconnect(client as any);

      expect(chatService.onClientDisconnected).toHaveBeenCalledWith('u1');
    });

    it('should return early when accountId is not set in handleDisconnect()', async () => {
      const client = createMockSocket({ data: {} });

      await gateway.handleDisconnect(client as any);

      expect(chatService.onClientDisconnected).not.toHaveBeenCalled();
    });
  });

  // Event: chat:join_room

  describe('handleJoinRoom()', () => {
    it('should join room and return success when handleJoinRoom() is called', async () => {
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

  // Event: chat:leave_room

  describe('handleLeaveRoom()', () => {
    it('should leave room and return success when handleLeaveRoom() is called', async () => {
      const client = createMockSocket();
      const result = await gateway.handleLeaveRoom(
        { conversationId: 'c1' },
        client as any,
      );

      expect(client.leave).toHaveBeenCalledWith('conversation:c1');
      expect(result).toEqual({ status: 'success', conversationId: 'c1' });
    });
  });

  // Event: chat:typing / chat:stop_typing

  describe('handleTyping()', () => {
    it('should emit typing event to conversation room when handleTyping() is called', () => {
      const mockEmit = jest.fn();
      const client = createMockSocket({
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
      });

      gateway.handleTyping({ conversationId: 'c1' }, client as any);

      expect(client.to).toHaveBeenCalledWith('conversation:c1');
      expect(mockEmit).toHaveBeenCalledWith(
        'chat:user_typing',
        expect.objectContaining({
          conversationId: 'c1',
          accountId: 'u1',
        }),
      );
    });
  });

  describe('handleStopTyping()', () => {
    it('should emit stop_typing event to conversation room when handleStopTyping() is called', () => {
      const mockEmit = jest.fn();
      const client = createMockSocket({
        to: jest.fn().mockReturnValue({ emit: mockEmit }),
      });

      gateway.handleStopTyping({ conversationId: 'c1' }, client as any);

      expect(mockEmit).toHaveBeenCalledWith(
        'chat:user_stop_typing',
        expect.objectContaining({
          conversationId: 'c1',
          accountId: 'u1',
        }),
      );
    });
  });

  // Event: chat:send_message

  describe('handleSendMessage()', () => {
    it('should save message, emit to room, and return messageId when handleSendMessage() succeeds', async () => {
      const dto = {
        conversationId: 'c1',
        content: 'hello',
        clientTempId: 'tmp-1',
      };
      const saved = {
        id: 'msg1',
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
          id: 'msg1',
          clientTempId: 'tmp-1',
        }),
      );
      expect(result).toEqual({ status: 'sent', messageId: 'msg1' });
    });
  });

  // Event: chat:unsend_message

  describe('handleUnsendMessage()', () => {
    it('should unsend message and emit to room when handleUnsendMessage() is called', async () => {
      const dto = { conversationId: 'c1', messageId: 'msg1' };
      const serverEmit = jest.fn();
      gateway.server = {
        to: jest.fn().mockReturnValue({ emit: serverEmit }),
      } as any;
      const client = createMockSocket();

      const result = await gateway.handleUnsendMessage(dto, client as any);

      expect(chatService.unsendMessage).toHaveBeenCalledWith('u1', dto);
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:message_unsent',
        expect.objectContaining({
          conversationId: 'c1',
          messageId: 'msg1',
          unsentBy: 'u1',
        }),
      );
      expect(result).toEqual({ status: 'unsent', messageId: 'msg1' });
    });
  });

  // Event: chat:delete_for_me

  describe('handleDeleteForMe()', () => {
    it('should delete message for me and emit to client when handleDeleteForMe() is called', async () => {
      const dto = { conversationId: 'c1', messageId: 'msg1' };
      const clientEmit = jest.fn();
      const client = createMockSocket({
        emit: clientEmit,
      });

      const result = await gateway.handleDeleteForMe(dto, client as any);

      expect(chatService.deleteForMe).toHaveBeenCalledWith('u1', dto);
      expect(clientEmit).toHaveBeenCalledWith(
        'chat:message_deleted_for_me',
        expect.objectContaining({
          conversationId: 'c1',
          messageId: 'msg1',
        }),
      );
      expect(result).toEqual({ status: 'deleted_for_me', messageId: 'msg1' });
    });
  });

  // Event: chat:edit_message

  describe('handleEditMessage()', () => {
    it('should edit message and emit to room when handleEditMessage() is called', async () => {
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

  // Event: chat:mark_read

  describe('handleMarkRead()', () => {
    it('should mark read and emit read receipt when handleMarkRead() is called', async () => {
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
          accountId: 'u1',
          messageId: 'msg1',
        }),
      );
      expect(result).toEqual({ status: 'success' });
    });
  });

  // Event: chat:react_message

  describe('handleReactMessage()', () => {
    it('should react to message and emit to room when handleReactMessage() is called', async () => {
      const dto = {
        conversationId: 'c1',
        messageId: 'msg1',
        emoji: '👍',
      };
      const updatedMessage = { reactions: [{ emoji: '👍', accountId: 'u1' }] };
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

  // Event: chat:heartbeat

  describe('handleHeartbeat()', () => {
    it('should delegate to chatService.onClientHeartbeat', async () => {
      const client = createMockSocket();

      const result = await gateway.handleHeartbeat(client as any);

      expect(chatService.onClientHeartbeat).toHaveBeenCalledWith('u1');
      expect(result).toEqual({ status: 'ok' });
    });

    it('should return early when accountId is not set in handleHeartbeat()', async () => {
      const client = createMockSocket({ data: {} });

      await gateway.handleHeartbeat(client as any);

      expect(chatService.onClientHeartbeat).not.toHaveBeenCalled();
    });
  });
});
