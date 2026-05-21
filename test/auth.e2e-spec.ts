import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { authHeader } from './helpers/auth.helper';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  const validUser = {
    email: 'auth_main@test.com',
    username: 'auth_main',
    password: 'Test@123456',
  };

  beforeAll(async () => {
    app = await createTestApp();
    // Guard: clean any leftover data from a previously-failed run
    await cleanDatabase(app);
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── POST /auth/register ─────────────────────────────────────────────────────

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user and return tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validUser)
        .expect(201);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({ email: validUser.email });
      // Sensitive fields MUST NOT be exposed
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user).not.toHaveProperty('providerId');
      expect(res.body.user).not.toHaveProperty('authProvider');
    });

    it('should return 400 when email is already in use', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send(validUser)
        .expect(400);
    });

    it('should return 400 when username is already taken', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'other_auth@test.com',
          username: validUser.username, // same username
          password: 'Test@123456',
        })
        .expect(400);
    });

    it('should return 400 when email is invalid', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          username: 'newuser1',
          password: 'Test@123456',
        })
        .expect(400);
    });

    it('should return 400 when password is too short', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'shortpw@test.com',
          username: 'newuser2',
          password: '123',
        })
        .expect(400);
    });

    it('should return 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'missing@test.com' })
        .expect(400);
    });
  });

  // ─── POST /auth/login ────────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('should login with correct credentials and return tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: validUser.username, password: validUser.password })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toMatchObject({ email: validUser.email });
      // Sensitive fields MUST NOT be exposed
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user).not.toHaveProperty('providerId');
      expect(res.body.user).not.toHaveProperty('authProvider');
    });

    it('should return 401 when password is wrong', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: validUser.username, password: 'wrongpassword' })
        .expect(401);
    });

    it('should return 401 when username does not exist', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent_xyz', password: 'Test@123456' })
        .expect(401);
    });
  });

  // ─── POST /auth/refresh ──────────────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    let refreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: validUser.username, password: validUser.password });
      refreshToken = res.body.refreshToken;
    });

    it('should issue new tokens with a valid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('should return 401 when refresh token is invalid', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);
    });

    it('should return 401 when refresh token is reused (rotation)', async () => {
      // After the previous test, the token was rotated — reuse should fail
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  // ─── POST /auth/logout ───────────────────────────────────────────────────────

  describe('POST /api/v1/auth/logout', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: validUser.username, password: validUser.password });
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('should return 401 when no access token is provided', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(401);
    });

    it('should logout successfully with a valid token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(authHeader(accessToken))
        .send({ refreshToken })
        .expect(200);

      expect(res.body).toMatchObject({ success: true });
    });
  });

  // ─── POST /auth/device-token ─────────────────────────────────────────────────

  describe('POST /api/v1/auth/device-token', () => {
    let accessToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ username: validUser.username, password: validUser.password });
      accessToken = res.body.accessToken;
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/device-token')
        .send({ token: 'fcm-token-abc', platform: 'android' })
        .expect(401);
    });

    it('should register a device token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/device-token')
        .set(authHeader(accessToken))
        .send({ token: 'fcm-token-abc-123', platform: 'android' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('userId');
      expect(res.body).toHaveProperty('platform', 'android');
      expect(res.body).toHaveProperty('token', 'fcm-token-abc-123');
    });
  });
});
