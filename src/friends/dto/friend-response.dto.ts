export class FriendRequestResponseDto {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  createdAt: Date;
}

export class FriendUserDto {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class PendingRequestResponseDto extends FriendRequestResponseDto {
  sender: FriendUserDto;
  receiver: FriendUserDto;
}

export class SendRequestResponseDto {
  result: 'FRIEND_REQUEST_SENT' | 'AUTO_ACCEPTED';
  friendRequest: FriendRequestResponseDto;
}

import { PublicUserProfileDto } from '../../user/dto/user-response.dto';

export class FriendsListResponseDto {
  data: PublicUserProfileDto[];
  total: number;
  limit?: number;
  offset?: number;
}
