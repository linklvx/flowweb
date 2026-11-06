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
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  GetBucketReplicationCommand,
  GetObjectLockConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
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
   *  越界由 S3 抛错（$metadata.httpStatusCode=416）交调用方映射，缺失对象同抛 404）。
   *  单区间边界：S3 语义不产 multipart/byteranges 多段响应（本路径消费方=浏览器 media/img
   *  只发单段 Range——多段形态不在支持面，Minor-3 注释补据）。 */
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

  // ── C4-c2（plan Task C4-3 ★红⑮——生产就绪收尾批·project-erasure）：对象存储 capability detect
  //    +版本化/非版本化删除面。既有面零行为变化（纯增量）；消费方=project-erasure.objects 执行体。
  //    语义契约（spec §3 C4 版本化 capability detect）：
  //    - GetBucketVersioning→Enabled=ListObjectVersions 逐版本（含 DeleteMarkers）DeleteObjects 带版本
  //      （旧版本全删——非版本化 delete 只删现行、旧版本静默残留=假绿根修）；
  //    - 非版本化=DeleteObjects 现行对象（1000/批——S3 单请求上限）；
  //    - ListMultipartUploads/Abort=multipart 残件清理（未 Complete 残件不计入对象清单、单独面）；
  //    - replication/object-lock/lifecycle=**能力披露面非执法面**（规则在位→调用方诚实披露
  //      〔日志+指标+runbook §13〕——本层不假装全清：副本桶/锁定对象的远端保留期超出本系统权限域）。 ──

  /** 桶版本化状态（GetBucketVersioning——Status 缺席=从未开启=Unversioned）。 */
  async getBucketVersioningStatus(): Promise<'Enabled' | 'Suspended' | 'Unversioned'> {
    const res = await this.s3Client.send(new GetBucketVersioningCommand({ Bucket: this.bucket }));
    if (res.Status === 'Enabled') return 'Enabled';
    if (res.Status === 'Suspended') return 'Suspended';
    return 'Unversioned';
  }

  /** 单 key 全版本清单（含 DeleteMarker——VersionId+IsDeleteMarker；分页 1000）。 */
  async listObjectVersionRefs(key: string): Promise<Array<{ key: string; versionId: string }>> {
    const out: Array<{ key: string; versionId: string }> = [];
    let token: string | undefined;
    do {
      const res = await this.s3Client.send(new ListObjectVersionsCommand({
        Bucket: this.bucket, Prefix: key, MaxKeys: 1000, ...(token ? { KeyMarker: token } : {}),
      }));
      for (const v of res.Versions ?? []) out.push({ key: v.Key!, versionId: v.VersionId! });
      for (const d of res.DeleteMarkers ?? []) out.push({ key: d.Key!, versionId: d.VersionId! });
      token = res.NextKeyMarker ?? undefined;
    } while (token);
    return out;
  }

  /** 非版本化现行对象批删（1000/批；幂等——S3 语义对不存在键静默成功）。返回请求删除数。 */
  async deleteObjectsByKeys(keys: readonly string[]): Promise<number> {
    let n = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      if (batch.length === 0) continue;
      await this.s3Client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch } }));
      n += batch.length;
    }
    return n;
  }

  /** 版本化逐版本批删（1000/批——Key+VersionId 精确指版本；幂等同上）。 */
  async deleteObjectVersions(versions: ReadonlyArray<{ Key: string; VersionId: string }>): Promise<number> {
    let n = 0;
    for (let i = 0; i < versions.length; i += 1000) {
      const batch = versions.slice(i, i + 1000);
      if (batch.length === 0) continue;
      await this.s3Client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch } }));
      n += batch.length;
    }
    return n;
  }

  /** 在飞 multipart 上传清单（分页；残件=未 Complete 的分片上传——单独计费+残留面）。 */
  async listMultipartUploads(): Promise<Array<{ key: string; uploadId: string }>> {
    const out: Array<{ key: string; uploadId: string }> = [];
    let token: string | undefined;
    do {
      const res = await this.s3Client.send(new ListMultipartUploadsCommand({
        Bucket: this.bucket, MaxUploads: 1000, ...(token ? { KeyMarker: token } : {}),
      }));
      for (const u of res.Uploads ?? []) out.push({ key: u.Key!, uploadId: u.UploadId! });
      token = res.NextKeyMarker ?? undefined;
    } while (token);
    return out;
  }

  /** 中止 multipart 残件（Abort=分片与上传登记一并清）。 */
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3Client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }

  /** 复制规则数（无配置=0——NoSuchReplicationConfiguration 折零非错；>0=副本桶披露面）。 */
  async getReplicationRuleCount(): Promise<number> {
    try {
      const res = await this.s3Client.send(new GetBucketReplicationCommand({ Bucket: this.bucket }));
      return res.ReplicationConfiguration?.Rules?.length ?? 0;
    } catch (e) {
      if (this.isNotFoundConfig(e)) return 0;
      throw e;
    }
  }

  /** 对象锁在位判定（ObjectLockConfigurationNotFoundError→false；true=合规保留锁披露面）。 */
  async getObjectLockEnabled(): Promise<boolean> {
    try {
      const res = await this.s3Client.send(new GetObjectLockConfigurationCommand({ Bucket: this.bucket }));
      return res.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
    } catch (e) {
      if (this.isNotFoundConfig(e)) return false;
      throw e;
    }
  }

  /** lifecycle 规则数（无配置=0；>0=桶策略可能与擦除交互——披露面）。 */
  async getLifecycleRuleCount(): Promise<number> {
    try {
      const res = await this.s3Client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }));
      return res.Rules?.length ?? 0;
    } catch (e) {
      if (this.isNotFoundConfig(e)) return 0;
      throw e;
    }
  }

  /** 「无该配置」错误分型（S3 族 NotFound 形态各异——名字+404 双判）。 */
  private isNotFoundConfig(e: unknown): boolean {
    const name = (e as { name?: string })?.name;
    if (name === 'NoSuchReplicationConfiguration' || name === 'ObjectLockConfigurationNotFoundError'
      || name === 'NoSuchLifecycleConfiguration') return true;
    return (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
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
