import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { FcmService } from '../fcm/fcm.service';
import { RegisterDeviceDto } from '../fcm/dto/register-device.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly fcmService: FcmService,
  ) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refreshToken(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  googleLogin(@Body() googleAuthDto: GoogleAuthDto) {
    return this.authService.googleLogin(googleAuthDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(
    @CurrentUser() user: any,
    @Body() refreshTokenDto: RefreshTokenDto, // Optional: if provided, delete only this session
  ) {
    return this.authService.logout(user.id, refreshTokenDto);
  }

  @Post('device-token')
  @UseGuards(JwtAuthGuard)
  registerDevice(@CurrentUser() user: any, @Body() dto: RegisterDeviceDto) {
    return this.fcmService.registerDevice(user.id, dto.token, dto.platform);
  }
}
