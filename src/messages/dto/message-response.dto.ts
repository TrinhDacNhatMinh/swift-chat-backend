export class MessageResponseDto {
  _id: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachments?: any[];
  replyToId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class MessageListResponseDto {
  data: MessageResponseDto[];
  nextCursor: string | null;
}
