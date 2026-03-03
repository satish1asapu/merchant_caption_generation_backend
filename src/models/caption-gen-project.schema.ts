import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CaptionGenProjectDocument = CaptionGenProject & Document;

// Caption subdocument schema
@Schema({ _id: false })
export class Caption {
  @Prop({ required: true })
  captionId!: string;

  @Prop({ required: true })
  platform!: string;

  @Prop({ required: true })
  caption!: string;

  @Prop()
  title?: string;

  @Prop()
  description?: string;

  @Prop({ type: [String] })
  hashtags?: string[];

  @Prop({ required: true, enum: ['base', 'refined'] })
  captionType!: string;

  @Prop()
  parentCaptionId?: string;

  @Prop()
  refinementInstructions?: string;

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop()
  sourceMediaUrl?: string;
}

export const CaptionSchema = SchemaFactory.createForClass(Caption);

// Main Project schema
@Schema({ collection: 'captionGen' })
export class CaptionGenProject {
  @Prop({ required: true })
  projectId!: string;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true, enum: ['draft', 'completed'], default: 'draft' })
  status!: string;

  @Prop()
  basePrompt?: string;

  @Prop({ type: [CaptionSchema], default: [] })
  captions!: Caption[];

  @Prop({ type: [String] })
  mediaUrls?: string[];

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ type: Date, required: false })
  completedAt?: Date;

  @Prop({ default: Date.now })
  lastActivityAt!: Date;
}

export const CaptionGenProjectSchema = SchemaFactory.createForClass(CaptionGenProject);

// Create indexes
CaptionGenProjectSchema.index({ projectId: 1 });
CaptionGenProjectSchema.index({ clientId: 1, userId: 1  });
CaptionGenProjectSchema.index({ clientId: 1, status: 1 , userId: 1 });
CaptionGenProjectSchema.index({ clientId: 1, userId: 1, projectId: 1 });
CaptionGenProjectSchema.index({ clientId: 1, status: 1 });