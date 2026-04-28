import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { CONFIG_KEYS } from '../common/constants/config.constants';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>(
        CONFIG_KEYS.MAIL_HOST,
        'smtp.gmail.com',
      ),
      port: this.configService.get<number>(CONFIG_KEYS.MAIL_PORT, 587),
      secure: false, // true for port 465, false for other ports
      auth: {
        user: this.configService.get<string>(CONFIG_KEYS.MAIL_USER),
        pass: this.configService.get<string>(CONFIG_KEYS.MAIL_PASS),
      },
    });
  }

  private get fromAddress(): string {
    return this.configService.get<string>(
      CONFIG_KEYS.MAIL_FROM,
      'SwiftChat <noreply@swiftchat.app>',
    );
  }

  async sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
    const frontendUrl = this.configService.get<string>(
      CONFIG_KEYS.FRONTEND_URL,
      'http://localhost:3000',
    );
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: 'Reset your SwiftChat password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Reset Your Password</h2>
            <p>You requested a password reset for your SwiftChat account.</p>
            <p>Click the button below to reset your password. This link expires in <strong>15 minutes</strong>.</p>
            <a href="${resetLink}"
               style="display: inline-block; padding: 12px 24px; background-color: #4F46E5;
                      color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">
              Reset Password
            </a>
            <p style="color: #6B7280; font-size: 14px;">
              If you did not request this, please ignore this email. Your password will not change.
            </p>
            <p style="color: #6B7280; font-size: 12px;">
              Or copy this link: <a href="${resetLink}">${resetLink}</a>
            </p>
          </div>
        `,
      });
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        error,
      );
      throw error;
    }
  }

  async sendEmailVerificationOtp(email: string, otp: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: email,
        subject: 'Verify your SwiftChat email',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Verify Your Email</h2>
            <p>Welcome to SwiftChat! Please use the code below to verify your email address.</p>
            <div style="text-align: center; margin: 32px 0;">
              <span style="font-size: 40px; font-weight: bold; letter-spacing: 8px;
                           color: #4F46E5; background: #EEF2FF; padding: 16px 24px;
                           border-radius: 8px;">
                ${otp}
              </span>
            </div>
            <p style="color: #6B7280; font-size: 14px;">
              This code expires in <strong>10 minutes</strong>.
            </p>
            <p style="color: #6B7280; font-size: 14px;">
              If you did not create a SwiftChat account, please ignore this email.
            </p>
          </div>
        `,
      });
      this.logger.log(`Email verification OTP sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification OTP to ${email}`, error);
      throw error;
    }
  }
}
