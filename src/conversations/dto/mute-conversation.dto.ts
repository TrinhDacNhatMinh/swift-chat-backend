import { IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MuteDuration {
  ONE_HOUR = '1h',
  EIGHT_HOURS = '8h',
  TWENTY_FOUR_HOURS = '24h',
  FOREVER = 'forever',
}

export class MuteConversationDto {
  @ApiProperty({
    enum: MuteDuration,
    description: 'Mute duration: 1h, 8h, 24h, or forever',
    default: MuteDuration.FOREVER,
    required: false,
  })
  @IsOptional()
  @IsEnum(MuteDuration)
  duration?: MuteDuration = MuteDuration.FOREVER;
}
