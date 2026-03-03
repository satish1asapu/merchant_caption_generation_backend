import { Injectable } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class RefineService {
  async refineCaption(options: any = {}): Promise<any> {
    try {
      console.log('🔄 Refining content for platform:', options.platform);

      const {
        currentCaption,
        refinementInstructions,
        platform = 'instagram',
      } = options;

      // Load service account credentials
      const serviceAccountPath = path.join(
        __dirname,
        process.env.JSON_KEY_PATH!
      );
      const serviceAccount = JSON.parse(
        fs.readFileSync(serviceAccountPath, 'utf8')
      );

      const auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });

      const client = await auth.getClient();
      const projectId = process.env.PROJECT_ID!;
      const model = process.env.MODEL_NAME;
      const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

      const promptText = this.buildRefinePrompt(
        platform,
        currentCaption,
        refinementInstructions
      );

      const requestBody = {
        contents: {
          role: 'user',
          parts: [
            {
              text: promptText,
            },
          ],
        },
      };

      console.log('📤 Sending refinement request to Gemini...');

      const response: any = await client.request({
        url: apiUrl,
        method: 'POST',
        data: requestBody,
      });

      console.log('✅ Refined response received');

      const text: string | undefined =
        response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (text) {
        if (platform === 'youtube') {
          return this.parseYouTubeResponse(text, platform);
        } else {
          return {
            success: true,
            refinedCaption: text,
            platform: platform,
          };
        }
      } else {
        throw new Error('No response text from Gemini');
      }
    } catch (error: any) {
      console.error('❌ Error refining caption:', error?.message || error);
      throw new Error(`Failed to refine caption: ${error?.message || error}`);
    }
  }

  private buildRefinePrompt(
    platform: string,
    currentCaption: string,
    refinementInstructions: string
  ): string {
    if (platform === 'youtube') {
      return `You are a text generator expert specializing in YouTube content creation. Your task is to refine and improve YouTube titles and descriptions.

YOUTUBE CONTENT TO REFINE:
${currentCaption}

USER REFINEMENT INSTRUCTIONS:
${refinementInstructions}

YOUTUBE REQUIREMENTS:
- TITLE: 6-10 words, catchy, SEO-friendly, click-worthy
- DESCRIPTION: Engaging summary with call to action

RESPONSE FORMAT (return valid JSON only):
{
  "title": "Refined YouTube title here",
  "description": "Refined YouTube description here"
}

Return ONLY the JSON object, no additional text.`;
    } else {
      return `You are a text generator expert specializing in social media content creation. Your task is to refine and improve captions for specific platforms.

PLATFORM: ${platform.toUpperCase()}

PLATFORM-SPECIFIC REQUIREMENTS:
${this.getPlatformRequirements(platform)}

CURRENT CAPTION TO REFINE:
"${currentCaption}"

USER REFINEMENT INSTRUCTIONS:
${refinementInstructions}

IMPORTANT: Return ONLY the refined caption text, no explanations, no hashtags.

REFINED CAPTION:`;
    }
  }

  private getPlatformRequirements(platform: string): string {
    const requirements: Record<string, string> = {
      instagram:
        '- Use trendy, visual language with emojis\n- Create story-oriented content\n- Make it shareable and engaging\n- NO HASHTAGS',
      facebook:
        '- Use friendly, conversational tone\n- Focus on community and sharing\n- Encourage interactions and comments\n- NO HASHTAGS',
      linkedin:
        '- Use professional, industry-focused language\n- Emphasize value and insights\n- Position as thought leadership\n- NO HASHTAGS',
      twitter:
        '- Keep it concise (under 280 characters)\n- Use conversational and engaging tone\n- Make it retweet-worthy\n- NO HASHTAGS',
      youtube:
        '- Title: 6-10 words, catchy, SEO-friendly\n- Description: Engaging summary with call to action\n- NO HASHTAGS',
    };

    return requirements[platform] || requirements.instagram;
    }

  private parseYouTubeResponse(rawText: string, platform: string) {
    try {
      const cleanText = rawText.replace(/```json\s*|\s*```/g, '').trim();
      const parsedData = JSON.parse(cleanText);

      return {
        success: true,
        title: parsedData.title || '',
        description: parsedData.description || '',
        platform: platform,
      };
    } catch (parseError) {
      console.warn('⚠️ Failed to parse YouTube JSON, using fallback');
      const lines = rawText.split('\n').filter(line => line.trim());
      const title = lines[0] || 'YouTube Title';
      const description = lines.slice(1).join('\n') || 'YouTube Description';

      return {
        success: true,
        title: title,
        description: description,
        platform: platform,
      };
    }
  }
}
