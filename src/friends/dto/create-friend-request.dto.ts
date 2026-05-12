import { IsUUID, IsNotEmpty } from 'class-validator';

export class CreateFriendRequestDto {
  @IsNotEmpty()
  @IsUUID()
  receiverId: string;
}
