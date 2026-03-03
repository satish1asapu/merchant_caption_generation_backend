import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './modules/database.module';
import { MediaModule } from './modules/media.module';
import { PlatformLimitsService } from './services/platform-limits.service';
import { GeminiService } from './services/gemini.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), DatabaseModule, MediaModule],
  controllers: [],
  providers: [PlatformLimitsService, GeminiService],
})
export class AppModule {}
