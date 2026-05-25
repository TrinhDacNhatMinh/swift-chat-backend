import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Purge expired refresh tokens from the database every day at 3:00 AM.
   * Prevents the refresh_tokens table from growing unbounded.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredRefreshTokens() {
    try {
      const result = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      if (result.count > 0) {
        this.logger.log(`Purged ${result.count} expired refresh token(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to purge expired refresh tokens', error);
    }
  }
}
