import { UserResponseDto } from '../../user/dto/user-response.dto';

export class FriendRequestResponseDto {
  id: string;
  senderId: string;
  receiverId: string;
  status: string;
  createdAt: Date;
}

export class PendingRequestResponseDto extends FriendRequestResponseDto {
  sender: UserResponseDto;
}

export class FriendsListResponseDto {
  data: UserResponseDto[];
  total: number;
}
