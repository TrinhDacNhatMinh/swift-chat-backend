import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class DeleteMessageDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;
}
