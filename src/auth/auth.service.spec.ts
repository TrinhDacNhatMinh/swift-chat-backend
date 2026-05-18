import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrismaService } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// External library mocks
// ---------------------------------------------------------------------------
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
import * as bcrypt from 'bcrypt';

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockUser = (overrides: Record<string, any> = {}) => ({
  id: 'user-1',
  email: 'test@test.com',
  username: 'testuser',
  passwordHash: 'hashed-pw',
  authProvider: 'local',
  providerId: null,
  avatarUrl: null,
  createdAt: new Date(),
  lastSeen: null,
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let userService: Record<string, jest.Mock>;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let jwtService: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    userService = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
      verify: jest.fn(),
      decode: jest
        .fn()
        .mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    };

    configService = {
      get: jest.fn().mockReturnValue('config-value'),
      getOrThrow: jest.fn().mockReturnValue('config-value'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // register()
  // =========================================================================
  describe('register()', () => {
    const dto = {
      username: 'newuser',
      email: 'new@test.com',
      password: 'password123',
    };

    it('should throw if email already in use', async () => {
      userService.findByEmail.mockResolvedValue(mockUser());

      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
      await expect(service.register(dto)).rejects.toThrow(
        'Email already in use',
      );
    });

    it('should throw if username already taken', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.findByUsername.mockResolvedValue(mockUser());

      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
      await expect(service.register(dto)).rejects.toThrow(
        'Username already taken',
      );
    });

    it('should hash password with salt rounds 10 and create user', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.findByUsername.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      userService.create.mockResolvedValue(
        mockUser({ id: 'new-id', email: dto.email }),
      );
      prisma.refreshToken.create.mockResolvedValue({});

      await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: dto.email,
          username: dto.username,
          passwordHash: 'hashed-pw',
          authProvider: 'local',
        }),
      );
    });

    it('should return access token, refresh token, and user info', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.findByUsername.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      const createdUser = mockUser({ id: 'new-id', email: dto.email });
      userService.create.mockResolvedValue(createdUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register(dto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user).toEqual({ id: 'new-id', email: dto.email });
      // signAsync called twice: accessToken + refreshToken
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // login()
  // =========================================================================
  describe('login()', () => {
    const dto = { username: 'testuser', password: 'password123' };

    it('should throw if user not found', async () => {
      userService.findByUsername.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if user uses non-local auth provider', async () => {
      userService.findByUsername.mockResolvedValue(
        mockUser({ authProvider: 'google', passwordHash: null }),
      );

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw if password is invalid', async () => {
      userService.findByUsername.mockResolvedValue(mockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return token pair on successful login', async () => {
      const user = mockUser();
      userService.findByUsername.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(dto);

      expect(bcrypt.compare).toHaveBeenCalledWith(
        dto.password,
        user.passwordHash,
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  // =========================================================================
  // refreshToken()
  // =========================================================================
  describe('refreshToken()', () => {
    const dto = { refreshToken: 'old-refresh-token' };

    it('should throw if token verification fails', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('expired');
      });

      await expect(service.refreshToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if token not found in DB (revoked)', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@test.com',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete old token and return new pair on success', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@test.com',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        token: dto.refreshToken,
      });
      prisma.refreshToken.delete.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refreshToken(dto);

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: dto.refreshToken },
      });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  // =========================================================================
  // googleLogin()
  // =========================================================================
  describe('googleLogin()', () => {
    const dto = { idToken: 'google-id-token' };

    it('should throw if Google token is invalid', async () => {
      // Access the internal googleClient and make verifyIdToken throw
      (service as any).googleClient.verifyIdToken.mockRejectedValue(
        new Error('invalid'),
      );

      await expect(service.googleLogin(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw if Google payload has no email', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => null,
      });

      await expect(service.googleLogin(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if email is registered via another method', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@test.com',
          sub: 'google-123',
          name: 'Test',
          picture: 'http://avatar.jpg',
        }),
      });
      userService.findByEmail.mockResolvedValue(
        mockUser({ authProvider: 'local' }),
      );

      await expect(service.googleLogin(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return token pair for existing Google user', async () => {
      const googleUser = mockUser({ authProvider: 'google' });
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: googleUser.email,
          sub: 'google-123',
          name: 'Test',
          picture: 'http://avatar.jpg',
        }),
      });
      userService.findByEmail.mockResolvedValue(googleUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(userService.create).not.toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should create new user with unique username for new Google user', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'newgoogle@test.com',
          sub: 'google-456',
          name: 'New User',
          picture: 'http://pic.jpg',
        }),
      });
      userService.findByEmail.mockResolvedValue(null);
      // First username attempt exists, second succeeds
      userService.findByUsername
        .mockResolvedValueOnce(mockUser())
        .mockResolvedValueOnce(null);
      const createdUser = mockUser({
        id: 'new-google-id',
        email: 'newgoogle@test.com',
      });
      userService.create.mockResolvedValue(createdUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authProvider: 'google',
          email: 'newgoogle@test.com',
        }),
      );
      expect(result).toHaveProperty('accessToken');
    });
  });

  // =========================================================================
  // logout()
  // =========================================================================
  describe('logout()', () => {
    it('should delete specific session when refreshToken provided', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout('user-1', {
        refreshToken: 'token-abc',
      });

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'token-abc', userId: 'user-1' },
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw if token does not exist (count 0)', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.logout('user-1', { refreshToken: 'invalid-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should delete all sessions when no refreshToken provided', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.logout('user-1');

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result).toEqual({ success: true });
    });
  });

  // =========================================================================
  // generateTokenPair() — tested indirectly via register/login
  // =========================================================================
  describe('generateTokenPair (indirect)', () => {
    it('should sign accessToken and refreshToken with correct secrets', async () => {
      userService.findByUsername.mockResolvedValue(mockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      await service.login({ username: 'testuser', password: 'pass' });

      // First call = accessToken, second = refreshToken
      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1' }),
        expect.objectContaining({ secret: 'config-value' }),
      );
    });

    it('should persist refresh token to database', async () => {
      userService.findByUsername.mockResolvedValue(mockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      await service.login({ username: 'testuser', password: 'pass' });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          token: 'mock-token',
          expiresAt: expect.any(Date),
        }),
      });
    });
  });
});
