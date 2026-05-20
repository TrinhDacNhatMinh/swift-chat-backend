import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { registerAndLogin, authHeader, TestUser } from './helpers/auth.helper';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let user: TestUser;
  let actor: TestUser;
  let notificationId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    user = await registerAndLogin(app, '_notifuser');
    actor = await registerAndLogin(app, '_notifactor');

    // Seed a notification directly via service so we can test read endpoints
    const notificationsService = app.get(NotificationsService);
    const created = await notificationsService.create(
      user.userId,
      actor.userId,
      NotificationType.FRIEND_REQUEST_RECEIVED,
    );
    notificationId = created.id;
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── GET /notifications ───────────────────────────────────────────────────────

  describe('GET /api/v1/notifications', () => {
    it('should return notifications list for authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const n = res.body[0];
      expect(n).toHaveProperty('id');
      expect(n).toHaveProperty('type');
      expect(n).toHaveProperty('isRead');
      expect(n).toHaveProperty('createdAt');
      expect(n).toHaveProperty('actor');
      // actor should only expose public fields
      expect(n.actor).toHaveProperty('id');
      expect(n.actor).toHaveProperty('username');
      expect(n.actor).not.toHaveProperty('passwordHash');
    });

    it('should respect the limit query param', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .query({ limit: 1 })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);
    });

    it('should create a notification when a friend request is sent (real flow)', async () => {
      // actor sends a NEW friend request to user — triggers NotificationsService.create internally
      await request(app.getHttpServer())
        .post('/api/v1/friend-requests')
        .set(authHeader(actor.accessToken))
        .send({ receiverId: user.userId })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set(authHeader(user.accessToken))
        .expect(200);

      // At least one FRIEND_REQUEST_RECEIVED notification must exist for this user
      const frNotif = res.body.find(
        (n: { type: string; actor: { id: string } }) =>
          n.type === 'friend_request_received' && n.actor?.id === actor.userId,
      );
      expect(frNotif).toBeDefined();
      expect(frNotif.isRead).toBe(false);
    });
  });

  // ─── GET /notifications/unread-count ─────────────────────────────────────────

  describe('GET /api/v1/notifications/unread-count', () => {
    it('should return unread count with at least 1 (from seeded notification)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body).toHaveProperty('count');
      expect(typeof res.body.count).toBe('number');
      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .expect(401);
    });
  });

  // ─── PATCH /notifications/:id/read ───────────────────────────────────────────

  describe('PATCH /api/v1/notifications/:id/read', () => {
    it('should mark a single notification as read', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body).toHaveProperty('isRead', true);
      expect(res.body.id).toBe(notificationId);
    });

    it('should return 404 when notification does not belong to user', async () => {
      // actor tries to mark user's notification as read
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .set(authHeader(actor.accessToken))
        .expect(404);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/notifications/${notificationId}/read`)
        .expect(401);
    });
  });

  // ─── PATCH /notifications/read-all ──────────────────────────────────────────

  describe('PATCH /api/v1/notifications/read-all', () => {
    // Self-contained: seed a fresh unread notification so this describe can run
    // independently regardless of what previous tests did to notificationId.
    beforeEach(async () => {
      const notificationsService = app.get(NotificationsService);
      await notificationsService.create(
        user.userId,
        actor.userId,
        NotificationType.FRIEND_REQUEST_ACCEPTED,
      );
    });

    it('should mark all notifications as read and unread-count becomes 0', async () => {
      // Mark all read
      await request(app.getHttpServer())
        .patch('/api/v1/notifications/read-all')
        .set(authHeader(user.accessToken))
        .expect(200);

      // Verify unread count is now 0
      const countRes = await request(app.getHttpServer())
        .get('/api/v1/notifications/unread-count')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(countRes.body.count).toBe(0);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/notifications/read-all')
        .expect(401);
    });
  });
});
