import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
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
  private readonly logger = new Logger(MinioService.name);

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
      tls: config.useSsl,
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
        return `results/${userId}/${opts.projectId || 'default'}/${opts.nodeId || 'unknown'}/${date}/${uuid}.${ext}`;
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
      ],
      // Y1b T4（Z7''）：Content-Type 进 fields+policy 精确匹配——客户端 FormData 回传的
      // Content-Type 字段与 presign 时不一致 ⇒ MinIO 403（旧注释"FormData 外层是
      // multipart/form-data 故不绑"是误解：policy 校验的是名为 Content-Type 的表单字段，
      // 客户端逐项回传 fields 即命中——web mediaUploadUtils 正是全量回传）。字节级真身仍由 confirm 嗅探把关。
      Fields: { 'Content-Type': contentType },
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

  /** Y1a+Y1b T5：content 路由 ready 态流式读——Range 透传（S3 语义：206+Content-Range；
   *  越界由 S3 抛错（$metadata.httpStatusCode=416）交调用方映射，缺失对象同抛 404）。 */
  async getObjectRanged(key: string, range?: string): Promise<{
    status: number; stream: Readable; contentLength: number | null; contentRange: string | null; etag: string | null;
  }> {
    const response = await this.s3Client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(range ? { Range: range } : {}),
    }));
    return {
      status: response.$metadata.httpStatusCode ?? 200,
      stream: response.Body as Readable,
      contentLength: response.ContentLength ?? null,
      contentRange: response.ContentRange ?? null,
      etag: response.ETag ?? null,
    };
  }

  /** Y1b T4：取对象头字节（confirm MIME 嗅探）——Range 限定只拉前 maxBytes，
   *  到量即销流（1GB 视频不整读；file-type 判型只需头部魔数）。
   *  maxBytes=4100 出处：file-type 头部取样惯例值——magic bytes 检测所需头部远小于此。 */
  async getHeadBytes(key: string, maxBytes: number = 4100): Promise<Buffer> {
    const response = await this.s3Client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Range: `bytes=0-${maxBytes - 1}`,
    }));
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    let total = 0;
    return new Promise<Buffer>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks));
      };
      stream.on('data', (c: Buffer) => {
        const take = Math.min(c.length, maxBytes - total);
        chunks.push(c.subarray(0, take)); // 超量 chunk 截断——恰收前 maxBytes
        total += take;
        if (total >= maxBytes) stream.destroy(); // 'close' 收尾
      });
      stream.on('end', finish);
      stream.on('close', finish);
      stream.on('error', reject);
    });
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

  /** 统一大小口径：HeadObjectCommand 输出是 ContentLength（无 size 字段） */
  async statSize(key: string): Promise<number> {
    const stats = await this.statObject(key);
    return stats.ContentLength ?? 0;
  }

  /** Ensure the configured bucket exists; create it if missing */
  async ensureBucket(retries: number = 3, delay: number = 1000): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket '${this.bucket}' already exists`);
    } catch (err: any) {
      const status = err.$metadata?.httpStatusCode;
      const name = err.name;

      if (status === 404 || name === 'NotFound') {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket '${this.bucket}' created successfully`);
      } else if (status === 409 || name === 'BucketAlreadyExists') {
        this.logger.log(`Bucket '${this.bucket}' already exists (created by another instance)`);
      } else if (retries > 0) {
        this.logger.warn(`MinIO not ready, retrying (${retries} left)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        await this.ensureBucket(retries - 1, delay);
      } else {
        this.logger.error(`MinIO init failed: ${err.message}`);
        throw new Error(`MinIO initialization failed: ${err.message}`, { cause: err });
      }
    }
  }
}
