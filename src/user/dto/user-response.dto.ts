export class UserResponseDto {
  id: string;
  username: string;
  handle: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  isOnline?: boolean;
  isEmailVerified: boolean;
  lastSeen: Date | null;
  createdAt: Date;
}

export class PublicUserProfileDto {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  website?: string | null;
  location?: string | null;
  isOnline?: boolean;
  lastSeen: Date | null;
  createdAt: Date;
}

export class SearchUserResponseDto {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  isFriend?: boolean;
  friendRequestStatus?: 'sent' | 'received' | null;
}
