import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
}

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class Message {
  // Store UUIDs as strings because this collection references PostgreSQL across databases
  @Prop({ required: true, type: String, index: true })
  conversation_id: string;

  @Prop({ required: true, type: String, index: true })
  sender_id: string;

  @Prop({ required: true, type: String })
  content: string;

  @Prop({ required: true, enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  @Prop({ default: false })
  is_deleted: boolean;

  @Prop({ default: false })
  is_edited: boolean;

  // Stores the deletion timestamp for audit purposes — content is never erased
  @Prop({ type: Date, default: null })
  deleted_at: Date | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
