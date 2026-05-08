import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class EditMessageDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;

  @IsNotEmpty()
  @IsString()
  content: string;
}
