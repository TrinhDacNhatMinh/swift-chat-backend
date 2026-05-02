import { ApiProperty } from '@nestjs/swagger';

export class ReplyTargetDto {
  @ApiProperty()
  messageId: string;
  @ApiProperty()
  senderId: string;
  @ApiProperty()
  content: string;
  @ApiProperty()
  type: string;
}

export class ForwardedFromDto {
  @ApiProperty()
  messageId: string;
  @ApiProperty()
  conversationId: string;
}

export class ReactionDto {
  @ApiProperty()
  emoji: string;
  @ApiProperty()
  accountId: string;
  @ApiProperty()
  createdAt: string;
}

export class MessageResponseDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  conversationId: string;
  @ApiProperty()
  senderId: string;
  @ApiProperty()
  content: string;
  @ApiProperty()
  type: string;
  @ApiProperty()
  createdAt: string; // ISO string
  @ApiProperty()
  updatedAt?: string;
  @ApiProperty()
  isUnsent: boolean;
  @ApiProperty()
  isEdited: boolean;
  @ApiProperty()
  isDeleted: boolean;
  @ApiProperty({ required: false })
  isPinned?: boolean;
  @ApiProperty({ required: false, nullable: true })
  pinnedBy?: string | null;
  @ApiProperty({ required: false, nullable: true })
  pinnedAt?: string | null;
  @ApiProperty({ type: ReplyTargetDto, nullable: true })
  replyTo: ReplyTargetDto | null;
  @ApiProperty({ type: ForwardedFromDto, nullable: true })
  forwardedFrom: ForwardedFromDto | null;
  @ApiProperty({ type: [ReactionDto] })
  reactions: ReactionDto[];
  @ApiProperty({ type: [String] })
  attachments: string[];
}

export class MessageListResponseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  data: MessageResponseDto[];
  @ApiProperty({ nullable: true })
  nextCursor: string | null;
}
