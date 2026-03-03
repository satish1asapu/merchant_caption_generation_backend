import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { CaptionGenProject } from '../models/caption-gen-project.schema';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectModel(CaptionGenProject.name)
    private readonly captionGenModel: Model<CaptionGenProject>
  ) {}

  async createProject(clientId: string, userId: string) {
    const project = new this.captionGenModel({
      projectId: 'proj_' + randomUUID(),
      clientId,
      userId,
      status: 'draft',
      captions: [],
      createdAt: new Date(),
      completedAt: null,
      lastActivityAt: new Date(),
    });
    await project.save();
    return project.toObject();
  }

  async findProject(projectId: string) {
    return this.captionGenModel.findOne({ projectId }).lean();
  }

  async completeProject(projectId: string) {
    const project = await this.captionGenModel.findOne({ projectId });
    if (!project) throw new Error('Project not found');
    if (project.status === 'completed') throw new Error('Already completed');
    project.status = 'completed';
    project.completedAt = new Date();
    project.lastActivityAt = new Date();
    await project.save();
    return project.toObject();
  }

  async addCaptionToProject(
    projectId: string,
    captionData: {
      captionId: string;
      platform: string;
      caption: string;
      title?: string;
      description?: string;
      hashtags?: string[];
      captionType: 'base' | 'refined';
      parentCaptionId?: string;
      refinementInstructions?: string;
      sourceMediaUrl?: string;
    }
  ) {
    const project = await this.captionGenModel.findOne({ projectId });
    if (!project) throw new Error('Project not found');
    if (project.status === 'completed') throw new Error('Cannot add captions to a completed project');
    
    project.captions.push({
      ...captionData,
      createdAt: new Date(),
    } as any);
    
    project.lastActivityAt = new Date();
    await project.save();
    
    console.log(`✅ Caption added to project: ${projectId}, captionId: ${captionData.captionId}`);
    return project.toObject();
  }

  async addMediaUrlToProject(projectId: string, mediaUrl: string) {
    const project = await this.captionGenModel.findOne({ projectId });
    if (!project) throw new Error('Project not found');
    
    if (!project.mediaUrls) {
      project.mediaUrls = [];
    }
    
    // Only add if not already in array
    if (!project.mediaUrls.includes(mediaUrl)) {
      project.mediaUrls.push(mediaUrl);
      project.lastActivityAt = new Date();
      await project.save();
    }
    
    return project.toObject();
  }

  async updateBasePrompt(projectId: string, basePrompt: string) {
    const project = await this.captionGenModel.findOne({ projectId });
    if (!project) throw new Error('Project not found');
    
    project.basePrompt = basePrompt;
    project.lastActivityAt = new Date();
    await project.save();
    
    console.log(`✅ Base prompt updated for project: ${projectId}`);
    return project.toObject();
  }
}
