import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthResponseDto } from './dto/auth-response.dto';
import { SuccessResponseDto } from '../common/dto/success-response.dto';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { FcmService } from '../fcm/fcm.service';
import { RegisterDeviceDto } from '../fcm/dto/register-device.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly fcmService: FcmService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User successfully registered', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request (e.g. Email/Username already in use)' })
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Successfully logged in', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized (Invalid credentials)' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Successfully refreshed token', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized (Invalid or expired refresh token)' })
  refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google login/register' })
  @ApiResponse({ status: 200, description: 'Successfully logged in via Google', type: AuthResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request (Invalid Google payload or already registered via local)' })
  @ApiResponse({ status: 401, description: 'Unauthorized (Invalid Google token)' })
  googleLogin(@Body() googleAuthDto: GoogleAuthDto) {
    return this.authService.googleLogin(googleAuthDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  @HttpCode(HttpStatus.OK)
  @ApiResponse({ status: 200, description: 'Successfully logged out', type: SuccessResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request (Invalid token or already logged out)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  logout(
    @CurrentUser() user: any,
    @Body() refreshTokenDto: RefreshTokenDto, // Optional: if provided, delete only this session
  ) {
    return this.authService.logout(user.id, refreshTokenDto);
  }

  @Post('device-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register FCM device token' })
  @ApiResponse({ status: 201, description: 'Device token successfully registered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  registerDevice(@CurrentUser() user: any, @Body() dto: RegisterDeviceDto) {
    return this.fcmService.registerDevice(user.id, dto.token, dto.platform);
  }
}
