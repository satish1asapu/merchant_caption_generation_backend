import { Injectable } from '@nestjs/common';
import { GoogleAuth } from 'google-auth-library';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class GeminiService {
  async analyzeMedia(mediaUrl: string, options: any = {}): Promise<any> {
    try {
      const {
        prompt = 'Describe this media in detail',
        platform = ['instagram'],
        contentTone = 'engaging',
        includeHashtags = true,
      } = options;

      const platforms: string[] = platform;
      const isMultiPlatform = platforms.length > 1;

      // GCP credentials
      const serviceAccountPath = path.join(__dirname, process.env.JSON_KEY_PATH!);
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      const auth = new GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();

      const projectId = process.env.PROJECT_ID!;
      const model = process.env.MODEL_NAME ;
      const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

      const platformGuidelines: Record<string, string> = {
        instagram: 'Trendy, engaging with emojis. Keep it visual and story-oriented.',
        facebook: 'Friendly, conversational tone. Focus on community and sharing.',
        linkedin: 'Professional, industry-focused. Emphasize value and insights.',
        twitter: 'Concise, conversational, and engaging. Maximum 280 characters.',
        youtube: 'Title: 6-10 words, catchy, SEO-friendly. Description: Engaging summary with call to action.',
      };

      const promptText = isMultiPlatform
        ? this.buildMultiPlatformPrompt(platforms, prompt, contentTone, includeHashtags, platformGuidelines)
        : this.buildSinglePlatformPrompt(platforms[0], prompt, contentTone, includeHashtags, platformGuidelines);

      const requestBody = {
        contents: {
          role: 'user',
          parts: [
            {
              fileData: {
                mimeType: this.getMimeType(mediaUrl),
                fileUri: mediaUrl,
              },
            },
            { text: promptText },
          ],
        },
      };

      const response: any = await client.request({ url: apiUrl, method: 'POST', data: requestBody });
      const data: any = response?.data ?? {};
      console.log('Gemini API RAW:', JSON.stringify(data, null, 2));

      const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        console.error('Gemini API response missing expected content:', JSON.stringify(data, null, 2));
        throw new Error('No content returned by Gemini API');
      }

      // Parse according to single vs multi
      if (isMultiPlatform) {
        return this.parseMultiPlatformResponse(text, platforms, { mediaUrl, contentTone, includeHashtags });
      } else {
        return this.parseSinglePlatformResponse(text, platforms[0], { mediaUrl, contentTone, includeHashtags });
      }
    } catch (err) {
      console.error('GeminiService fatal error:', err);
      throw err;
    }
  }

  private parseSinglePlatformResponse(rawText: string, platform: string, metadata: any) {
    try {
      // Try to extract JSON from markdown code blocks first
      let cleanText = rawText.replace(/```json\s*|\s*```/g, '').trim();
      
      // If still not valid JSON, try to extract JSON object from the text
      if (!cleanText.startsWith('{')) {
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanText = jsonMatch[0];
        }
      }
      
      const parsedData = JSON.parse(cleanText);

      if (platform === 'youtube') {
        return {
          success: true,
          title: parsedData.title || '',
          description: parsedData.description || '',
          hashtags: Array.isArray(parsedData.hashtags) ? parsedData.hashtags : [],
          platform: platform,
          contentTone: metadata.contentTone,
          includeHashtags: metadata.includeHashtags,
          mediaUrl: metadata.mediaUrl,
        };
      } else {
        return {
          success: true,
          caption: parsedData.caption || '',
          hashtags: Array.isArray(parsedData.hashtags) ? parsedData.hashtags : [],
          platform: platform,
          contentTone: metadata.contentTone,
          includeHashtags: metadata.includeHashtags,
          mediaUrl: metadata.mediaUrl,
        };
      }
    } catch (parseError) {
      return this.createFallbackSingle(platform, rawText, metadata);
    }
  }

  private parseMultiPlatformResponse(rawText: string, platforms: string[], metadata: any) {
    const results: Record<string, any> = {};
    try {
      console.log('📥 Parsing multi-platform response, raw text:', rawText.substring(0, 200));
      
      // Try to extract JSON from markdown code blocks first
      let cleanText = rawText.replace(/```json\s*|\s*```/g, '').trim();
      
      // If still not valid JSON, try to extract JSON object from the text
      if (!cleanText.startsWith('{')) {
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanText = jsonMatch[0];
        }
      }
      
      console.log('🧹 Cleaned text:', cleanText.substring(0, 200));
      const parsedData = JSON.parse(cleanText);
      console.log('✅ Parsed JSON keys:', Object.keys(parsedData));

      platforms.forEach(p => {
        const key = p.toUpperCase();
        if (parsedData[key]) {
          console.log(`✅ Found ${key}, data:`, parsedData[key]);
          results[p] = this.createPlatformResult(p, parsedData[key]);
        } else {
          console.log(`⚠️ Missing ${key}, using fallback`);
          results[p] = this.createFallbackPlatformResult(p, '');
        }
      });
    } catch (e) {
      console.error('❌ Failed to parse multi-platform JSON:', e.message);
      console.error('Raw text:', rawText);
      throw new Error(`Failed to parse Gemini multi-platform response: ${e.message}. Please regenerate.`);
    }

    return {
      success: true,
      platforms,
      results,
      contentTone: metadata.contentTone,
      includeHashtags: metadata.includeHashtags,
      mediaUrl: metadata.mediaUrl,
    };
  }

  private createPlatformResult(platform: string, parsedData: any) {
    const isYouTube = platform === 'youtube';
    if (isYouTube) {
      return {
        title: parsedData.title || '',
        description: parsedData.description || '',
        hashtags: Array.isArray(parsedData.hashtags) ? parsedData.hashtags : [],
      };
    }
    return {
      caption: parsedData.caption || '',
      hashtags: Array.isArray(parsedData.hashtags) ? parsedData.hashtags : [],
    };
  }

  private createFallbackPlatformResult(platform: string, text: string) {
    const isYouTube = platform === 'youtube';
    const hashtagRegex = /#\w+/g;
    const foundHashtags = text.match(hashtagRegex) || [];
    const contentWithoutHashtags = text.replace(hashtagRegex, '').trim();

    if (isYouTube) {
      return {
        title: contentWithoutHashtags || 'YouTube title',
        description: contentWithoutHashtags || 'YouTube description',
        hashtags: foundHashtags.length > 0 ? foundHashtags : ['#video', '#content', '#media'],
      };
    }
    return {
      caption: contentWithoutHashtags || 'Social media caption',
      hashtags: foundHashtags.length > 0 ? foundHashtags : ['#social', '#media', '#content'],
    };
  }

  private createFallbackSingle(platform: string, rawText: string, metadata: any) {
    const isYouTube = platform === 'youtube';
    const hashtagRegex = /#\w+/g;
    const foundHashtags = rawText.match(hashtagRegex) || [];
    const contentWithoutHashtags = rawText.replace(hashtagRegex, '').trim();

    if (isYouTube) {
      return {
        success: true,
        title: contentWithoutHashtags || 'YouTube title',
        description: contentWithoutHashtags || 'YouTube description',
        hashtags: foundHashtags,
        platform: platform,
        contentTone: metadata.contentTone,
        includeHashtags: metadata.includeHashtags,
        mediaUrl: metadata.mediaUrl,
      };
    }
    return {
      success: true,
      caption: contentWithoutHashtags || 'Social media caption',
      hashtags: foundHashtags,
      platform: platform,
      contentTone: metadata.contentTone,
      includeHashtags: metadata.includeHashtags,
      mediaUrl: metadata.mediaUrl,
    };
  }

  private buildMultiPlatformPrompt(platforms: string[], prompt: string, contentTone: string, includeHashtags: boolean, platformGuidelines: any): string {
    const platformExamples = platforms
      .map(p => {
        const isYouTube = p === 'youtube';
        return isYouTube
          ? `"${p.toUpperCase()}": {\n  "title": "YouTube title here",\n  "description": "YouTube description here",\n  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]\n}`
          : `"${p.toUpperCase()}": {\n  "caption": "${p} caption here",\n  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]\n}`;
      })
      .join(',\n');

    return `You are a social media content expert. Analyze the media and generate platform-specific content.\n\nINSTRUCTIONS:\n- Generate unique content for EACH platform\n- Tone: ${contentTone}\n- ${includeHashtags ? 'Include 5 relevant hashtags per platform' : 'No hashtags'}\n- Keep captions and hashtags separate\n- Return valid JSON with platform keys in UPPERCASE\n\nREQUIRED JSON FORMAT:\n{\n${platformExamples}\n}\n\nPLATFORM GUIDELINES:\n${platforms.map(p => `${p.toUpperCase()}: ${platformGuidelines[p]}`).join('\n')}\n\nUSER PROMPT: ${prompt}\n\nReturn ONLY the JSON object, no additional text or explanations.`;
  }

  private buildSinglePlatformPrompt(platform: string, prompt: string, contentTone: string, includeHashtags: boolean, platformGuidelines: any): string {
    const isYouTube = platform === 'youtube';
    const jsonFormat = isYouTube
      ? `{"title": "YouTube title here",\n"description": "YouTube description here",\n"hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]}`
      : `{"caption": "${platform} caption here",\n"hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]}`;

    return `You are a social media content expert. Analyze the media and generate content for ${platform}.\n\nPLATFORM: ${platform.toUpperCase()}\nStyle: ${platformGuidelines[platform]}\nTone: ${contentTone}\n${includeHashtags ? 'Include 5 relevant hashtags' : 'No hashtags'}\n\nJSON Response (return ONLY this JSON):\n${jsonFormat}\n\n${platform === 'twitter' ? 'Keep caption under 280 characters!' : ''}\n\nUSER PROMPT: ${prompt}\n\nReturn ONLY valid JSON, no additional text.`;
  }

  async getPlatformLimits(platform: string): Promise<any> {
    const serviceAccountPath = path.join(__dirname, process.env.JSON_KEY_PATH!);
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    const auth = new GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const client = await auth.getClient();

    const projectId = process.env.PROJECT_ID!;
    const model = process.env.MODEL_NAME;
    const apiUrl = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

    const isYouTube = platform.toLowerCase() === 'youtube';
    const isLinkedIn = platform.toLowerCase() === 'linkedin';
    
    let prompt;
    if (isYouTube) {
      prompt = `Return the exact content validation limits for ${platform} social media platform. For YouTube, provide separate limits for title and description. Use "no-limit" instead of 0 for unlimited fields. Provide ONLY valid JSON with no additional text:

{"title": {"minChars": number, "maxChars": number}, "description": {"minChars": number, "maxChars": number, "minHashtags": number, "maxHashtags": number}}`;
    } else if (isLinkedIn) {
      prompt = `Return the exact content validation limits for ${platform} social media platform. For LinkedIn, provide separate limits for posts and article headlines. Use "no-limit" instead of 0 for unlimited fields. Provide ONLY valid JSON with no additional text:

{"post": {"minChars": number, "maxChars": number, "minHashtags": number, "maxHashtags": number}, "headline": {"minChars": number, "maxChars": number}}`;
    } else {
      prompt = `Return the exact content validation limits for ${platform} social media platform. Use "no-limit" instead of 0 for unlimited fields. Provide ONLY valid JSON with no additional text:

{"minChars": number, "maxChars": number, "minHashtags": number, "maxHashtags": number}`;
    }

    const requestBody = {
      contents: {
        role: 'user',
        parts: [{ text: prompt }]
      }
    };

    const response: any = await client.request({ url: apiUrl, method: 'POST', data: requestBody });
    const text = response?.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    
    if (!text) throw new Error('No response from Gemini API');
    
    let cleanText = text.replace(/```json\s*|\s*```/g, '').trim();
    if (!cleanText.startsWith('{')) {
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleanText = jsonMatch[0];
    }
    
    return JSON.parse(cleanText);
  }

  private getMimeType(url: string): string {
    if (url.includes('.jpg') || url.includes('.jpeg')) return 'image/jpeg';
    if (url.includes('.png')) return 'image/png';
    if (url.includes('.gif')) return 'image/gif';
    if (url.includes('.webp')) return 'image/webp';
    if (url.includes('.mp4')) return 'video/mp4';
    if (url.includes('.mov')) return 'video/quicktime';
    if (url.includes('.avi')) return 'video/x-msvideo';
    if (url.includes('.mkv')) return 'video/x-matroska';
    if (url.includes('.webm')) return 'video/webm';
    return 'image/jpeg';
  }
}
