import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SuccessMessageResponseDto } from '../common/dto/success-response.dto';

@Injectable()
export class AuthPasswordService {
  // Removed logger per SEC-04

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Initiate password reset flow: generate a one-time token, persist its hash,
   * and send a reset link to the provided email address.
   * Returns a generic success response regardless of whether the email exists
   * to prevent account enumeration.
   */
  async forgotPassword(email: string): Promise<SuccessMessageResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { email },
      include: { authProviders: true },
    });
    if (!account) {
      return { success: true, message: 'If email exists, reset link sent.' };
    }

    const hasPasswordProvider = account.authProviders.some(
      (p) => p.provider === 'password',
    );
    if (!hasPasswordProvider) {
      throw new BadRequestException(
        'Password reset is only for accounts with a password login',
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({
        where: { accountId: account.id, usedAt: null },
      }),
      this.prisma.passwordResetToken.create({
        data: { accountId: account.id, token: tokenHash, expiresAt },
      }),
    ]);

    try {
      await this.mailService.sendPasswordResetEmail(account.email, rawToken);
    } catch (error: unknown) {
      console.error(
        `Failed to send password reset email to ${account.email}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException('Failed to send email. Try again later.');
    }

    return { success: true, message: 'If email exists, reset link sent.' };
  }

  /**
   * Consume a one-time password-reset token and update the password hash.
   * Invalidates all existing refresh tokens so other sessions are logged out.
   * @throws {BadRequestException} if the token is invalid, expired, or already used
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<SuccessMessageResponseDto> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const updateResult = await this.prisma.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (updateResult.count === 0) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: record.accountId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.deleteMany({
        where: { accountId: record.accountId },
      }),
    ]);

    return { success: true, message: 'Password reset successfully' };
  }
}
