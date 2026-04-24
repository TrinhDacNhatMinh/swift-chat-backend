import { ApiProperty } from '@nestjs/swagger';
import { SuccessMessageResponseDto } from '../../common/dto/success-response.dto';

export class AuthAccountDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  email: string;
}

export class TokenPairResponseDto {
  @ApiProperty()
  accessToken: string;
  @ApiProperty()
  refreshToken: string;
  @ApiProperty()
  account: AuthAccountDto;
}

export class RegisterAccountDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  email: string;
  @ApiProperty()
  isVerified: boolean;
  @ApiProperty()
  createdAt: Date;
}

export class RegisterDataDto {
  @ApiProperty()
  account: RegisterAccountDto;
  @ApiProperty()
  expiresIn: number;
}

export class RegisterResponseDto extends SuccessMessageResponseDto {
  @ApiProperty()
  data: RegisterDataDto;
}
