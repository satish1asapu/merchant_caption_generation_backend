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
  ) { }

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

  async getCaptions(clientId: string, startDate?: string, endDate?: string) {
    let captionData = await this.captionGenModel.find({
      clientId: clientId,
      ...(startDate && endDate ? {
        createdAt: {
          $gte: new Date(startDate + 'T00:00:00.000+00:00'),
          $lte: new Date(endDate + 'T23:59:59.999+00:00')
        }
      } : {})
    }).lean();

    if (!captionData || captionData.length === 0) {
      return [];
    }

    return await Promise.all(captionData.reverse().map(async cap => {
      // Organize captions by platform
      const platformData: any = {};

      const date = this.formatDate(cap.createdAt);

      const sortedCaptions = cap.captions.sort((a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Track refined version counts per platform
      const refinedCounts: { [platform: string]: number } = {};

      sortedCaptions.forEach((c: any) => {
        const platform = c.platform;

        if (!platformData[platform]) {
          platformData[platform] = {
            base: null,
            refined: []
          };
          refinedCounts[platform] = 0;
        }

        if (c.captionType === 'base') {
          platformData[platform].base = {
            versionType: 'Initial version',
            refinementInstructions: cap.basePrompt,
            caption: c.caption,
            hashtags: c.hashtags || [],
            ...(platform === 'youtube' && c.title ? { title: c.title } : {})
          };
        } else if (c.captionType === 'refined') {
          refinedCounts[platform]++;
          const refinedItem = {
            versionType: `Improved version ${refinedCounts[platform]}`,
            caption: c.caption,
            hashtags: c.hashtags || [],
            refinementInstructions: c.refinementInstructions,
            ...(platform === 'youtube' && c.title ? { title: c.title } : {})
          };
          platformData[platform].refined.push(refinedItem);
        }
      });

      // Process each platform to reorganize base and refined versions
      Object.keys(platformData).forEach(platform => {
        const platformRefined = platformData[platform].refined;

        if (platformRefined.length > 0) {
          // Sort refined versions by version number in descending order
          platformRefined.sort((a: any, b: any) => {
            const aVersion = parseInt(a.versionType.match(/\d+/)?.[0] || '0');
            const bVersion = parseInt(b.versionType.match(/\d+/)?.[0] || '0');
            return bVersion - aVersion;
          });

          // Get the highest improved version for base
          const highestRefined = platformRefined[0];

          // Create new refined array with remaining versions (including initial version)
          const remainingVersions = [
            platformData[platform].base, // Include initial version
            ...platformRefined.slice(1)  // Include all other refined versions except the highest
          ].filter(Boolean); // Remove null/undefined values

          // Sort remaining versions in descending order
          remainingVersions.sort((a: any, b: any) => {
            const aVersion = parseInt(a.versionType?.match(/\d+/)?.[0] || '0');
            const bVersion = parseInt(b.versionType?.match(/\d+/)?.[0] || '0');
            return bVersion - aVersion;
          });

          // Update platform data
          platformData[platform].base = highestRefined;
          platformData[platform].refined = remainingVersions;
        } else {
          // If no refined versions, keep base as initial version and refined empty
          platformData[platform].refined = [];
        }
      });

      const allData = Object.keys(platformData).map(platform => ({
        platform,
        base: platformData[platform].base,
        refined: platformData[platform].refined
      }));

      return {
        projectId: cap.projectId,
        userName: 'Adverza Media Labs',
        genaratedAt: date,
        mediaUrls: cap.mediaUrls || [],
        basePrompt: cap.basePrompt,
        captionData: allData
      };
    }));
  }

  async formatDate(timestamp: Date) {
    if (!timestamp) return null;

    const date = new Date(timestamp);

    // Convert UTC to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
    const istDate = new Date(date.getTime() + istOffset);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[istDate.getUTCMonth()];
    const day = istDate.getUTCDate();

    let suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    else if (day % 10 === 2 && day !== 12) suffix = 'nd';
    else if (day % 10 === 3 && day !== 13) suffix = 'rd';

    const year = istDate.getUTCFullYear();
    let hours = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes().toString().padStart(2, '0');

    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12; // Convert to 12-hour format

    return `${month} ${day}${suffix} ${year}, ${hours.toString().padStart(2, '0')}:${minutes} ${period}`;
  }

}
