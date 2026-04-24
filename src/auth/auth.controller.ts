import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import {
  TokenPairResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';
import { AuthService } from './auth.service';
import { AuthPasswordService } from './auth-password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { FcmService } from '../fcm/fcm.service';
import { RegisterDeviceDto } from '../fcm/dto/register-device.dto';
import { DeviceTokenResponseDto } from '../fcm/dto/device-token-response.dto';
import {
  AuthenticatedUser,
  SuccessResponse,
} from '../common/types/response.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly fcmService: FcmService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new local account and send verification OTP',
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: RegisterResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Email already exists' })
  register(@Body() registerDto: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Logged in successfully',
    type: TokenPairResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(@Body() loginDto: LoginDto): Promise<TokenPairResponseDto> {
    return this.authService.login(loginDto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login or register with Google OAuth token' })
  @ApiResponse({
    status: 200,
    description: 'Authenticated successfully',
    type: TokenPairResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  googleAuth(
    @Body() googleAuthDto: GoogleAuthDto,
  ): Promise<TokenPairResponseDto> {
    return this.authService.googleLogin(googleAuthDto);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get new access token using refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Tokens refreshed successfully',
    type: TokenPairResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<TokenPairResponseDto> {
    return this.authService.refreshToken(refreshTokenDto);
  }

  // ─── Password Reset ─────────────────────────────────────────────────────────

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Reset email sent (if account exists)',
    type: SuccessResponseDto,
  })
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<SuccessResponse> {
    return this.authPasswordService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully',
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<SuccessResponse> {
    return this.authPasswordService.resetPassword(dto.token, dto.newPassword);
  }

  // ─── Email Verification ─────────────────────────────────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email using 6-digit OTP' })
  @ApiResponse({
    status: 200,
    description: 'Email verified successfully',
    type: TokenPairResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<TokenPairResponseDto> {
    return this.authService.verifyEmail(dto.email, dto.otp);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification OTP' })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    type: SuccessResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Email already verified' })
  resendVerificationOtp(
    @Body() dto: ResendVerificationDto,
  ): Promise<SuccessResponse> {
    return this.authService.resendVerificationOtp(dto.email);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout account (revokes refresh token)' })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
    type: SuccessResponseDto,
  })
  logout(
    @CurrentUser() account: AuthenticatedUser,
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<SuccessResponse> {
    return this.authService.logout(
      account.id,
      Object.keys(refreshTokenDto).length
        ? refreshTokenDto.refreshToken
        : undefined,
    );
  }

  @Post('device-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register FCM device token' })
  @ApiResponse({
    status: 201,
    description: 'Device token successfully registered',
    type: DeviceTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  registerDevice(
    @CurrentUser() account: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<DeviceTokenResponseDto> {
    return this.fcmService.registerDevice(account.id, dto.token, dto.platform);
  }
}
