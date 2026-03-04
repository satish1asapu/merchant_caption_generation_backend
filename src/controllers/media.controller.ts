import { Controller, Post, Body, Res, UploadedFile, UseInterceptors, HttpStatus, Req, Get,Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GeminiService } from '../services/gemini.service';
import { RefineService } from '../services/refine.service';
import { ProjectsService } from '../services/projects.service';
import { S3Service } from '../services/s3.service';
import { DatabaseService } from '../modules/database.module';
import { randomUUID } from 'crypto';

@Controller('api')
export class MediaController {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly refineService: RefineService,
    private readonly projectsService: ProjectsService,
    private readonly s3Service: S3Service,
    private readonly databaseService: DatabaseService,
  ) { }

  @Get('db/collections')
  async listCollections(@Res() res: any) {
    try {
      const collections = await this.databaseService.listCollections();
      res.json({ collections });
    } catch (err) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: err.message });
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: any, @Req() req: any, @Res() res: any) {
    try {
      const projectId = (req.body && req.body.projectId) || req.body?.projectId;
      if (!projectId) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'projectId is required' });
      }
      const project = await this.projectsService.findProject(projectId);
      if (!project) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Project not found' });
      }
      if (!file) return res.status(HttpStatus.BAD_REQUEST).send('No file uploaded');
      const type = file.mimetype.startsWith('image/') ? 'image' : file.mimetype.startsWith('video/') ? 'video' : 'other';

      // Upload to S3 only
      const s3Url = await this.s3Service.uploadFile({
        fileBuffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
        clientId: project.clientId,
        projectId: project.projectId,
        type,
      });

      // Add media URL to project
      await this.projectsService.addMediaUrlToProject(project.projectId, s3Url);

      res.json({
        message: 'File uploaded successfully',
        url: s3Url,
        type,
        projectId: project.projectId,
      });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send(err.message);
    }
  }

  @Post('analyze-media')
  async analyzeMedia(@Body() body: any, @Res() res: any) {
    try {
      const { projectId, mediaUrl, prompt = 'Describe this media in detail', platform = ['instagram'], contentTone = 'engaging', includeHashtags = true } = body;
      if (!mediaUrl || !projectId) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Media URL and projectId are required' });
      }
      const project = await this.projectsService.findProject(projectId);
      if (!project) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Project not found' });
      }
      if (project.status === 'completed') {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Project is already completed. Cannot analyze further.' });
      }
      const validPlatforms = ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube'];
      const invalidPlatforms = platform.filter((p: string) => !validPlatforms.includes(p));
      if (invalidPlatforms.length > 0) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: `Invalid platform(s): ${invalidPlatforms.join(', ')}. Choose from: ${validPlatforms.join(', ')}` });
      }
      const analysis = await this.geminiService.analyzeMedia(mediaUrl, { prompt, platform, contentTone, includeHashtags });

      // Update base prompt for the project
      await this.projectsService.updateBasePrompt(projectId, prompt);

      // Save captions to database
      const captionId = 'cap_' + randomUUID();
      if (platform.length === 1) {
        const singlePlatform = platform[0];
        if (singlePlatform === 'youtube') {
          // For YouTube, we have title and description
          await this.projectsService.addCaptionToProject(projectId, {
            captionId,
            platform: singlePlatform,
            caption: analysis.description || '',
            title: analysis.title || '',
            description: analysis.description || '',
            hashtags: analysis.hashtags || [],
            captionType: 'base',
            sourceMediaUrl: mediaUrl,
          });
          res.json({ success: true, title: analysis.title, description: analysis.description, hashtags: analysis.hashtags || [], platform: analysis.platform, contentTone, includeHashtags, mediaUrl, captionId });
        } else {
          await this.projectsService.addCaptionToProject(projectId, {
            captionId,
            platform: singlePlatform,
            caption: analysis.caption,
            hashtags: analysis.hashtags || [],
            captionType: 'base',
            sourceMediaUrl: mediaUrl,
          });
          res.json({ success: true, caption: analysis.caption, hashtags: analysis.hashtags || [], platform: analysis.platform, contentTone, includeHashtags, mediaUrl, captionId });
        }
      } else {
        // Multi-platform: save each platform's caption
        for (const [platformName, platformData] of Object.entries(analysis.results)) {
          const capId = 'cap_' + randomUUID();
          const data = platformData as any;
          const isYoutube = platformName.toLowerCase() === 'youtube';
          await this.projectsService.addCaptionToProject(projectId, {
            captionId: capId,
            platform: platformName.toLowerCase(),
            caption: isYoutube ? data.description || '' : data.caption || '',
            title: isYoutube ? data.title : undefined,
            description: isYoutube ? data.description : undefined,
            hashtags: data.hashtags || [],
            captionType: 'base',
            sourceMediaUrl: mediaUrl,
          });
        }
        res.json({ success: true, platforms: analysis.platforms, results: analysis.results, contentTone, includeHashtags, mediaUrl });
      }
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: err.message });
    }
  }

  @Post('refine')
  async refine(@Body() body: any, @Res() res: any) {
    try {
      const { projectId, currentCaption, refinementInstructions, platform = 'instagram', parentCaptionId, userId } = body;
      if (!currentCaption || !refinementInstructions || !projectId) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Current caption and refinement instructions and projectId are required' });
      }
      if (!userId) { // userId VALIDATION
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'userId is required' });
      }
      const result = await this.refineService.refineCaption({ currentCaption, refinementInstructions, platform });

      // Save refined caption to database
      const refinedCaptionId = 'cap_' + randomUUID();
      const isYoutube = platform.toLowerCase() === 'youtube';
      await this.projectsService.addCaptionToProject(projectId, {
        captionId: refinedCaptionId,
        platform: result.platform || platform,
        caption: isYoutube ? result.description || '' : result.refinedCaption || '',
        title: isYoutube ? result.title : undefined,
        description: isYoutube ? result.description : undefined,
        hashtags: result.hashtags || [],
        captionType: 'refined',
        parentCaptionId: parentCaptionId,
        refinementInstructions: refinementInstructions,
      });

      res.json({ ...result, captionId: refinedCaptionId, userId });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: err.message });
    }
  }

  @Post('projects/create')
  async createProject(@Body() body: any, @Res() res: any) {
    try {
      const { clientId, userId } = body;
      if (!clientId) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'clientId is required' });
      if (!userId) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'userId is required' });
      const project = await this.projectsService.createProject(clientId, userId);
      res.json({ success: true, project });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: err.message });
    }
  }

  @Post('platform/limits')
  async getPlatformLimits(@Body() body: any, @Res() res: any) {
    try {
      const { platform } = body;
      if (!platform) {
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'Platform is required' });
      }
      const limits = await this.geminiService.getPlatformLimits(platform);
      res.json({ success: true, platform, limits });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: err.message });
    }
  }

  @Post('projects/complete')
  async completeProject(@Body() body: any, @Res() res: any) {
    try {
      const { projectId } = body;
      if (!projectId) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, error: 'projectId is required' });
      const project = await this.projectsService.completeProject(projectId);
      // Return project without captions array
      const { captions, ...projectWithoutCaptions } = project;
      res.json({ success: true, project: projectWithoutCaptions });
    } catch (err) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, error: err.message });
    }
  }

  @Get('getCaptions')
  async getCaptions(@Query('clientId') clientId: string, @Query('startDate') startDate: string, @Query('endDate') endDate: string) {
      return this.projectsService.getCaptions(clientId, startDate, endDate);
  }
}
