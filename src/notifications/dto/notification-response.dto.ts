import { UserResponseDto } from '../../user/dto/user-response.dto';

export class NotificationResponseDto {
  id: string;
  type: string;
  referenceId: string | null;
  isRead: boolean;
  createdAt: Date;
  actor: UserResponseDto;
}

export class NotificationListResponseDto {
  data: NotificationResponseDto[];
  total: number;
}

export class UnreadCountResponseDto {
  unreadCount: number;
}
