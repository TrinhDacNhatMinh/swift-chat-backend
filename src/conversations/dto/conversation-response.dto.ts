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
  userId: string;
  lastReadMessageId: string | null;
}
