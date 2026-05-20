import { ApiProperty } from '@nestjs/swagger';
import { SuccessResponseDto } from '../../common/dto/success-response.dto';

export class BlockResponseDto extends SuccessResponseDto {
  @ApiProperty()
  blocked: boolean;

  @ApiProperty()
  targetUserId: string;
}

export class BlockedUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  handle: string;

  @ApiProperty({ nullable: true })
  displayName: string | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  blockedAt: Date;
}

export class BlockStatusResponseDto {
  @ApiProperty()
  isBlocker: boolean;

  @ApiProperty()
  isBlocked: boolean;
}
