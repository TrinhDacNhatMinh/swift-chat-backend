export class NotificationActorDto {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export class NotificationResponseDto {
  id: string;
  type: string;
  referenceId: string | null;
  isRead: boolean;
  createdAt: Date;
  actor: NotificationActorDto;
}

export class NotificationListResponseDto {
  data: NotificationResponseDto[];
  total: number;
  limit?: number;
  offset?: number;
}

export class UnreadCountResponseDto {
  unreadCount: number;
}
