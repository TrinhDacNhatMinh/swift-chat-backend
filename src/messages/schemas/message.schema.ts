import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

@Schema({ _id: false })
class Reaction {
  @Prop({ required: true })
  emoji: string;

  @Prop({ required: true })
  accountId: string;

  @Prop({ default: () => new Date() })
  createdAt: Date;
}

@Schema({ _id: false })
export class ReplyTarget {
  @Prop({ required: true })
  messageId: string;

  @Prop({ required: true })
  senderId: string;

  @Prop({ required: true })
  content: string;

  @Prop({ required: true, enum: MessageType })
  type: MessageType;
}

@Schema({ _id: false })
export class ForwardedFrom {
  @Prop({ required: true })
  messageId: string;

  @Prop({ required: true })
  senderId: string;
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Message {
  // Store UUIDs as strings because this collection references PostgreSQL across databases
  @Prop({ required: true, type: String, index: true })
  conversation_id: string;

  @Prop({ required: true, type: String, index: true })
  sender_id: string;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({ required: true, enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  @Prop({ type: [String], default: [] })
  attachments: string[];

  @Prop({ type: [Reaction], default: [] })
  reactions: Reaction[];

  @Prop({ type: ReplyTarget, default: null })
  reply_to: ReplyTarget | null;

  @Prop({ default: false })
  is_deleted: boolean;

  @Prop({ default: false })
  is_unsent: boolean;

  @Prop({ type: [String], default: [] })
  deleted_by: string[];

  @Prop({ default: false })
  is_edited: boolean;

  // Stores the deletion timestamp for audit purposes — content is never erased
  @Prop({ type: Date, default: null })
  deleted_at: Date | null;

  @Prop({ default: false })
  is_pinned: boolean;

  @Prop({ type: String, default: null })
  pinned_by: string | null;

  @Prop({ type: Date, default: null })
  pinned_at: Date | null;

  @Prop({ type: [String], default: [] })
  mentions: string[];

  @Prop({ type: ForwardedFrom, default: null })
  forwarded_from: ForwardedFrom | null;

  created_at: Date;
  updated_at: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Add text index for searching messages
MessageSchema.index({ conversation_id: 1, content: 'text' });
MessageSchema.index({ conversation_id: 1, is_pinned: 1 });

@Schema({
  collection: 'messages_archive',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class MessageArchive extends Message {}

export const MessageArchiveSchema =
  SchemaFactory.createForClass(MessageArchive);

// Text index for archive collection
MessageArchiveSchema.index({ conversation_id: 1, content: 'text' });
MessageArchiveSchema.index({ conversation_id: 1, is_pinned: 1 });
