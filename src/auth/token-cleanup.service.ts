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

  /**
   * Purge unverified accounts that are older than 24 hours every day at 4:00 AM.
   * Prevents username squatting and database bloat.
   */
  @Cron('0 4 * * *')
  async purgeUnverifiedAccounts() {
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await this.prisma.account.deleteMany({
        where: {
          isEmailVerified: false,
          createdAt: { lt: yesterday },
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Purged ${result.count} unverified account(s) older than 24 hours`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to purge unverified accounts', error);
    }
  }
}
