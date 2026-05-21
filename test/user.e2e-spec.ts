import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { registerAndLogin, authHeader, TestUser } from './helpers/auth.helper';

describe('User (e2e)', () => {
  let app: INestApplication<App>;
  let user: TestUser;
  let otherUser: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    user = await registerAndLogin(app, '_user1');
    otherUser = await registerAndLogin(app, '_user2');
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── GET /users/me ───────────────────────────────────────────────────────────

  describe('GET /api/v1/users/me', () => {
    it('should return own profile when authenticated', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body).toMatchObject({ username: user.username });
      // Public fields present
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('avatarUrl');
      // Sensitive fields MUST NOT be returned
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('authProvider');
      expect(res.body).not.toHaveProperty('providerId');
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });
  });

  // ─── PATCH /users/me ─────────────────────────────────────────────────────────

  describe('PATCH /api/v1/users/me', () => {
    it('should update own profile', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set(authHeader(user.accessToken))
        .send({ username: 'testuser_user1_updated' })
        .expect(200);

      expect(res.body.username).toBe('testuser_user1_updated');
      // Sensitive fields MUST NOT be returned
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('authProvider');
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .send({ username: 'hacker' })
        .expect(401);
    });
  });

  // ─── GET /users ──────────────────────────────────────────────────────────────

  describe('GET /api/v1/users', () => {
    it('should return matching users for a search query', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ query: 'testuser_user2' })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);

      const found = res.body[0];
      // Search returns only public fields
      expect(found).toHaveProperty('id');
      expect(found).toHaveProperty('username');
      expect(found).toHaveProperty('avatarUrl');
      // Sensitive / internal fields MUST NOT be returned
      expect(found).not.toHaveProperty('passwordHash');
      expect(found).not.toHaveProperty('email');
      expect(found).not.toHaveProperty('authProvider');
      expect(found).not.toHaveProperty('providerId');
    });

    it('should return an empty array when no match', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ query: 'zzznobodymatchesthisxyz' })
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .query({ query: 'someone' })
        .expect(401);
    });
  });

  // ─── GET /users/:userId ──────────────────────────────────────────────────────

  describe('GET /api/v1/users/:userId', () => {
    it('should return public profile for a valid userId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${otherUser.userId}`)
        .set(authHeader(user.accessToken))
        .expect(200);

      expect(res.body).toMatchObject({ id: otherUser.userId });
      // Public fields
      expect(res.body).toHaveProperty('username');
      expect(res.body).toHaveProperty('avatarUrl');
      // Sensitive fields MUST NOT be returned
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('email');
      expect(res.body).not.toHaveProperty('authProvider');
      expect(res.body).not.toHaveProperty('providerId');
    });

    it('should return 404 for a non-existent userId', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .set(authHeader(user.accessToken))
        .expect(404);
    });
  });
});
