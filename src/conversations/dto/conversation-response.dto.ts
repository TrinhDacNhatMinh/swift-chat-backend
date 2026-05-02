import { SuccessResponseDto } from '../../common/dto/success-response.dto';

// ─── Existing DTOs (used by create / detail endpoints) ──────────────────────

export class ConversationResponseDto {
  id: string;
  type: string;
  title: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationListResponseDto {
  data: ConversationResponseDto[];
  total: number;
}

export class ReadReceiptResponseDto {
  accountId: string;
  lastReadMessageId: string | null;
}

export class ReadReceiptItemDto {
  accountId: string;
  lastReadMessageId: string | null;
  account: {
    id: string;
    lastSeen: Date | null;
    profile: {
      displayName: string | null;
      avatarUrl: string | null;
      handle: string | null;
    } | null;
  };
}

export class ConversationParticipantDto {
  id: string;
  accountId: string;
  role: string;
  joinAt: Date;
  mutedUntil: Date | null;
  hiddenAt: Date | null;
  lastReadMessageId: string | null;
  user: {
    id: string;
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    lastSeen: Date | null;
  } | null;
}

export class ConversationWithParticipantsDto extends ConversationResponseDto {
  participants: ConversationParticipantDto[];
}

export class AddMembersResponseDto extends SuccessResponseDto {
  added: number;
  userIds?: string[];
}

export class KickMemberResponseDto extends SuccessResponseDto {
  removedUserId: string;
}

export class DisbandGroupResponseDto extends SuccessResponseDto {
  disbanded: boolean;
}

export class TransferLeadershipResponseDto extends SuccessResponseDto {
  newLeaderId: string;
}

export class UpdateMemberRoleResponseDto extends SuccessResponseDto {
  targetUserId: string;
  newRole: string;
}

export class HideConversationResponseDto extends SuccessResponseDto {
  hidden: boolean;
}

// ─── New optimised DTOs for GET /conversations (list view) ───────────────────

/** Pre-computed display info so FE doesn't need to derive it from participants */
export class DisplayInfoDto {
  /** direct: partner's displayName | group: group title */
  title: string | null;
  /** direct: partner's avatarUrl | group: group avatarUrl */
  avatarUrl: string | null;
  /** direct: whether the partner is currently online | group: null */
  isOnline: boolean | null;
}

/** Compact participant preview — for showing stacked avatars in list */
export class ParticipantPreviewDto {
  accountId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Caller's own participant state within this conversation */
export class CurrentParticipantDto {
  role: string;
  isMuted: boolean;
  mutedUntil: Date | null;
  lastReadMessageId: string | null;
}

/** Minimal last-message preview for conversation list */
export class LastMessagePreviewDto {
  id: string;
  senderId: string;
  /** displayName or handle of the sender */
  senderName: string | null;
  content: string;
  type: string;
  createdAt: string;
  isUnsent: boolean;
}

/** The shape returned by GET /conversations (list) */
export class ConversationListItemDto {
  id: string;
  type: string;
  /** Pre-computed: avoids null title/avatarUrl that FE had to resolve itself */
  displayInfo: DisplayInfoDto;
  createdAt: Date;
  updatedAt: Date;
  /** Number of unread messages for the calling user */
  unreadCount: number;
  /** Caller's own role/mute state inside this conversation */
  currentParticipant: CurrentParticipantDto;
  /** Up to 3 participants for stacked-avatar display */
  participantPreview: ParticipantPreviewDto[];
  totalParticipants: number;
  lastMessage: LastMessagePreviewDto | null;
}
