import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './setup/app.setup';
import { cleanDatabase } from './setup/db.setup';
import { registerAndLogin, authHeader, TestUser } from './helpers/auth.helper';

describe('Conversations (e2e)', () => {
  let app: INestApplication<App>;
  let leader: TestUser;
  let deputy: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    await cleanDatabase(app);
    leader = await registerAndLogin(app, '_cvleader');
    deputy = await registerAndLogin(app, '_cvdeputy');
    member = await registerAndLogin(app, '_cvmember');
    outsider = await registerAndLogin(app, '_cvoutsider');
  });

  afterAll(async () => {
    await cleanDatabase(app);
    await closeTestApp();
  });

  // ─── POST /conversations ──────────────────────────────────────────────────────

  describe('POST /api/v1/conversations', () => {
    it('should create a direct conversation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({ type: 'direct', partnerId: deputy.userId })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.type).toBe('direct');
    });

    it('should be idempotent — return existing direct conversation on duplicate POST', async () => {
      // First call
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({ type: 'direct', partnerId: deputy.userId })
        .expect(201);

      // Second call with same partner
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({ type: 'direct', partnerId: deputy.userId })
        .expect(201);

      // Must resolve to the same conversation — no duplicate created
      expect(res2.body.id).toBe(res1.body.id);
    });

    it('should create a group conversation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({
          type: 'group',
          title: 'Test Group',
          memberIds: [deputy.userId, member.userId],
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.type).toBe('group');
    });

    it('should return 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({ type: 'direct' }) // missing partnerId
        .expect(400);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .send({ type: 'direct', partnerId: deputy.userId })
        .expect(401);
    });
  });

  // ─── GET /conversations ───────────────────────────────────────────────────────

  describe('GET /api/v1/conversations', () => {
    it('should return paginated conversations for the user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/conversations')
        .expect(401);
    });
  });

  // ─── Group management tests ───────────────────────────────────────────────────
  //
  // Group state timeline:
  // 1. Create group: leader=LEADER, deputy=MEMBER, member=MEMBER
  // 2. Add outsider   → leader=LEADER, deputy=MEMBER, member=MEMBER, outsider=MEMBER
  // 3. updateGroupInfo by leader  → 200
  // 4. updateGroupInfo by member  → 200 (any member can update)
  // 5. addMembers by member       → 200 (any member can add)
  // 6. Promote deputy → DEPUTY (by leader)
  // 7. Deputy tries to change role → 403 (only LEADER can)
  // 8. Kick outsider by leader    → 200
  // 9. Kick member by member      → 403 (MEMBER cannot kick)
  // 10. Transfer leadership: leader → deputy → 200
  // 11. Transfer again: old leader (now MEMBER) → 403
  // 12. Old leader leaves          → 200
  // 13. Read receipts by deputy (now LEADER) → 200
  // 14. Read receipts by outsider (not in group) → 403

  describe('Group management', () => {
    let groupId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({
          type: 'group',
          title: 'Mgmt Group',
          memberIds: [deputy.userId, member.userId],
        });
      groupId = res.body.id;

      // Add outsider so we have someone to kick later
      await request(app.getHttpServer())
        .post(`/api/v1/conversations/${groupId}/members`)
        .set(authHeader(leader.accessToken))
        .send({ userIds: [outsider.userId] });
    });

    // ─── PATCH /conversations/:id ─────────────────────────────────────────────

    describe('PATCH /api/v1/conversations/:id', () => {
      it('should allow leader to update group info', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/conversations/${groupId}`)
          .set(authHeader(leader.accessToken))
          .send({ title: 'Updated Title' })
          .expect(200);

        expect(res.body.title).toBe('Updated Title');
      });

      it('should also allow a regular member to update group info', async () => {
        // Requirement: any member can update group name/avatar
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/conversations/${groupId}`)
          .set(authHeader(member.accessToken))
          .send({ title: 'Member Updated Title' })
          .expect(200);

        expect(res.body.title).toBe('Member Updated Title');
      });
    });

    // ─── POST /conversations/:id/members ─────────────────────────────────────

    describe('POST /api/v1/conversations/:id/members', () => {
      it('should allow a regular member to add members', async () => {
        // Requirement: any member can add new members to a group
        const res = await request(app.getHttpServer())
          .post(`/api/v1/conversations/${groupId}/members`)
          .set(authHeader(member.accessToken))
          .send({ userIds: [outsider.userId] }) // outsider already in group → added: 0
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
      });
    });

    // ─── PATCH /conversations/:id/members/:userId/role ────────────────────────

    describe('PATCH /api/v1/conversations/:id/members/:userId/role', () => {
      it('should allow leader to promote a member to deputy', async () => {
        await request(app.getHttpServer())
          .patch(
            `/api/v1/conversations/${groupId}/members/${deputy.userId}/role`,
          )
          .set(authHeader(leader.accessToken))
          .send({ role: 'deputy' })
          .expect(200);
      });

      it('should return 403 when a deputy tries to change a role', async () => {
        // Only LEADER can change roles
        await request(app.getHttpServer())
          .patch(
            `/api/v1/conversations/${groupId}/members/${outsider.userId}/role`,
          )
          .set(authHeader(deputy.accessToken))
          .send({ role: 'deputy' })
          .expect(403);
      });
    });

    // ─── DELETE /conversations/:id/members/:userId ────────────────────────────

    describe('DELETE /api/v1/conversations/:id/members/:userId', () => {
      it('should allow leader to kick a member', async () => {
        // Kick outsider (MEMBER) by leader (LEADER)
        await request(app.getHttpServer())
          .delete(`/api/v1/conversations/${groupId}/members/${outsider.userId}`)
          .set(authHeader(leader.accessToken))
          .expect(200);
      });

      it('should return 403 when a regular member tries to kick', async () => {
        // member (MEMBER role) tries to kick deputy (DEPUTY role) → 403
        await request(app.getHttpServer())
          .delete(`/api/v1/conversations/${groupId}/members/${deputy.userId}`)
          .set(authHeader(member.accessToken))
          .expect(403);
      });
    });

    // ─── POST /conversations/:id/transfer-leadership ──────────────────────────

    describe('POST /api/v1/conversations/:id/transfer-leadership', () => {
      it('should allow leader to transfer leadership', async () => {
        // Transfer to deputy (now has DEPUTY role)
        await request(app.getHttpServer())
          .post(`/api/v1/conversations/${groupId}/transfer-leadership`)
          .set(authHeader(leader.accessToken))
          .send({ newLeaderId: deputy.userId })
          .expect(200);
      });

      it('should return 403 when an ex-leader (now member) tries to transfer', async () => {
        // leader is now a regular MEMBER after transferring
        await request(app.getHttpServer())
          .post(`/api/v1/conversations/${groupId}/transfer-leadership`)
          .set(authHeader(leader.accessToken))
          .send({ newLeaderId: member.userId })
          .expect(403);
      });
    });

    // ─── DELETE /conversations/:id/members/me ────────────────────────────────

    describe('DELETE /api/v1/conversations/:id/members/me', () => {
      it('should allow a member to leave the group', async () => {
        // leader (now regular MEMBER) leaves
        await request(app.getHttpServer())
          .delete(`/api/v1/conversations/${groupId}/members/me`)
          .set(authHeader(leader.accessToken))
          .expect(200);
      });
    });

    // ─── GET /conversations/:conversationId/read-receipts ─────────────────────

    describe('GET /api/v1/conversations/:conversationId/read-receipts', () => {
      it('should return read receipts for a member', async () => {
        // deputy is now LEADER
        const res = await request(app.getHttpServer())
          .get(`/api/v1/conversations/${groupId}/read-receipts`)
          .set(authHeader(deputy.accessToken))
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
      });

      it('should return 403 for a non-member', async () => {
        // outsider was kicked from the group
        await request(app.getHttpServer())
          .get(`/api/v1/conversations/${groupId}/read-receipts`)
          .set(authHeader(outsider.accessToken))
          .expect(403);
      });
    });
  });

  // ─── DELETE /conversations/:id ────────────────────────────────────────────────

  describe('DELETE /api/v1/conversations/:id', () => {
    it('should allow a user to hide their direct conversation', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/v1/conversations')
        .set(authHeader(leader.accessToken))
        .send({ type: 'direct', partnerId: outsider.userId });

      await request(app.getHttpServer())
        .delete(`/api/v1/conversations/${createRes.body.id}`)
        .set(authHeader(leader.accessToken))
        .expect(200);
    });

    it('should return 401 when not authenticated', async () => {
      await request(app.getHttpServer())
        .delete('/api/v1/conversations/00000000-0000-0000-0000-000000000000')
        .expect(401);
    });
  });
});
