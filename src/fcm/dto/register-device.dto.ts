import { IsNotEmpty, IsString, IsIn } from 'class-validator';

export class RegisterDeviceDto {
  @IsNotEmpty()
  @IsString()
  token: string;

  @IsNotEmpty()
  @IsIn(['android', 'ios', 'web'])
  platform: string;
}
