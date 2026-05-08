import { IsNotEmpty, IsUUID, IsString } from 'class-validator';

export class PinMessageDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;
}
