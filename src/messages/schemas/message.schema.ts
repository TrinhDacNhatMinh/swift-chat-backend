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
  @Prop({ required: true, type: String })
  conversation_id: string;

  @Prop({ required: true, type: String })
  sender_id: string;

  @Prop({ required: true, type: String })
  content: string;

  @Prop({ required: true, enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  @Prop({ default: false })
  is_deleted: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
