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

export class CreateConversationDto {
  @IsNotEmpty()
  @IsEnum(ConversationType)
  type: ConversationType;

  // Required for direct chat
  @ValidateIf((o) => o.type === ConversationType.DIRECT)
  @IsNotEmpty()
  @IsUUID()
  partnerId?: string;

  // Required for group chat
  @ValidateIf((o) => o.type === ConversationType.GROUP)
  @IsNotEmpty()
  @IsArray()
  @IsUUID('all', { each: true })
  memberIds?: string[];

  @IsOptional()
  @IsString()
  title?: string;
}
