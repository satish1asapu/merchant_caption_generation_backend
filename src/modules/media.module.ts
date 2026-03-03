import { Module } from '@nestjs/common';
import { MediaController } from '../controllers/media.controller';
import { GeminiService } from '../services/gemini.service';
import { RefineService } from '../services/refine.service';
import { ProjectsService } from '../services/projects.service';
import { S3Service } from '../services/s3.service';
import { DatabaseModule } from './database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MediaController],
  providers: [GeminiService, RefineService, ProjectsService, S3Service],
})
export class MediaModule {}
