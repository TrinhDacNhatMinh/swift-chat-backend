import { IsEnum, IsNotEmpty } from 'class-validator';

export enum FriendRequestAction {
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export class RespondFriendRequestDto {
  @IsNotEmpty()
  @IsEnum(FriendRequestAction)
  action: FriendRequestAction;
}
