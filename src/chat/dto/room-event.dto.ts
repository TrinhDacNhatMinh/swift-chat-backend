import { IsNotEmpty, IsUUID } from 'class-validator';

export class RoomEventDto {
  @IsNotEmpty()
  @IsUUID()
  conversationId: string;
}
