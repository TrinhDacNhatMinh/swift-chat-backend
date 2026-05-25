import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { resolveFirebaseCredential } from '../../config/firebase-credential';

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private isInitialized = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const resolved = resolveFirebaseCredential(this.configService);
      if (!resolved) {
        this.logger.warn(
          'Firebase credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or legacy serviceAccount.json). FCM push notifications are disabled.',
        );
        return;
      }

      if (resolved.source === 'legacy-file') {
        this.logger.warn(
          'serviceAccount.json is deprecated. Prefer FIREBASE_* environment variables.',
        );
      }

      admin.initializeApp({
        credential: admin.credential.cert(resolved.credential),
      });
      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin', error);
    }
  }

  async registerDevice(userId: string, token: string, platform: string) {
    return await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
  }

  async removeDevice(token: string) {
    try {
      await this.prisma.deviceToken.delete({ where: { token } });
    } catch {
      // Ignore if not exists
    }
  }

  async sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: any,
  ) {
    if (!this.isInitialized) return;

    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
    });

    if (devices.length === 0) return;

    const tokens = devices.map((d) => d.token);

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title,
          body,
        },
        data: data || {},
      });

      // Cleanup invalid tokens
      response.responses.forEach((res, idx) => {
        if (!res.success && res.error) {
          if (
            res.error.code === 'messaging/invalid-registration-token' ||
            res.error.code === 'messaging/registration-token-not-registered'
          ) {
            void this.removeDevice(tokens[idx]);
          }
        }
      });
    } catch (error) {
      this.logger.error(`Error sending push to user ${userId}`, error);
    }
  }

  async sendPushToOfflineParticipants(
    conversationId: string,
    senderId: string,
    senderName: string,
    messageContent: string,
  ) {
    if (!this.isInitialized) return;

    const participants = await this.prisma.participant.findMany({
      where: { conversationId, userId: { not: senderId } },
      select: { userId: true },
    });

    if (participants.length === 0) return;

    // Single MGET call instead of N sequential GETs — O(1) round-trips to Redis
    const presenceKeys = participants.map((p) => `presence:${p.userId}`);
    const presenceResults = await this.redisClient.mget(presenceKeys);

    const pushPromises = participants
      .filter((_, idx) => !presenceResults[idx]) // Keep only offline users
      .map((p) =>
        this.sendPushToUser(p.userId, senderName, messageContent, {
          conversationId,
          type: 'new_message',
        }),
      );

    await Promise.allSettled(pushPromises);
  }
}
