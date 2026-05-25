import {
  IsEnum,
  IsUUID,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  ValidateIf,
} from 'class-validator';
import { ConversationType } from '../enums/conversation.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiProperty({
    description: 'Loại cuộc hội thoại (direct hoặc group)',
    enum: ConversationType,
    example: ConversationType.DIRECT,
  })
  @IsNotEmpty()
  @IsEnum(ConversationType)
  type: ConversationType;

  // Required for direct chat
  @ApiPropertyOptional({
    description: 'ID của đối phương (bắt buộc nếu là chat 1-1)',
    example: 'uuid-1234',
  })
  @ValidateIf((o) => o.type === ConversationType.DIRECT)
  @IsNotEmpty()
  @IsUUID()
  partnerId?: string;

  // Required for group chat
  @ApiPropertyOptional({
    description: 'Danh sách ID của các thành viên (bắt buộc nếu là group chat)',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @ValidateIf((o) => o.type === ConversationType.GROUP)
  @IsNotEmpty()
  @IsArray()
  @IsUUID('all', { each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    description: 'Tên nhóm (tùy chọn)',
    example: 'Dự án A',
  })
  @IsOptional()
  @IsString()
  title?: string;
}
