import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { MessageType } from '../schemas/message.schema';

export class CreateMessageDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  clientTempId?: string;
}
