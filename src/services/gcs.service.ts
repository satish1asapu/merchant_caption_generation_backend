import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

@Injectable()
export class GcsService {
  private storage: Storage;
  private bucketName: string;

  constructor() {
    this.bucketName = process.env.BUCKET_NAME!;
    if (!this.bucketName) throw new Error('BUCKET_NAME is required');
    const serviceAccountPath = path.join(__dirname, process.env.JSON_KEY_PATH!);
    this.storage = new Storage({ keyFilename: serviceAccountPath });
  }

  async uploadFile(fileBuffer: Buffer, filename: string, mimeType: string, folder = 'media'): Promise<string> {
    const bucket = this.storage.bucket(this.bucketName);
    const safeFilename = encodeURIComponent(filename);
    const file = bucket.file(`${folder}/${filename}`);
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
        cacheControl: 'public, max-age=300',
      },
    });
    
    // No need to call makePublic() - bucket has uniform bucket-level access enabled
    // and is already publicly accessible
    
    return `https://storage.googleapis.com/${this.bucketName}/${folder}/${safeFilename}`;
  }
}
