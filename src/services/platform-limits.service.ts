import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from './gemini.service';
import { DatabaseService } from '../modules/database.module';

@Injectable()
export class PlatformLimitsService {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) { }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async updatePlatformLimits() {
    const cronEnabled = this.configService.get<string>('PLATFORM_LIMITS_CRON_ENABLED') === 'true';
    if (!cronEnabled) {
      console.log('⏸️ Platform limits cron is disabled');
      return;
    }
    
    console.log('🕛 Running daily platform limits update...');
    const platforms = ['facebook', 'instagram', 'x', 'youtube', 'linkedin'];

    for (const platform of platforms) {
      try {
        const newLimits = await this.geminiService.getPlatformLimits(platform);
        await this.savePlatformLimits(platform, newLimits);
        console.log(`✅ Updated limits for ${platform}`);
      } catch (error) {
        console.error(`❌ Failed to update limits for ${platform}:`, error);
      }
    }
    console.log('✅ Daily platform limits update completed');
  }

  // @Cron(CronExpression.EVERY_10_SECONDS)
  // async test() {
  //   const cronEnabled = this.configService.get<string>('PLATFORM_LIMITS_CRON_ENABLED') === 'true';
  //   if (!cronEnabled) {
  //     console.log('⏸️ Test cron is disabled');
  //     return;
  //   }
  //   console.log('🕛 Running test cron job...');
  // }

  private async savePlatformLimits(platform: string, newLimits: any) {
    const collection = this.databaseService.getCollection('platformLimits');
    const existing = await collection.findOne({ platform }, { sort: { updatedAt: -1 } });

    if (existing) {
      const limitsChanged = JSON.stringify(existing.limits) !== JSON.stringify(newLimits);

      if (limitsChanged) {
        await collection.insertOne({
          platform,
          limits: newLimits,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        await collection.updateOne(
          { platform },
          { $set: { updatedAt: new Date() } }
        );
      }
    } else {
      await collection.insertOne({
        platform,
        limits: newLimits,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }

  async getPlatformLimits(platform: string) {
    const collection = this.databaseService.getCollection('platformLimits');
    const result = await collection.findOne({ platform }, { sort: { updatedAt: -1 } });
    return result ? result.limits : null;
  }
}