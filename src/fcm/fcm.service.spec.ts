import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FcmService } from './fcm.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import { createMockRedis } from '../__mocks__/redis.mock';

// Mock firebase-admin before importing anything that uses it
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  messaging: jest.fn().mockReturnValue({
    sendEachForMulticast: jest.fn(),
  }),
}));

jest.mock('../../config/firebase-credential', () => ({
  resolveFirebaseCredential: jest.fn().mockReturnValue(null),
}));

import * as admin from 'firebase-admin';

describe('FcmService', () => {
  let service: FcmService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let redis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    redis = createMockRedis();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcmService,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    service = module.get<FcmService>(FcmService);

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // registerDevice()
  // =========================================================================
  describe('registerDevice()', () => {
    it('should upsert device token when registerDevice() is called', async () => {
      const device = {
        id: 'd1',
        userId: 'u1',
        token: 'tok',
        platform: 'android',
      };
      prisma.deviceToken.upsert.mockResolvedValue(device);

      const result = await service.registerDevice('u1', 'tok', 'android');

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'tok' },
        update: { userId: 'u1', platform: 'android' },
        create: { userId: 'u1', token: 'tok', platform: 'android' },
      });
      expect(result).toEqual(device);
    });
  });

  // =========================================================================
  // removeDevice()
  // =========================================================================
  describe('removeDevice()', () => {
    it('should delete device token when removeDevice() is called', async () => {
      prisma.deviceToken.delete.mockResolvedValue({});

      await service.removeDevice('tok');

      expect(prisma.deviceToken.delete).toHaveBeenCalledWith({
        where: { token: 'tok' },
      });
    });

    it('should not throw when token does not exist in removeDevice()', async () => {
      prisma.deviceToken.delete.mockRejectedValue(new Error('not found'));

      await expect(service.removeDevice('tok')).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // sendPushToUser()
  // =========================================================================
  describe('sendPushToUser()', () => {
    it('should return early when not initialized in sendPushToUser()', async () => {
      // isInitialized is false because fs.existsSync returns false
      await service.sendPushToUser('u1', 'Title', 'Body');

      expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
    });

    it('should send push and cleanup invalid tokens when sendPushToUser() is initialized', async () => {
      // Force isInitialized to true
      (service as any).isInitialized = true;

      prisma.deviceToken.findMany.mockResolvedValue([
        { token: 'tok1' },
        { token: 'tok2' },
      ]);

      const mockSendResult = {
        responses: [
          { success: true },
          {
            success: false,
            error: { code: 'messaging/invalid-registration-token' },
          },
        ],
      };
      (admin.messaging as jest.Mock).mockReturnValue({
        sendEachForMulticast: jest.fn().mockResolvedValue(mockSendResult),
      });

      await service.sendPushToUser('u1', 'Title', 'Body', { key: 'val' });

      expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      // Should attempt to remove invalid token (tok2)
      expect(prisma.deviceToken.delete).toHaveBeenCalledWith({
        where: { token: 'tok2' },
      });
    });

    it('should return early when user has no devices in sendPushToUser()', async () => {
      (service as any).isInitialized = true;
      prisma.deviceToken.findMany.mockResolvedValue([]);

      await service.sendPushToUser('u1', 'Title', 'Body');

      expect(admin.messaging).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // sendPushToOfflineParticipants()
  // =========================================================================
  describe('sendPushToOfflineParticipants()', () => {
    it('should return early when not initialized in sendPushToOfflineParticipants()', async () => {
      await service.sendPushToOfflineParticipants('c1', 'u1', 'User', 'Hello');

      expect(prisma.participant.findMany).not.toHaveBeenCalled();
    });

    it('should filter offline users via Redis mget and send push when sendPushToOfflineParticipants() is called', async () => {
      (service as any).isInitialized = true;

      prisma.participant.findMany.mockResolvedValue([
        { userId: 'u2' },
        { userId: 'u3' },
      ]);
      // u2 is online (has presence), u3 is offline (null)
      redis.mget.mockResolvedValue(['online', null]);

      // Mock sendPushToUser to avoid deep calls
      const spySend = jest
        .spyOn(service, 'sendPushToUser')
        .mockResolvedValue(undefined);

      await service.sendPushToOfflineParticipants('c1', 'u1', 'User', 'Hello');

      expect(redis.mget).toHaveBeenCalledWith(['presence:u2', 'presence:u3']);
      // Only u3 (offline) should receive push
      expect(spySend).toHaveBeenCalledTimes(1);
      expect(spySend).toHaveBeenCalledWith('u3', 'User', 'Hello', {
        conversationId: 'c1',
        type: 'new_message',
      });

      spySend.mockRestore();
    });
  });
});
