import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class MarkReadDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;

  @IsNotEmpty()
  @IsString()
  messageId: string;
}
