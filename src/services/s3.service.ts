import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private s3: S3Client;
  private bucketName: string;
  private region: string;

  constructor() {
    this.bucketName = process.env.AWS_S3_BUCKET_NAME as string;
    this.region = process.env.AWS_REGION as string;

    if (!this.bucketName || !this.region) {
      throw new Error('AWS_S3_BUCKET_NAME and AWS_REGION are required');
    }

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    });
  }

  async uploadFile(params: {
    fileBuffer: Buffer;
    filename: string;
    mimeType: string;
    clientId: string;
    projectId: string;
    type: string; // image or video
  }): Promise<string> {
    const { fileBuffer, filename, mimeType, clientId, projectId, type } = params;
    const key = `ai-caption-gen/${clientId}/${type}/${projectId}/${filename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=300'
      })
    );

    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${encodeURI(key)}`;
  }
}
