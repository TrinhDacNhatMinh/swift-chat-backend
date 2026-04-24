import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, LoginTicket } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Prisma, Account } from '@prisma/client';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  TokenPairResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';
import { SuccessMessageResponseDto } from '../common/dto/success-response.dto';
import { CONFIG_KEYS } from '../common/constants/config.constants';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;
  // Removed logger per SEC-04

  constructor(
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>(CONFIG_KEYS.GOOGLE_CLIENT_ID),
    );
  }

  /**
   * Register a new account with email/password.
   * Creates an unverified account and dispatches a 6-digit OTP via email.
   * If the email already exists but is unverified, re-creates the account
   * overwriting the old data (idempotent re-registration).
   * @throws {BadRequestException} if email or username is already taken by a verified account
   */
  async register(registerDto: RegisterDto): Promise<RegisterResponseDto> {
    const { email, username, password } = registerDto;

    const existingAccountByEmail = await this.prisma.account.findUnique({
      where: { email },
      include: { profile: true, authProviders: true },
    });

    if (existingAccountByEmail) {
      if (existingAccountByEmail.isEmailVerified) {
        const hasPassword = existingAccountByEmail.authProviders.some(
          (p) => p.provider === 'password',
        );
        if (hasPassword) {
          throw new BadRequestException('Email already in use');
        }
      }

      // Overwrite unverified account: check username conflict against other accounts
      const existingByUsername = await this.prisma.account.findUnique({
        where: { username },
      });
      if (
        existingByUsername &&
        existingByUsername.id !== existingAccountByEmail.id
      ) {
        throw new BadRequestException('Username already taken');
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const { rawOtp, otpHash, expiresAt } = this.generateOtp();

      try {
        const txOps: Prisma.PrismaPromise<any>[] = [
          this.prisma.account.update({
            where: { id: existingAccountByEmail.id },
            data: { passwordHash, username },
          }),
          this.prisma.emailVerificationOtp.upsert({
            where: { accountId: existingAccountByEmail.id },
            update: {
              otpHash,
              expiresAt,
              attempts: 0,
              usedAt: null,
            },
            create: {
              accountId: existingAccountByEmail.id,
              otpHash,
              expiresAt,
            },
          }),
        ];
        await this.prisma.$transaction(txOps);
      } catch (error: unknown) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException('Username or email already taken');
        }
        throw error;
      }

      await this.mailService.sendEmailVerificationOtp(email, rawOtp);
      return {
        success: true,
        message: 'Registration successful. Please verify your email.',
        data: {
          account: {
            id: existingAccountByEmail.id,
            email: existingAccountByEmail.email,
            isVerified: false,
            createdAt: existingAccountByEmail.createdAt,
          },
          expiresIn: 600,
        },
      };
    }

    const existingUserByUsername = await this.prisma.account.findUnique({
      where: { username },
    });
    if (existingUserByUsername) {
      throw new BadRequestException('Username already taken');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rawOtp, otpHash, expiresAt } = this.generateOtp();

    const account = await this.prisma.$transaction(async (tx) => {
      const newAccount = await this.userService.create(
        {
          email,
          username,
          passwordHash,
          authProviders: [{ provider: 'password' }],
        },
        tx,
      );

      await tx.emailVerificationOtp.create({
        data: {
          accountId: newAccount.id,
          otpHash,
          expiresAt,
        },
      });

      return newAccount;
    });

    try {
      await this.mailService.sendEmailVerificationOtp(email, rawOtp);
    } catch (error: unknown) {
      console.error(
        `Failed to send verification email to ${email}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      success: true,
      message: 'Registration successful. Please verify your email.',
      data: {
        account: {
          id: account.id,
          email: account.email,
          isVerified: false,
          createdAt: account.createdAt,
        },
        expiresIn: 600,
      },
    };
  }

  /**
   * Authenticate with username + password.
   * @throws {UnauthorizedException} if credentials are invalid
   * @throws {ForbiddenException} with code EMAIL_NOT_VERIFIED if account is pending verification
   */
  async login(loginDto: LoginDto): Promise<TokenPairResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { username: loginDto.username },
      include: { authProviders: true },
    });

    if (!account) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const hasPasswordProvider = account.authProviders.some(
      (p) => p.provider === 'password',
    );
    if (!hasPasswordProvider) {
      throw new BadRequestException(
        'This account is registered via Google. Please login with Google',
      );
    }

    if (!account.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!account.isEmailVerified) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      account.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokenPair(account);
  }

  /**
   * Rotate the refresh token pair.
   * Verifies the incoming refresh token, deletes the old DB record (token rotation
   * prevents replay attacks), then issues a fresh token pair.
   * @throws {UnauthorizedException} if the token is invalid, expired, or already revoked
   */
  async refreshToken(dto: RefreshTokenDto): Promise<TokenPairResponseDto> {
    const { refreshToken } = dto;

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.getOrThrow<string>(
          CONFIG_KEYS.JWT_REFRESH_SECRET,
        ),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken) {
      throw new UnauthorizedException(
        'Refresh token has been revoked or is invalid',
      );
    }

    await this.prisma.refreshToken.delete({ where: { token: refreshToken } });

    const account = await this.prisma.account.findUnique({
      where: { id: payload.sub },
    });

    if (!account) {
      throw new UnauthorizedException('Account not found');
    }

    return this.generateTokenPair(account);
  }
  /**
   * Sign in or auto-register via Google ID token.
   * - Existing Google provider → issue new token pair
   * - Email exists (verified) → link Google provider to account
   * - Email exists (unverified) → upgrade to Google-verified account
   * - No account → create a new account with username derived from email
   */
  async googleLogin(
    googleAuthDto: GoogleAuthDto,
  ): Promise<TokenPairResponseDto> {
    const { email, providerUserId, name, picture } =
      await this.verifyGoogleToken(googleAuthDto.idToken);

    const existingProvider = await this.prisma.authProvider.findUnique({
      where: {
        provider_providerUserId: { provider: 'google', providerUserId },
      },
      include: { account: true },
    });

    if (existingProvider) {
      return this.generateTokenPair(existingProvider.account);
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await this.resolveGoogleAccount(
        tx,
        email,
        providerUserId,
        name,
        picture,
      );
      return this.generateTokenPair(account, tx);
    });
  }

  /**
   * Verify the Google ID token and extract the normalized payload.
   * @throws {UnauthorizedException} if the token is invalid or missing email
   */
  private async verifyGoogleToken(idToken: string): Promise<{
    email: string;
    providerUserId: string;
    name: string | undefined;
    picture: string | undefined;
  }> {
    let ticket: LoginTicket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: this.configService.get<string>(CONFIG_KEYS.GOOGLE_CLIENT_ID),
      });
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google payload');
    }

    return {
      email: payload.email,
      providerUserId: payload.sub,
      name: payload.name,
      picture: payload.picture,
    };
  }

  /**
   * Within a transaction, link or create an account for a Google-authenticated user.
   * - Email verified → link google provider
   * - Email unverified → upgrade account to google-verified
   * - No account → create new account
   */
  private async resolveGoogleAccount(
    tx: Prisma.TransactionClient,
    email: string,
    providerUserId: string,
    name: string | undefined,
    picture: string | undefined,
  ): Promise<Pick<Account, 'id' | 'email'>> {
    let account = await tx.account.findUnique({ where: { email } });

    if (account) {
      if (account.isEmailVerified) {
        await tx.authProvider.create({
          data: { accountId: account.id, provider: 'google', providerUserId },
        });
      } else {
        await tx.account.update({
          where: { id: account.id },
          data: {
            passwordHash: null,
            isEmailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.authProvider.deleteMany({
          where: { accountId: account.id, provider: 'password' },
        });
        await tx.authProvider.create({
          data: { accountId: account.id, provider: 'google', providerUserId },
        });
      }
    } else {
      const username = await this.generateGoogleUsername(email);
      account = await this.userService.create(
        {
          email,
          username,
          displayName: name || username,
          avatarUrl: picture,
          isEmailVerified: true,
          authProviders: [{ provider: 'google', providerUserId }],
        },
        tx,
      );
    }

    return account;
  }

  /**
   * Derive a unique username from a Google email address.
   * If the base name is taken, appends a 4-digit random suffix.
   */
  private async generateGoogleUsername(email: string): Promise<string> {
    const base = email.split('@')[0];
    const taken = await this.userService.findByUsername(base);
    return taken ? `${base}${Math.floor(1000 + Math.random() * 9000)}` : base;
  }

  private async generateTokenPair(
    account: Pick<Account, 'id' | 'email'>,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<TokenPairResponseDto> {
    const accessPayload: JwtPayload = {
      sub: account.id,
      email: account.email,
      jti: crypto.randomUUID(),
    };
    const refreshPayload: JwtPayload = {
      sub: account.id,
      email: account.email,
      jti: crypto.randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.get<string>(CONFIG_KEYS.JWT_ACCESS_SECRET),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get<string>(CONFIG_KEYS.JWT_REFRESH_SECRET),
        expiresIn: '7d',
      }),
    ]);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await tx.refreshToken.create({
      data: {
        accountId: account.id,
        token: refreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      account: {
        id: account.id,
        email: account.email,
      },
    };
  }

  async logout(
    accountId: string,
    refreshToken?: string,
  ): Promise<SuccessMessageResponseDto> {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { accountId, token: refreshToken },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({
        where: { accountId },
      });
    }

    // Update lastSeen and clear profile cache on logout
    await this.userService.updateLastSeen(accountId);

    return { success: true, message: 'Logged out successfully' };
  }

  async resendVerificationOtp(
    email: string,
  ): Promise<SuccessMessageResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { email },
    });

    if (!account) {
      // Return success silently to avoid leaking account existence
      return { success: true, message: 'Verification OTP sent' };
    }

    if (account.isEmailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const record = await this.prisma.emailVerificationOtp.findUnique({
      where: { accountId: account.id },
    });

    if (record) {
      const timeDiff = Date.now() - record.updatedAt.getTime();
      // Bypass the 60s cooldown when the account is locked (>= 5 failed attempts)
      if (timeDiff < 60_000 && record.attempts < 5) {
        throw new BadRequestException(
          'Please wait 60 seconds before requesting a new code',
        );
      }
    }

    const { rawOtp, otpHash, expiresAt } = this.generateOtp();

    await this.prisma.emailVerificationOtp.upsert({
      where: { accountId: account.id },
      update: {
        otpHash,
        expiresAt,
        attempts: 0,
        usedAt: null,
      },
      create: {
        accountId: account.id,
        otpHash,
        expiresAt,
      },
    });

    try {
      await this.mailService.sendEmailVerificationOtp(account.email, rawOtp);
    } catch (error: unknown) {
      console.error(
        `Failed to resend verification email to ${account.email}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException('Failed to send email. Try again later.');
    }

    return { success: true, message: 'Verification OTP sent' };
  }

  /**
   * Verify the 6-digit OTP and activate the account.
   * Tracks failed attempts and locks the record after 5 consecutive failures.
   * Issues a token pair immediately upon success so the user is logged in.
   * @throws {BadRequestException} if OTP is invalid, expired, already used, or account is locked
   */
  async verifyEmail(email: string, otp: string): Promise<TokenPairResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { email },
      include: { authProviders: true },
    });

    if (!account) {
      throw new BadRequestException('Invalid request');
    }
    if (account.isEmailVerified) {
      throw new BadRequestException('Email already verified');
    }

    const record = await this.prisma.emailVerificationOtp.findUnique({
      where: { accountId: account.id },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    if (record.attempts >= 5) {
      throw new BadRequestException(
        'Account temporarily locked. Please request a new verification email.',
      );
    }

    const otpSecret = this.configService.getOrThrow<string>(
      CONFIG_KEYS.OTP_SECRET,
    );
    const otpHash = crypto
      .createHmac('sha256', otpSecret)
      .update(otp)
      .digest('hex');

    if (record.otpHash !== otpHash) {
      // Atomic increment: only increment if attempts < 5, preventing TOCTOU race.
      const updated = await this.prisma.emailVerificationOtp.updateMany({
        where: { id: record.id, attempts: { lt: 5 } },
        data: { attempts: { increment: 1 } },
      });
      if (updated.count === 0) {
        // Race was lost or already at limit — treat as locked
        throw new BadRequestException(
          'Account temporarily locked. Please request a new verification email.',
        );
      }
      const remaining = 5 - (record.attempts + 1);
      if (remaining <= 0) {
        throw new BadRequestException(
          'You have entered incorrectly more than 5 times. Please request a new verification email.',
        );
      }
      throw new BadRequestException(
        `Invalid verification code. You have ${remaining} attempts left.`,
      );
    }

    const hasPasswordProvider = account.authProviders.some(
      (p) => p.provider === 'password',
    );
    const txOps: Prisma.PrismaPromise<any>[] = [
      this.prisma.emailVerificationOtp.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.account.update({
        where: { id: account.id },
        data: {
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
        },
      }),
    ];

    if (!hasPasswordProvider) {
      txOps.push(
        this.prisma.authProvider.create({
          data: { accountId: account.id, provider: 'password' },
        }),
      );
    }

    await this.prisma.$transaction(txOps);

    return this.generateTokenPair(account);
  }

  /**
   * Send a password-reset email.
   * Returns success regardless of whether the email exists to prevent email enumeration.
   * @throws {BadRequestException} if the account uses Google-only login (no password provider)
   */
  private generateOtp(): { rawOtp: string; otpHash: string; expiresAt: Date } {
    const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpSecret = this.configService.getOrThrow<string>(
      CONFIG_KEYS.OTP_SECRET,
    );
    const otpHash = crypto
      .createHmac('sha256', otpSecret)
      .update(rawOtp)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    return { rawOtp, otpHash, expiresAt };
  }
}
