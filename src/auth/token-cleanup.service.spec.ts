import { Test, TestingModule } from '@nestjs/testing';
import { TokenCleanupService } from './token-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let prisma: Record<string, any>;

  beforeEach(async () => {
    prisma = {
      refreshToken: {
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenCleanupService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TokenCleanupService>(TokenCleanupService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('purgeExpiredRefreshTokens', () => {
    it('should delete expired tokens and log success if items were purged', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 5 });
      const loggerLogSpy = jest.spyOn((service as any).logger, 'log');

      await service.purgeExpiredRefreshTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
      expect(loggerLogSpy).toHaveBeenCalledWith('Purged 5 expired refresh token(s)');
    });

    it('should not log count if zero items were purged', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
      const loggerLogSpy = jest.spyOn((service as any).logger, 'log');

      await service.purgeExpiredRefreshTokens();

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
      expect(loggerLogSpy).not.toHaveBeenCalled();
    });

    it('should catch errors and log error if deletion fails', async () => {
      const error = new Error('Database connection failed');
      prisma.refreshToken.deleteMany.mockRejectedValue(error);
      const loggerErrorSpy = jest.spyOn((service as any).logger, 'error');

      await service.purgeExpiredRefreshTokens();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to purge expired refresh tokens',
        error,
      );
    });
  });
});
