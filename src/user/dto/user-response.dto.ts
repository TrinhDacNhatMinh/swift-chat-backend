export class UserResponseDto {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  isOnline?: boolean;
  lastSeen: Date | null;
  createdAt: Date;
}

export class SearchUserResponseDto {
  id: string;
  username: string;
  avatarUrl: string | null;
}
