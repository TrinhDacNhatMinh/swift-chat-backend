import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BlockUserDto {
  @ApiProperty({ description: 'The ID of the account to block' })
  @IsNotEmpty()
  @IsUUID()
  blockedId: string;
}
