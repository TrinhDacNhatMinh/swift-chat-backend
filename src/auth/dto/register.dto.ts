import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Tên định danh duy nhất của người dùng',
    example: 'john_doe',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @ApiProperty({
    description: 'Địa chỉ email dùng để liên lạc và lấy lại mật khẩu',
    example: 'john@example.com',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Mật khẩu bảo mật, tối thiểu 6 ký tự',
    example: 'StrongP@ss123',
  })
  @IsString()
  @MinLength(6)
  password: string;
}
