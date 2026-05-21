import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: 'Tên định danh của người dùng', example: 'john_doe' })
  @IsString()
  username: string;

  @ApiProperty({ description: 'Mật khẩu', example: 'StrongP@ss123' })
  @IsString()
  password: string;
}
