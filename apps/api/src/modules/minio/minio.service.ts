import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'crypto';

export interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSsl: boolean;
}

@Injectable()
export class MinioService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(config: MinioConfig) {
    this.bucket = config.bucket;

    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true, // MinIO MUST use path-style URLs
    });
  }

  /** Build MinIO object key with date partition */
  buildKey(
    type: 'uploaded' | 'generated' | 'temp',
    userId: string,
    opts: { projectId?: string; nodeId?: string; ext?: string },
  ): string {
    const date = new Date().toISOString().slice(0, 10);
    const uuid = randomUUID();
    const ext = opts.ext || 'bin';

    switch (type) {
      case 'uploaded':
        return `uploads/${userId}/${date}/${uuid}.${ext}`;
      case 'generated':
        return `results/${userId}/${opts.projectId}/${opts.nodeId}/${date}/${uuid}.${ext}`;
      case 'temp':
        return `temp/${userId}/${date}/${uuid}.${ext}`;
    }
  }

  /** Generate presigned POST upload URL with security conditions */
  async generatePresignedPost(
    key: string,
    contentType: string,
    fileSize: number,
    expiresIn: number = 900,
  ) {
    return createPresignedPost(this.s3Client, {
      Bucket: this.bucket,
      Key: key,
      Expires: expiresIn,
      Conditions: [
        ['content-length-range', fileSize - 1024, fileSize + 1024],
        // Note: NOT enforcing $Content-Type here because FormData POST
        // always sends multipart/form-data, not the file's actual MIME type.
        // MIME type validation is done server-side after upload.
      ],
    });
  }

  /** Generate presigned GET download URL */
  async generatePresignedGetUrl(key: string, expiresIn: number = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /** Download object stream from MinIO */
  async getObject(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.s3Client.send(command);
    return response.Body as Readable;
  }

  /** Upload file buffer to MinIO */
  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Delete object from MinIO */
  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /** Get object metadata (existence check + size) */
  async statObject(key: string) {
    return this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
