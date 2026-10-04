<!-- doc-status: historical | verified_at: n/a -->
# MinIO Bucket 自动创建方案

## 背景

MinIO 启动后 `flowai` bucket 不会自动创建。`minio-reset` 清空数据目录后 bucket 丢失，导致文件上传报 `NoSuchBucket` → `ERR_CONNECTION_RESET`。

当前解决方案是手动创建 bucket，不可持续。

## 目标

- API 启动时自动检查并创建 `flowai` bucket
- `minio-reset` 后无需手动干预
- MinIO 未就绪时自动重试
- 处理并发启动的 409 Conflict

## 设计

### 改动文件

| 文件 | 改动 |
|------|------|
| `apps/api/src/modules/minio/minio.service.ts` | 新增导入、tls、ensureBucket |
| `apps/api/src/modules/minio/minio.module.ts` | 实现 OnModuleInit |

### minio.service.ts

新增导入：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,   // 新增
  CreateBucketCommand,  // 新增
} from '@aws-sdk/client-s3';
```

修复未使用的 `useSsl`：

```typescript
this.s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: config.endpoint,
  credentials: {
    accessKeyId: config.accessKey,
    secretAccessKey: config.secretKey,
  },
  forcePathStyle: true,
  tls: config.useSsl,  // 新增
});
```

新增 `ensureBucket()` 方法：

```typescript
private readonly logger = new Logger(MinioService.name);

async ensureBucket(retries: number = 3, delay: number = 1000): Promise<void> {
  try {
    await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    this.logger.log(`Bucket '${this.bucket}' already exists`);
  } catch (err: any) {
    const status = err.$metadata?.httpStatusCode;
    const name = err.name;

    // 404: doesn't exist -> create. 409: created by another instance -> skip.
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
      throw new Error(`MinIO initialization failed: ${err.message}`);
    }
  }
}
```

### minio.module.ts

新增 `OnModuleInit`：

```typescript
import { Module, OnModuleInit } from '@nestjs/common';

export class MinioModule implements OnModuleInit {
  constructor(private readonly minioService: MinioService) {}

  async onModuleInit() {
    await this.minioService.ensureBucket();
  }
}
```

## 行为

| 场景 | 行为 |
|------|------|
| bucket 已存在 | `HeadBucket` 成功 → 日志 `already exists` |
| bucket 不存在 | `HeadBucket` 404 → `CreateBucket` → 日志 `created` |
| 并发创建 (409) | `HeadBucket` 409 → 日志 `created by another instance` |
| MinIO 未就绪 | 重试最多 3 次，间隔 1s |
| 3 次后仍失败 | 抛异常，API 启动失败 |

## 边界情况

| 场景 | 行为 |
|------|------|
| 网络权限错误 | 重试 3 次后抛异常 |
| bucket 存在但无权限 | 重试 3 次后抛异常 |
| 并发启动（多实例） | 409 Conflict 被视为成功，跳过创建 |

## 不变更的部分

- `.env` / `launch.json` — 不涉及
- 前端上传逻辑 — 不涉及
- 现有 `validateEnv()` 模式 — 不引入 ConfigModule
- 现有方法：`buildKey`, `generatePresignedPost`, `generatePresignedGetUrl`, `getObject`, `upload`, `delete`, `statObject` — 不修改

## 验证标准

1. 首次启动 → API 日志显示 `Bucket 'flowai' created`
2. 已有 bucket 时启动 → API 日志显示 `Bucket 'flowai' already exists`
3. `minio-reset` 后启动 → bucket 自动创建，上传正常
4. 上传文件到素材库 → 成功，无 404/ERR_CONNECTION_RESET
