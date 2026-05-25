import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { registerAndLogin, authHeader, TestUser } from './helpers/auth.helper';
import { MessagesService } from '../src/messages/messages.service';
import { MessageType } from '../src/messages/schemas/message.schema';

describe('Messages (e2e)', () => {
  let app: INestApplication<App>;
  let member: TestUser;
  let otherMember: TestUser;
  let outsider: TestUser;
  let conversationId: string;

  // Seeded message IDs for assertion
  let seededMessageId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);

    member = await registerAndLogin(app, '_msgmember');
    otherMember = await registerAndLogin(app, '_msgother');
    outsider = await registerAndLogin(app, '_msgoutsider');

    // Create a group conversation that member and otherMember belong to
    const res = await request(app.getHttpServer())
      .post('/api/v1/conversations')
      .set(authHeader(member.accessToken))
      .send({
        type: 'group',
        title: 'Messages Test Group',
        memberIds: [otherMember.userId],
      });
    conversationId = res.body.id;

    // Seed real messages via MessagesService so GET/search have actual data
    const messagesService = app.get(MessagesService);

    const msg1 = await messagesService.create(member.userId, {
      conversationId,
      content: 'Hello searchable world',
      type: MessageType.TEXT,
    });
    seededMessageId = (msg1._id as any).toString();

    await messagesService.create(otherMember.userId, {
      conversationId,
      content: 'Another test message from other member',
      type: MessageType.TEXT,
    });
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── GET /conversations/:conversationId/messages ──────────────────────────────

  describe('GET /api/v1/conversations/:conversationId/messages', () => {
    it('should return seeded messages for a member', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set(authHeader(member.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Two messages were seeded — response is sorted desc, so both should appear
      expect(res.body.length).toBeGreaterThanOrEqual(2);

      const first = res.body[0];
      expect(first).toHaveProperty('_id');
      expect(first).toHaveProperty('content');
      expect(first).toHaveProperty('sender_id');
      expect(first).toHaveProperty('conversation_id', conversationId);
      expect(first).toHaveProperty('type', MessageType.TEXT);
      expect(first).toHaveProperty('is_deleted', false);
    });

    it('should return 403 for a non-member', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set(authHeader(outsider.accessToken))
        .expect(403);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .expect(401);
    });

    it('should respect the limit query param', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .query({ limit: 1 })
        .set(authHeader(member.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });

    it('should paginate with cursor (return older messages)', async () => {
      // Use the first seeded message id as cursor → should return nothing older
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .query({ cursor: seededMessageId, limit: 10 })
        .set(authHeader(member.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // No messages older than the very first one
      expect(res.body.length).toBe(0);
    });
  });

  // ─── GET /conversations/:conversationId/messages/search ───────────────────────

  describe('GET /api/v1/conversations/:conversationId/messages/search', () => {
    it('should find the seeded message by keyword', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages/search`)
        .query({ q: 'searchable' })
        .set(authHeader(member.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const found = res.body.find(
        (m: { _id: string }) => m._id === seededMessageId,
      );
      expect(found).toBeDefined();
      expect(found.content).toContain('searchable');
    });

    it('should return empty array when no messages match the query', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages/search`)
        .query({ q: 'zzznomatchxyz' })
        .set(authHeader(member.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('should return 403 for a non-member', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages/search`)
        .query({ q: 'hello' })
        .set(authHeader(outsider.accessToken))
        .expect(403);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}/messages/search`)
        .query({ q: 'hello' })
        .expect(401);
    });
  });
});
