/**
 * conversation-list.helpers.ts
 *
 * Pure helper functions and types used by ConversationsService to build
 * the paginated conversation list. Extracted from conversations.service.ts
 * to keep that file focused on orchestration only.
 */

import { Conversation, Participant, Profile } from '@prisma/client';
import { ConversationType } from './enums/conversation.enum';
import {
  ConversationListItemDto,
  DisplayInfoDto,
} from './dto/conversation-response.dto';
import { MessageResponseDto } from '../messages/dto/message-response.dto';

// ── Re-exported types ───────────────────────────────────────────────────────

export type RawParticipant = Participant & {
  account: {
    id: string;
    lastSeen: Date | null;
    profile: {
      handle: string;
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
  };
};

export type RawConversationListItem = Conversation & {
  participants: RawParticipant[];
  _count?: { participants: number };
};

// ── mapParticipants ─────────────────────────────────────────────────────────

/**
 * Strip the Prisma `account` relation and replace it with a flat `user` object
 * suitable for the API response.
 */
export function mapParticipants(participants: RawParticipant[]) {
  return participants.map((p) => {
    const user = p.account
      ? {
          id: p.account.id,
          handle: p.account.profile?.handle || '',
          displayName: p.account.profile?.displayName || null,
          avatarUrl: p.account.profile?.avatarUrl || null,
          lastSeen: p.account.lastSeen,
        }
      : null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { account, ...rest } = p;
    return { ...rest, user };
  });
}

// ── mapToListItem ───────────────────────────────────────────────────────────

/**
 * Map a raw Prisma conversation row (with participant includes) into the
 * `ConversationListItemDto` shape consumed by the REST API.
 */
export function mapToListItem(
  conv: RawConversationListItem,
  myParticipant: Participant | undefined,
  onlineUserIds: Set<string>,
  unreadCounts: Map<string, number>,
  lastMessagesMap: Map<string, MessageResponseDto>,
  senderProfileMap: Map<string, Profile>,
): ConversationListItemDto {
  const accountId = myParticipant?.accountId;

  // ── displayInfo ────────────────────────────────────────────────────────
  let displayInfo: DisplayInfoDto;
  if (
    conv.type === ConversationType.DIRECT ||
    String(conv.type).toLowerCase() === 'direct'
  ) {
    const partner = conv.participants.find(
      (p: RawParticipant) => p.accountId !== accountId,
    );
    const partnerProfile = partner?.account?.profile;
    displayInfo = {
      title:
        partnerProfile?.displayName ??
        partner?.account?.profile?.handle ??
        null,
      avatarUrl: partnerProfile?.avatarUrl ?? null,
      isOnline: partner ? onlineUserIds.has(partner.accountId) : false,
    };
  } else {
    displayInfo = {
      title: conv.title ?? null,
      avatarUrl: conv.avatarUrl ?? null,
      isOnline: null,
    };
  }

  // ── currentParticipant ─────────────────────────────────────────────────
  const now = new Date();
  const isMuted =
    myParticipant?.mutedUntil != null &&
    new Date(myParticipant.mutedUntil) > now;
  const currentParticipant = {
    role: myParticipant?.role ?? 'member',
    isMuted,
    mutedUntil: myParticipant?.mutedUntil ?? null,
    lastReadMessageId: myParticipant?.lastReadMessageId ?? null,
  };

  // ── participantPreview ─────────────────────────────────────────
  const participantPreview = conv.participants.map((p: RawParticipant) => ({
    accountId: p.accountId,
    handle: p.account?.profile?.handle ?? '',
    displayName: p.account?.profile?.displayName ?? null,
    avatarUrl: p.account?.profile?.avatarUrl ?? null,
  }));

  // ── lastMessage preview ────────────────────────────────────────────────
  const rawLastMsg = lastMessagesMap.get(conv.id) ?? null;
  let lastMessage: {
    id: string;
    senderId: string;
    senderName: string | null;
    content: string;
    type: string;
    createdAt: string;
    isUnsent: boolean;
  } | null = null;
  if (rawLastMsg) {
    const senderProfile = senderProfileMap.get(rawLastMsg.senderId);
    const senderName =
      senderProfile?.displayName ?? senderProfile?.handle ?? null;
    lastMessage = {
      id: rawLastMsg.id,
      senderId: rawLastMsg.senderId,
      senderName,
      content: rawLastMsg.content,
      type: rawLastMsg.type,
      createdAt: rawLastMsg.createdAt,
      isUnsent: rawLastMsg.isUnsent,
    };
  }

  return {
    id: conv.id,
    type: conv.type,
    displayInfo,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    unreadCount: unreadCounts.get(conv.id) ?? 0,
    currentParticipant,
    participantPreview,
    totalParticipants: conv._count?.participants ?? conv.participants.length,
    lastMessage,
  };
}
