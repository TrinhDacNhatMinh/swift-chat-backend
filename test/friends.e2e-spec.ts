import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { registerAndLogin, authHeader, TestUser } from './helpers/auth.helper';

describe('Friends (e2e)', () => {
  let app: INestApplication<App>;
  let userA: TestUser;
  let userB: TestUser;
  let userC: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    userA = await registerAndLogin(app, '_frndA');
    userB = await registerAndLogin(app, '_frndB');
    userC = await registerAndLogin(app, '_frndC');
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── POST /friend-requests ───────────────────────────────────────────────────

  describe('POST /api/v1/friend-requests', () => {
    it('should send a friend request successfully', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userA.accessToken))
        .send({ receiverId: userB.userId })
        .expect(201);

      // Verify full body shape
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('senderId', userA.userId);
      expect(res.body).toHaveProperty('receiverId', userB.userId);
      expect(res.body).toHaveProperty('status', 'pending');
    });

    it('should return 400 when sending a duplicate request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userA.accessToken))
        .send({ receiverId: userB.userId })
        .expect(400);
    });

    it('should return 400 when sending a request to yourself', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userA.accessToken))
        .send({ receiverId: userA.userId })
        .expect(400);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .send({ receiverId: userB.userId })
        .expect(401);
    });
  });

  // ─── GET /friend-requests ────────────────────────────────────────────────────

  describe('GET /api/v1/friend-requests', () => {
    it('should return pending requests for the receiver', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/friend-requests')
        .set(authHeader(userB.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const senderIds = res.body.map((r: { senderId: string }) => r.senderId);
      expect(senderIds).toContain(userA.userId);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/friend-requests')
        .expect(401);
    });
  });

  // ─── PATCH /friend-requests/:requestId (accept) ──────────────────────────────

  describe('PATCH /api/v1/friend-requests/:requestId (accept)', () => {
    let requestId: string;

    beforeAll(async () => {
      // userC sends to userA so we have a fresh request
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userC.accessToken))
        .send({ receiverId: userA.userId });

      const res = await request(app.getHttpServer())
        .get('/api/v1/friend-requests')
        .set(authHeader(userA.accessToken));

      const incoming = res.body.find(
        (r: { senderId: string }) => r.senderId === userC.userId,
      );
      requestId = incoming?.id;
    });

    it('should accept a friend request', async () => {
      // Enum value is "accepted" (not "accept")
      await request(app.getHttpServer())
        .patch(`/api/v1/friend-requests/${requestId}`)
        .set(authHeader(userA.accessToken))
        .send({ action: 'accepted' })
        .expect(200);
    });

    it('should return 403 when the sender tries to accept their own outgoing request', async () => {
      // Find the request A sent to B
      const res = await request(app.getHttpServer())
        .get('/api/v1/friend-requests')
        .set(authHeader(userB.accessToken));

      const reqAB = res.body.find(
        (r: { senderId: string }) => r.senderId === userA.userId,
      );
      const reqId = reqAB.id;

      // userA (sender) tries to accept their own outgoing request — should be 403
      await request(app.getHttpServer())
        .patch(`/api/v1/friend-requests/${reqId}`)
        .set(authHeader(userA.accessToken))
        .send({ action: 'accepted' })
        .expect(403);
    });
  });

  // ─── PATCH /friend-requests/:requestId (reject) ──────────────────────────────

  describe('PATCH /api/v1/friend-requests/:requestId (reject)', () => {
    let requestId: string;

    beforeAll(async () => {
      // userB sends a new request to userC
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userB.accessToken))
        .send({ receiverId: userC.userId });

      const res = await request(app.getHttpServer())
        .get('/api/v1/friend-requests')
        .set(authHeader(userC.accessToken));

      const incoming = res.body.find(
        (r: { senderId: string }) => r.senderId === userB.userId,
      );
      requestId = incoming?.id;
    });

    it('should reject a friend request', async () => {
      // Enum value is "rejected" (not "reject")
      await request(app.getHttpServer())
        .patch(`/api/v1/friend-requests/${requestId}`)
        .set(authHeader(userC.accessToken))
        .send({ action: 'rejected' })
        .expect(200);
    });
  });

  // ─── GET /friends ─────────────────────────────────────────────────────────────

  describe('GET /api/v1/friends', () => {
    it('should return paginated friends list', async () => {
      // getFriends returns { data: [], total, limit, offset }
      const res = await request(app.getHttpServer())
        .get('/api/v1/friends')
        .set(authHeader(userA.accessToken))
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('total');
      // userA accepted userC — should be in friends list
      const friendIds = res.body.data.map((u: { id: string }) => u.id);
      expect(friendIds).toContain(userC.userId);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/friends').expect(401);
    });
  });

  // ─── DELETE /friends/:userId ──────────────────────────────────────────────────

  describe('DELETE /api/v1/friends/:userId', () => {
    it('should remove an existing friend', async () => {
      // userA and userC are friends — remove friendship
      await request(app.getHttpServer())
        .delete(`/api/v1/friends/${userC.userId}`)
        .set(authHeader(userA.accessToken))
        .expect(200);
    });

    it('should return 404 when target is not a friend', async () => {
      // userA and userB are NOT friends (userB rejected or no friendship)
      await request(app.getHttpServer())
        .delete(`/api/v1/friends/${userB.userId}`)
        .set(authHeader(userA.accessToken))
        .expect(404);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/friends/${userB.userId}`)
        .expect(401);
    });
  });

  // ─── Re-send after rejection ─────────────────────────────────────────────────

  describe('Re-send friend request after rejection', () => {
    it('should allow B to re-send a request to C after C has rejected it', async () => {
      // userC rejected userB earlier.
      // The service upserts back to PENDING, so a second POST should succeed.
      const res = await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(userB.accessToken))
        .send({ receiverId: userC.userId })
        .expect(201);

      expect(res.body).toHaveProperty('status', 'pending');
      expect(res.body).toHaveProperty('senderId', userB.userId);
      expect(res.body).toHaveProperty('receiverId', userC.userId);
    });
  });
});
