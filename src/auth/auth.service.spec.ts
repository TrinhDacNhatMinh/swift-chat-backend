import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { createMockPrismaService } from '../__mocks__/prisma.mock';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// External library mocks
// ---------------------------------------------------------------------------
jest.mock('../mail/mail.service');

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
  authProviders: [{ provider: 'password', providerUserId: null }],
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
  let mailService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    userService = {
      findByEmail: jest.fn(),
      findByUsername: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      updateLastSeen: jest.fn().mockResolvedValue(undefined),
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

    mailService = {
      sendPasswordResetEmail: jest.fn(),
      sendEmailVerificationOtp: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => jest.clearAllMocks());

  // register()

  describe('register()', () => {
    const dto = {
      username: 'newuser',
      email: 'new@test.com',
      password: 'password123',
    };

    it('should throw BadRequestException when email is already in use and verified', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({ isEmailVerified: true }),
      );

      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
      await expect(service.register(dto)).rejects.toThrow(
        'Email already in use',
      );
    });

    it('should throw BadRequestException when username is already taken', async () => {
      prisma.account.findUnique
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(mockUser({ id: 'other-id' })); // username check

      await expect(service.register(dto)).rejects.toThrow(BadRequestException);
    });

    it('should hash password and create account when valid registration data is provided', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      userService.create.mockResolvedValue(
        mockUser({ id: 'new-id', email: dto.email }),
      );

      await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: dto.email,
          username: dto.username,
          passwordHash: 'hashed-pw',
          authProviders: [{ provider: 'password' }],
        }),
        expect.anything(),
      );
    });

    it('should return success and account data when registration is successful', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      const createdUser = mockUser({ id: 'new-id', email: dto.email });
      userService.create.mockResolvedValue(createdUser);

      const result = await service.register(dto);

      expect(result).toHaveProperty('success', true);
      expect(result.data.account).toEqual({
        id: createdUser.id,
        email: createdUser.email,
        isVerified: false,
        createdAt: createdUser.createdAt,
      });
      expect(result.data.expiresIn).toBe(600);
    });

    it('should log error but return success if mailService fails to send OTP', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
      userService.create.mockResolvedValue(
        mockUser({ id: 'new-id', email: dto.email }),
      );

      const error = new Error('Mail server down');
      mailService.sendEmailVerificationOtp.mockRejectedValueOnce(error);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await service.register(dto);

      expect(result.success).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to send verification email to ${dto.email}`,
        error.stack,
      );

      consoleErrorSpy.mockRestore();
    });
  });

  // login()

  describe('login()', () => {
    const dto = { username: 'testuser', password: 'password123' };

    it('should throw UnauthorizedException when account does not exist', async () => {
      prisma.account.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException when account attempts to login without password provider', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({
          authProviders: [{ provider: 'google', providerUserId: '123' }],
          passwordHash: null,
        }),
      );

      await expect(service.login(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({ isEmailVerified: true }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return token pair when credentials are valid', async () => {
      const account = mockUser({ isEmailVerified: true });
      prisma.account.findUnique.mockResolvedValue(account);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login(dto);

      expect(bcrypt.compare).toHaveBeenCalledWith(
        dto.password,
        account.passwordHash,
      );
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  // refreshToken()

  describe('refreshToken()', () => {
    const dto = { refreshToken: 'old-refresh-token' };

    it('should throw UnauthorizedException when refresh token verification fails', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('expired');
      });

      await expect(service.refreshToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when refresh token is not found in database', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@test.com',
      });
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete old token and return new token pair when refresh token is valid', async () => {
      jwtService.verify.mockReturnValue({
        sub: 'user-1',
        email: 'test@test.com',
      });
      prisma.refreshToken.findUnique.mockResolvedValue({
        token: dto.refreshToken,
      });
      prisma.account.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@test.com',
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

  // googleAuth()

  describe('googleLogin()', () => {
    const dto = { idToken: 'google-id-token' };

    it('should throw UnauthorizedException when Google token verification fails', async () => {
      // Access the internal googleClient and make verifyIdToken throw
      (service as any).googleClient.verifyIdToken.mockRejectedValue(
        new Error('invalid'),
      );

      await expect(service.googleLogin(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw BadRequestException when Google token payload is missing email', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => null,
      });

      await expect(service.googleLogin(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should link google provider if account exists', async () => {
      const localUser = mockUser();
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'test@test.com',
          sub: 'google-123',
          name: 'Test',
          picture: 'http://avatar.jpg',
        }),
      });
      prisma.authProvider.findUnique.mockResolvedValue(null);
      prisma.account.findUnique.mockResolvedValue(localUser);
      prisma.authProvider.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(prisma.authProvider.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'google',
            providerUserId: 'google-123',
          }),
        }),
      );
      expect(result).toHaveProperty('accessToken');
    });

    it('should return token pair when Google account already exists', async () => {
      const googleUser = mockUser({
        authProviders: [{ provider: 'google', providerUserId: 'google-123' }],
      });
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: googleUser.email,
          sub: 'google-123',
          name: 'Test',
          picture: 'http://avatar.jpg',
        }),
      });
      prisma.authProvider.findUnique.mockResolvedValue({ account: googleUser });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(userService.create).not.toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
    });

    it('should create new account and return token pair when Google account is new', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'newgoogle@test.com',
          sub: 'google-456',
          name: 'New User',
          picture: 'http://pic.jpg',
        }),
      });
      prisma.authProvider.findUnique.mockResolvedValue(null);
      prisma.account.findUnique.mockResolvedValue(null);
      userService.findByUsername.mockResolvedValueOnce(null);
      const createdUser = mockUser({
        id: 'new-google-id',
        email: 'newgoogle@test.com',
      });
      userService.create.mockResolvedValue(createdUser);
      prisma.account.update.mockResolvedValue(createdUser);
      prisma.authProvider.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newgoogle@test.com',
          displayName: 'New User',
          isEmailVerified: true,
          authProviders: [{ provider: 'google', providerUserId: 'google-456' }],
        }),
        expect.anything(),
      );
      expect(result).toHaveProperty('accessToken');
    });

    it('should append random number to username if it already exists', async () => {
      (service as any).googleClient.verifyIdToken.mockResolvedValue({
        getPayload: () => ({
          email: 'race@test.com',
          sub: 'google-111',
          name: 'Race Condition',
          picture: 'http://race.jpg',
        }),
      });
      prisma.authProvider.findUnique.mockResolvedValue(null);
      prisma.account.findUnique.mockResolvedValue(null);
      userService.findByUsername.mockResolvedValue(mockUser()); // Username exists

      const createdUser = mockUser({
        id: 'race-google-id',
        email: 'race@test.com',
        username: 'race1234',
      });

      userService.create.mockResolvedValue(createdUser);
      prisma.account.update.mockResolvedValue(createdUser);
      prisma.authProvider.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.googleLogin(dto);

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: expect.stringMatching(/^race\d{4}$/),
        }),
        expect.anything(),
      );
      expect(result).toHaveProperty('accessToken');
    });
  });

  describe('logout()', () => {
    it('should delete specific session when a valid refresh token is provided during logout', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.logout('user-1', 'token-abc');

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'token-abc', accountId: 'user-1' },
      });
      expect(result).toEqual({ success: true, message: expect.any(String) });
    });

    it('should succeed even when provided refresh token does not exist', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.logout('user-1', 'invalid-token');

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'invalid-token', accountId: 'user-1' },
      });
      expect(result).toEqual({ success: true, message: expect.any(String) });
    });

    it('should delete all sessions when no refresh token is provided during logout', async () => {
      prisma.refreshToken.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.logout('user-1');

      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { accountId: 'user-1' },
      });
      expect(result).toEqual({ success: true, message: expect.any(String) });
    });
  });

  // generateTokenPair() — tested indirectly via register/login

  describe('generateTokenPair (indirect)', () => {
    it('should sign tokens with correct secrets when generating token pair', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({ isEmailVerified: true }),
      );
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

    it('should persist refresh token to database when generating token pair', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({ isEmailVerified: true }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      await service.login({ username: 'testuser', password: 'pass' });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accountId: 'user-1',
          token: 'mock-token',
          expiresAt: expect.any(Date),
        }),
      });
    });
  });

  // verifyEmail()

  describe('verifyEmail()', () => {
    it('should throw BadRequestException if account not found', async () => {
      prisma.account.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OTP is invalid or expired', async () => {
      prisma.account.findUnique.mockResolvedValue(
        mockUser({ isEmailVerified: false }),
      );
      prisma.emailVerificationOtp.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow('Invalid or expired verification code');
    });

    it('should throw BadRequestException if OTP has already been used', async () => {
      const account = mockUser({ isEmailVerified: false });
      prisma.account.findUnique.mockResolvedValue(account);
      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        id: 'otp1',
        accountId: account.id,
        otpHash: 'somehash',
        attempts: 0,
        expiresAt: new Date(Date.now() + 100000),
        usedAt: new Date(),
      });
      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow('Invalid or expired verification code');
    });

    it('should throw BadRequestException and lock account if attempts >= 5', async () => {
      const account = mockUser({ isEmailVerified: false });
      prisma.account.findUnique.mockResolvedValue(account);
      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        id: 'otp1',
        accountId: account.id,
        otpHash: 'somehash',
        attempts: 5,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow(
        'Account temporarily locked. Please request a new verification email.',
      );
    });

    it('should increment attempts and throw if OTP is incorrect', async () => {
      const account = mockUser({ isEmailVerified: false });
      prisma.account.findUnique.mockResolvedValue(account);
      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        id: 'otp1',
        accountId: account.id,
        otpHash: 'wronghash',
        attempts: 0,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.emailVerificationOtp.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow('Invalid verification code. You have 4 attempts left.');
      expect(prisma.emailVerificationOtp.updateMany).toHaveBeenCalledWith({
        where: { id: 'otp1', attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
    });

    it('should lock account after the 5th incorrect attempt', async () => {
      const account = mockUser({ isEmailVerified: false });
      prisma.account.findUnique.mockResolvedValue(account);
      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        id: 'otp1',
        accountId: account.id,
        otpHash: 'wronghash',
        attempts: 4,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.emailVerificationOtp.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.verifyEmail('test@test.com', '123456'),
      ).rejects.toThrow(
        'You have entered incorrectly more than 5 times. Please request a new verification email.',
      );
    });

    it('should verify email and return tokens when OTP is correct', async () => {
      const account = mockUser({ isEmailVerified: false });
      prisma.account.findUnique.mockResolvedValue(account);

      const otpSecret = 'config-value';
      const hash = crypto
        .createHmac('sha256', otpSecret)
        .update('123456')
        .digest('hex');

      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        id: 'otp1',
        accountId: account.id,
        otpHash: hash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 100000),
      });

      prisma.$transaction.mockResolvedValue([{}, {}]);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.verifyEmail('test@test.com', '123456');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  // resendVerificationOtp()

  describe('resendVerificationOtp()', () => {
    it('should throw BadRequestException if already verified', async () => {
      prisma.account.findUnique.mockResolvedValue({ isEmailVerified: true });
      await expect(
        service.resendVerificationOtp('test@test.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if cooldown not elapsed', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'u1',
        isEmailVerified: false,
        email: 'test@test.com',
      });
      prisma.emailVerificationOtp.findUnique.mockResolvedValue({
        updatedAt: new Date(),
        attempts: 0,
      });

      await expect(
        service.resendVerificationOtp('test@test.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should recreate OTP and send email', async () => {
      prisma.account.findUnique.mockResolvedValue({
        id: 'u1',
        isEmailVerified: false,
        email: 'test@test.com',
      });
      prisma.emailVerificationOtp.findUnique.mockResolvedValue(null);
      prisma.emailVerificationOtp.upsert.mockResolvedValue({});
      const mailService = service['mailService'] as any;

      const result = await service.resendVerificationOtp('test@test.com');
      expect(prisma.emailVerificationOtp.upsert).toHaveBeenCalled();
      expect(mailService.sendEmailVerificationOtp).toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: expect.any(String) });
    });
  });
});
