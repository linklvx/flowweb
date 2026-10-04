<!-- doc-status: historical | verified_at: n/a -->
# MinIO Bucket 自动创建 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API 启动时自动检查并创建 `flowai` bucket，解决 `minio-reset` 后 bucket 丢失导致上传失败问题

**Architecture:** 在 `MinioService` 中新增 `ensureBucket()` 方法，通过 `MinioModule.onModuleInit` 在启动时调用；2 个文件改动，纯服务端变更

**Tech Stack:** NestJS 10, @aws-sdk/client-s3, Vitest

---

### Task 1: 编写 ensureBucket 测试

**Files:**
- Modify: `apps/api/src/modules/minio/minio.service.spec.ts`

- [ ] **Step 1: 添加 ensureBucket 测试用例**

在 `minio.service.spec.ts` 的 `describe('MinioService', () => {` 块内末尾（最后一个 `it` 之后）添加：

```typescript
  it('should have ensureBucket method', () => {
    expect(typeof service.ensureBucket).toBe('function');
  });

  describe('ensureBucket', () => {
    it('should be a function accepting optional retries and delay', () => {
      expect(service.ensureBucket.length).toBe(2); // (retries, delay)
    });
  });
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd apps/api && npx vitest run src/modules/minio/minio.service.spec.ts
```

预期：新增测试 FAIL — `ensureBucket` 方法尚不存在。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/minio/minio.service.spec.ts
git commit -m "test: add ensureBucket tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 实现 ensureBucket 方法

**Files:**
- Modify: `apps/api/src/modules/minio/minio.service.ts`

- [ ] **Step 1: 更新导入**

将文件顶部的导入修改为：

```typescript
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
```

- [ ] **Step 2: 添加 logger 属性**

在 `MinioService` 类中，`s3Client` 和 `bucket` 属性之后添加：

```typescript
  private readonly logger = new Logger(MinioService.name);
```

- [ ] **Step 3: 修复未使用的 useSsl**

在构造函数中，将 `this.s3Client = new S3Client({` 配置块添加 `tls`：

```typescript
    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
      tls: config.useSsl,
    });
```

- [ ] **Step 4: 添加 ensureBucket 方法**

在 `statObject` 方法之后，类结束 `}` 之前添加：

```typescript
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
        throw new Error(`MinIO initialization failed: ${err.message}`);
      }
    }
  }
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd apps/api && npx vitest run src/modules/minio/minio.service.spec.ts
```

预期：所有测试 PASS（包括新增的 ensureBucket 测试）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/minio/minio.service.ts
git commit -m "feat: add ensureBucket to MinioService for auto bucket creation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: MinioModule 实现 OnModuleInit

**Files:**
- Modify: `apps/api/src/modules/minio/minio.module.ts`

- [ ] **Step 1: 更新导入和类声明**

将 `minio.module.ts` 完整替换为：

```typescript
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { MinioService, MinioConfig } from './minio.service';
import { validateEnv } from '../../config/env';

@Global()
@Module({
  providers: [
    {
      provide: MinioService,
      useFactory: () => {
        const env = validateEnv();
        const config: MinioConfig = {
          endpoint: env.MINIO_ENDPOINT,
          accessKey: env.MINIO_ACCESS_KEY,
          secretKey: env.MINIO_SECRET_KEY,
          bucket: env.MINIO_BUCKET,
          useSsl: env.MINIO_USE_SSL,
        };
        return new MinioService(config);
      },
    },
  ],
  exports: [MinioService],
})
export class MinioModule implements OnModuleInit {
  constructor(private readonly minioService: MinioService) {}

  async onModuleInit() {
    await this.minioService.ensureBucket();
  }
}
```

- [ ] **Step 2: 验证编译通过**

```bash
cd apps/api && npx tsc --noEmit
```

预期：编译无错误。

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/minio/minio.module.ts
git commit -m "feat: call ensureBucket on MinioModule init

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 端到端验证

**Files:**
- 无新增文件

- [ ] **Step 1: 停止并重启 API**

```bash
preview_stop <api-server-id>
preview_start api
```

- [ ] **Step 2: 检查 API 日志确认 bucket 创建**

从 preview_logs 搜索 bucket 相关日志：

```bash
# API 日志中应出现:
# Bucket 'flowai' created  或  Bucket 'flowai' already exists
```

- [ ] **Step 3: 验证 bucket 存在**

```bash
curl -s http://localhost:9000/flowai
```

预期：`AccessDenied`（bucket 存在，匿名访问被拒）。

- [ ] **Step 4: 测试上传流程**

1. 登录前端 → 素材库 → 上传测试图片
2. 确认上传成功，图片在素材库显示
3. F12 确认无 `NoSuchBucket` 或 `ERR_CONNECTION_RESET` 错误

- [ ] **Step 5: 测试 minio-reset 后自动恢复**

```bash
# 停止 MinIO 和 API
preview_stop <minio-server-id>
preview_stop <api-server-id>

# minio-reset 清空数据
preview_start minio-reset

# 启动 API（应自动创建 bucket）
preview_start api
```

验证：API 日志显示 `Bucket 'flowai' created`。

- [ ] **Step 6: 再次测试上传**

上传文件 → 成功，无错误。

- [ ] **Step 7: 最终 Commit（如有调整）**

```bash
git status
```
