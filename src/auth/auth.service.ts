import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, LoginTicket } from 'google-auth-library';
import * as bcrypt from 'bcrypt';
import { UserService } from '../user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private googleClient: OAuth2Client;

  constructor(
    private userService: UserService,
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.get<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async register(registerDto: RegisterDto) {
    // Check if user exists
    const existingUserByEmail = await this.userService.findByEmail(
      registerDto.email,
    );
    if (existingUserByEmail) {
      throw new BadRequestException('Email already in use');
    }
    const existingUserByUsername = await this.userService.findByUsername(
      registerDto.username,
    );
    if (existingUserByUsername) {
      throw new BadRequestException('Username already taken');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    // Create user
    const user = await this.userService.create({
      email: registerDto.email,
      username: registerDto.username,
      passwordHash,
      authProvider: 'local',
    });

    return this.generateTokenPair(user.id, user.email);
  }

  async login(loginDto: LoginDto) {
    const user = await this.userService.findByUsername(loginDto.username);
    if (!user || user.authProvider !== 'local' || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokenPair(user.id, user.email);
  }

  async refreshToken(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken } = refreshTokenDto;

    // 1. Verify token signature and expiration
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 2. Check if token exists in database (stateful validation)
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
    });

    if (!storedToken) {
      throw new UnauthorizedException(
        'Refresh token has been revoked or is invalid',
      );
    }

    // 3. Issue new tokens
    // Optionally: implement rotation by deleting the old token
    await this.prisma.refreshToken.delete({ where: { token: refreshToken } });

    return this.generateTokenPair(payload.sub, payload.email);
  }

  async googleLogin(googleAuthDto: GoogleAuthDto) {
    let ticket: LoginTicket;
    try {
      ticket = await this.googleClient.verifyIdToken({
        idToken: googleAuthDto.idToken,
        audience: this.configService.get<string>('GOOGLE_CLIENT_ID'),
      });
    } catch {
      throw new UnauthorizedException('Invalid Google token');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new BadRequestException('Invalid Google payload');
    }

    const { email, sub: providerId, picture } = payload;

    // Check if user already exists
    let user = await this.userService.findByEmail(email);

    if (user) {
      // If user exists but registered via local or other provider, we might want to link or reject
      // For simplicity, we just log them in if email matches, or you can strictly check authProvider
      if (user.authProvider !== 'google') {
        throw new BadRequestException(
          'Email is already registered via another method',
        );
      }
    } else {
      // Create new user with a unique username derived from the email
      const baseUsername = email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();

      // Retry loop: handles concurrent requests that might claim the same username
      const MAX_RETRIES = 5;
      let username = baseUsername;
      let attempt = 0;

      while (attempt < MAX_RETRIES) {
        try {
          user = await this.userService.create({
            email,
            username,
            authProvider: 'google',
            providerId,
            avatarUrl: picture,
          });
          break; // success — exit loop
        } catch (error: any) {
          // P2002 = unique constraint violation (username taken)
          if (error?.code === 'P2002') {
            attempt++;
            username = `${baseUsername}${attempt}`;
          } else {
            throw error;
          }
        }
      }

      if (!user) {
        throw new BadRequestException(
          'Unable to generate a unique username. Please try again.',
        );
      }
    }

    return this.generateTokenPair(user.id, user.email);
  }

  async logout(userId: string, refreshTokenDto?: RefreshTokenDto) {
    if (refreshTokenDto && refreshTokenDto.refreshToken) {
      // Delete specific token and get the result
      const result = await this.prisma.refreshToken.deleteMany({
        where: {
          token: refreshTokenDto.refreshToken,
          userId: userId,
        },
      });

      // If count is 0, the token didn't exist (already logged out)
      if (result.count === 0) {
        throw new BadRequestException('Invalid token or already logged out');
      }
    } else {
      // Delete all tokens for this user (logout from all devices)
      await this.prisma.refreshToken.deleteMany({
        where: { userId },
      });
    }
    return { success: true };
  }

  private async generateTokenPair(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as any,
      }),
      this.jwtService.signAsync(
        { ...payload, jti: crypto.randomUUID() },
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.getOrThrow<string>(
            'JWT_REFRESH_EXPIRES_IN',
          ) as any,
        },
      ),
    ]);

    // Parse expiration string to Date object for DB
    // A simple approach: verify the token we just created to get the exp timestamp
    const decoded = this.jwtService.decode(refreshToken);
    if (!decoded || typeof decoded.exp !== 'number') {
      throw new Error('Failed to decode refresh token expiration');
    }
    const expiresAt = new Date(decoded.exp * 1000);

    // Save refresh token to DB
    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email,
      },
    };
  }
}
