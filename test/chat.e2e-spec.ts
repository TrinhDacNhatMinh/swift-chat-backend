import { INestApplication } from '@nestjs/common';
import { Socket } from 'socket.io-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp, getTestPort } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import {
  registerAndLogin,
  authHeader,
  TestUser,
  connectSocket,
  connectAndWait,
  emitAck,
  waitForEvent,
} from './helpers/auth.helper';

describe('Chat WebSocket (e2e)', () => {
  let app: INestApplication<App>;
  let port: number;
  let sender: TestUser;
  let receiver: TestUser;
  let outsider: TestUser;
  let conversationId: string;

  // Track open sockets for cleanup after each test
  const openSockets: Socket[] = [];

  function track(socket: Socket): Socket {
    openSockets.push(socket);
    return socket;
  }

  /** Helper: connect two sockets and join both into the test conversation. */
  async function setupRoom(): Promise<{
    senderSock: Socket;
    receiverSock: Socket;
  }> {
    const senderSock = track(connectSocket(port, sender.accessToken));
    const receiverSock = track(connectSocket(port, receiver.accessToken));

    await connectAndWait(senderSock);
    await connectAndWait(receiverSock);

    await emitAck(senderSock, 'chat:join_room', { conversationId });
    await emitAck(receiverSock, 'chat:join_room', { conversationId });

    return { senderSock, receiverSock };
  }

  /** Helper: send a message from senderSock and return its messageId. */
  async function seedMessage(
    senderSock: Socket,
    content: string,
  ): Promise<string> {
    const ack = await emitAck<any>(senderSock, 'chat:send_message', {
      conversationId,
      content,
      type: 'text',
    });
    return ack.messageId.toString();
  }

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    port = getTestPort();

    sender = await registerAndLogin(app, '_chatsender');
    receiver = await registerAndLogin(app, '_chatreceiver');
    outsider = await registerAndLogin(app, '_chatoutsider');

    const res = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set(authHeader(sender.accessToken))
      .send({
        type: 'group',
        title: 'Chat WS Test Group',
        memberIds: [receiver.userId],
      });
    conversationId = res.body.id;
  });

  afterEach(() => {
    // Disconnect all sockets opened during this test
    openSockets.forEach((s) => {
      if (s.connected) s.disconnect();
    });
    openSockets.length = 0;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── Connection & Authentication ──────────────────────────────────────────────

  describe('Connection & Authentication', () => {
    it('should connect successfully with a valid access token', async () => {
      const socket = track(connectSocket(port, sender.accessToken));
      await expect(connectAndWait(socket)).resolves.toBeUndefined();
      expect(socket.connected).toBe(true);
    });

    it('should reject connection when no token is provided', async () => {
      const socket = track(connectSocket(port, ''));
      await expect(connectAndWait(socket)).rejects.toThrow();
      expect(socket.connected).toBe(false);
    });

    it('should reject connection with an invalid/expired token', async () => {
      const socket = track(connectSocket(port, 'invalid.jwt.token.here'));
      await expect(connectAndWait(socket)).rejects.toThrow();
      expect(socket.connected).toBe(false);
    });
  });

  // ─── chat:join_room ───────────────────────────────────────────────────────────

  describe('chat:join_room', () => {
    it('should join a conversation room as a valid member', async () => {
      const socket = track(connectSocket(port, sender.accessToken));
      await connectAndWait(socket);

      const ack = await emitAck<any>(socket, 'chat:join_room', {
        conversationId,
      });

      expect(ack).toMatchObject({ status: 'success', conversationId });
    });

    it('should return error when joining as a non-member', async () => {
      const socket = track(connectSocket(port, outsider.accessToken));
      await connectAndWait(socket);

      const ack = await emitAck<any>(socket, 'chat:join_room', {
        conversationId,
      });

      expect(ack.status).toBe('error');
    });
  });

  // ─── chat:send_message ────────────────────────────────────────────────────────

  describe('chat:send_message', () => {
    it('should persist message and broadcast chat:receive_message to all room members', async () => {
      const { senderSock, receiverSock } = await setupRoom();

      // Subscribe before sending so we do not miss the event
      const incomingPromise = waitForEvent<any>(
        receiverSock,
        'chat:receive_message',
      );

      const ack = await emitAck<any>(senderSock, 'chat:send_message', {
        conversationId,
        content: 'Hello from WebSocket E2E',
        type: 'text',
      });

      expect(ack).toMatchObject({ status: 'sent' });
      expect(ack).toHaveProperty('messageId');

      const incoming = await incomingPromise;
      expect(incoming.content).toBe('Hello from WebSocket E2E');
      expect(incoming.conversation_id).toBe(conversationId);
      expect(incoming.sender_id).toBe(sender.userId);
      expect(incoming.is_deleted).toBe(false);
    });

    it('should be visible via GET /messages after being sent over WebSocket', async () => {
      const { senderSock } = await setupRoom();
      const uniqueContent = `ws-to-http-${Date.now()}`;

      await emitAck<any>(senderSock, 'chat:send_message', {
        conversationId,
        content: uniqueContent,
        type: 'text',
      });

      // Allow a moment for the async DB write to complete
      await new Promise((r) => setTimeout(r, 100));

      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set(authHeader(sender.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((m: any) => m.content === uniqueContent);
      expect(found).toBeDefined();
      expect(found.sender_id).toBe(sender.userId);
      expect(found.conversation_id).toBe(conversationId);
    });

    it('should return error when sending to a non-existent conversation', async () => {
      const socket = track(connectSocket(port, sender.accessToken));
      await connectAndWait(socket);

      const ack = await emitAck<any>(socket, 'chat:send_message', {
        conversationId: '00000000-0000-0000-0000-000000000000',
        content: 'Ghost message',
        type: 'text',
      });

      expect(ack.status).toBe('error');
    });
  });

  // ─── chat:edit_message ────────────────────────────────────────────────────────

  describe('chat:edit_message', () => {
    it('should edit own message and broadcast chat:message_edited to room', async () => {
      const { senderSock, receiverSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'Original content');

      const editedPromise = waitForEvent<any>(
        receiverSock,
        'chat:message_edited',
      );

      const ack = await emitAck<any>(senderSock, 'chat:edit_message', {
        conversationId,
        messageId,
        content: 'Edited content',
      });

      expect(ack).toMatchObject({ status: 'edited', messageId });

      const broadcast = await editedPromise;
      expect(broadcast.content).toBe('Edited content');
      expect(broadcast.messageId).toBe(messageId);
      expect(broadcast.conversationId).toBe(conversationId);
    });
  });

  // ─── chat:delete_message ──────────────────────────────────────────────────────

  describe('chat:delete_message', () => {
    it('should soft-delete own message and broadcast chat:message_deleted to room', async () => {
      const { senderSock, receiverSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'Message to be deleted');

      const deletedPromise = waitForEvent<any>(
        receiverSock,
        'chat:message_deleted',
      );

      const ack = await emitAck<any>(senderSock, 'chat:delete_message', {
        conversationId,
        messageId,
      });

      expect(ack).toMatchObject({ status: 'deleted', messageId });

      const broadcast = await deletedPromise;
      expect(broadcast.messageId).toBe(messageId);
      expect(broadcast.conversationId).toBe(conversationId);
      expect(broadcast.deletedBy).toBe(sender.userId);
    });
  });

  // ─── Permission — outsider cannot operate on messages ─────────────────────────

  describe('Permission — outsider', () => {
    it('should return error when outsider tries to send_message without joining', async () => {
      // outsider is authenticated but is NOT a member of conversationId
      const outsiderSock = track(connectSocket(port, outsider.accessToken));
      await connectAndWait(outsiderSock);

      const ack = await emitAck<any>(outsiderSock, 'chat:send_message', {
        conversationId,
        content: 'Unauthorized message',
        type: 'text',
      });

      expect(ack.status).toBe('error');
    });

    it('should return error when outsider tries to edit_message in a conversation they do not belong to', async () => {
      // First, seed a real message as sender
      const { senderSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'Edit target');

      // Now outsider tries to edit it
      const outsiderSock = track(connectSocket(port, outsider.accessToken));
      await connectAndWait(outsiderSock);

      const ack = await emitAck<any>(outsiderSock, 'chat:edit_message', {
        conversationId,
        messageId,
        content: 'Hijacked content',
      });

      expect(ack.status).toBe('error');
    });

    it('should return error when outsider tries to delete_message in a conversation they do not belong to', async () => {
      // Seed a message as sender
      const { senderSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'Delete target');

      const outsiderSock = track(connectSocket(port, outsider.accessToken));
      await connectAndWait(outsiderSock);

      const ack = await emitAck<any>(outsiderSock, 'chat:delete_message', {
        conversationId,
        messageId,
      });

      expect(ack.status).toBe('error');
    });
  });

  // ─── chat:react_message ───────────────────────────────────────────────────────

  describe('chat:react_message', () => {
    it('should toggle reaction on a message and broadcast chat:reaction_updated', async () => {
      const { senderSock, receiverSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'React to me!');

      const reactionPromise = waitForEvent<any>(
        receiverSock,
        'chat:reaction_updated',
      );

      const ack = await emitAck<any>(senderSock, 'chat:react_message', {
        conversationId,
        messageId,
        emoji: '👍',
      });

      expect(ack).toMatchObject({ status: 'success', messageId });

      const broadcast = await reactionPromise;
      expect(broadcast.messageId).toBe(messageId);
      expect(Array.isArray(broadcast.reactions)).toBe(true);
      expect(broadcast.reactions.some((r: any) => r.emoji === '👍')).toBe(true);
    });
  });

  // ─── chat:mark_read ───────────────────────────────────────────────────────────

  describe('chat:mark_read', () => {
    it('should mark message as read and emit chat:read_receipt to other room members', async () => {
      const { senderSock, receiverSock } = await setupRoom();
      const messageId = await seedMessage(senderSock, 'Please read this');

      // read_receipt is sent with client.to(room) — excludes receiver, arrives at sender
      const receiptPromise = waitForEvent<any>(senderSock, 'chat:read_receipt');

      const ack = await emitAck<any>(receiverSock, 'chat:mark_read', {
        conversationId,
        messageId,
      });

      expect(ack).toMatchObject({ status: 'success' });

      const receipt = await receiptPromise;
      expect(receipt.conversationId).toBe(conversationId);
      expect(receipt.userId).toBe(receiver.userId);
      expect(receipt.messageId).toBe(messageId);
    });
  });

  // ─── chat:typing / chat:stop_typing ──────────────────────────────────────────

  describe('chat:typing / chat:stop_typing', () => {
    it('should broadcast chat:user_typing to other room members', async () => {
      const { senderSock, receiverSock } = await setupRoom();

      const typingPromise = waitForEvent<any>(receiverSock, 'chat:user_typing');

      // typing has no ack — emit without callback
      senderSock.emit('chat:typing', { conversationId });

      const typing = await typingPromise;
      expect(typing.conversationId).toBe(conversationId);
      expect(typing.userId).toBe(sender.userId);
      expect(typing).toHaveProperty('timestamp');
    });

    it('should broadcast chat:user_stop_typing to other room members', async () => {
      const { senderSock, receiverSock } = await setupRoom();

      const stopTypingPromise = waitForEvent<any>(
        receiverSock,
        'chat:user_stop_typing',
      );

      senderSock.emit('chat:stop_typing', { conversationId });

      const stopTyping = await stopTypingPromise;
      expect(stopTyping.conversationId).toBe(conversationId);
      expect(stopTyping.userId).toBe(sender.userId);
    });
  });

  // ─── chat:heartbeat ───────────────────────────────────────────────────────────

  describe('chat:heartbeat', () => {
    it('should respond with status ok', async () => {
      const socket = track(connectSocket(port, sender.accessToken));
      await connectAndWait(socket);

      const ack = await emitAck<any>(socket, 'chat:heartbeat');

      expect(ack).toMatchObject({ status: 'ok' });
    });
  });
});
