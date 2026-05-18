import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from '../../user/user.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let userService: Record<string, jest.Mock>;

  beforeEach(async () => {
    userService = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: UserService, useValue: userService },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test-secret') },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should return user payload when user exists', async () => {
    userService.findById.mockResolvedValue({ id: 'u1', email: 'e@e.com' });

    const result = await strategy.validate({ sub: 'u1', email: 'e@e.com' });

    expect(userService.findById).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'u1', email: 'e@e.com' });
  });

  it('should throw UnauthorizedException when user does not exist', async () => {
    userService.findById.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'gone', email: 'e@e.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
