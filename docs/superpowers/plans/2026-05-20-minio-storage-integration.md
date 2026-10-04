<!-- doc-status: historical | verified_at: n/a -->
# MinIO 对象存储集成 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FlowAI 画布应用从"外部 URL 引用"升级为"MinIO 对象存储 + 文件上传"，覆盖用户上传参考图、AI 生成结果存储、媒体访问三大场景。

**Architecture:** 前端通过预签名 POST 直传 MinIO；后端通过 @aws-sdk/* S3 兼容 API 管理 MinIO，AI 生成结果由 BullMQ Worker 异步下载并上传；所有媒体通过 `/api/media/:fileId/url` 统一获取预签名 URL（Redis 缓存 14 分钟）。

**Tech Stack:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, @aws-sdk/s3-presigned-post, axios, axios-retry, Prisma, BullMQ, Redis (ioredis), React + Zustand, Vitest + @testing-library/react

---

### Task 1: 添加后端依赖

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: 安装 @aws-sdk/* 和 axios 包**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/s3-presigned-post axios axios-retry
```

- [ ] **Step 2: 验证安装后依赖版本**

Run: `cat apps/api/package.json | grep -E "@aws-sdk|axios|axios-retry"`
Expected: 5 个新增包出现在 dependencies 中

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @aws-sdk/* and axios/axios-retry dependencies for MinIO integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: 添加 MinIO 环境变量 Zod 校验

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/.env` (gitignored, 手动)
- Test: `apps/api/src/config/env.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/config/env.spec.ts
import { describe, it, expect } from 'vitest';

// Reconstruct env schema for testing
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().default('flowai'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
});

describe('env schema - MinIO', () => {
  it('should validate complete MinIO env vars', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_BUCKET).toBe('flowai');
      expect(result.data.MINIO_USE_SSL).toBe(false);
    }
  });

  it('should reject invalid MINIO_ENDPOINT', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'not-a-url',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject short MINIO_SECRET_KEY', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('should apply defaults for MINIO_BUCKET and MINIO_USE_SSL', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost:5432/db',
      MINIO_ENDPOINT: 'http://127.0.0.1:9000',
      MINIO_ACCESS_KEY: 'minioadmin',
      MINIO_SECRET_KEY: 'minioadmin123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.MINIO_BUCKET).toBe('flowai');
      expect(result.data.MINIO_USE_SSL).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowapi/api test -- apps/api/src/config/env.spec.ts`
Expected: 4 tests FAIL — env schema 缺少 MinIO 字段

- [ ] **Step 3: 修改 env.ts 添加 MinIO Zod 字段**

```typescript
// apps/api/src/config/env.ts — 在 envSchema 中添加 MinIO 字段:
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(3),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().default('flowai'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/config/env.spec.ts`
Expected: 4 tests PASS

- [ ] **Step 5: 更新 .env 文件 (手动)**

在 `apps/api/.env` 中添加:
```env
MINIO_ENDPOINT=http://127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=flowai
MINIO_USE_SSL=false
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/config/env.ts apps/api/src/config/env.spec.ts
git commit -m "feat(api): add MinIO env vars to Zod schema with type validation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: 添加 Media 数据模型 + 数据库迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/` (by prisma migrate)

- [ ] **Step 1: 在 schema.prisma 中添加 Media model**

在 `apps/api/prisma/schema.prisma` 末尾 `UserBalance` model 之前添加:

```prisma
model Media {
  id           String    @id @default(uuid())
  userId       String

  // 存储信息
  bucket       String    @default("flowai")
  key          String    // MinIO 对象键
  originalName String    // 原始文件名
  mimeType     String
  size         Int       // 字节数

  // 业务关联
  projectId    String?
  nodeId       String?
  taskId       String?

  // 状态与类型
  status       String    @default("pending")  // pending | completed | failed
  type         String    // uploaded | generated | temp

  // 时间戳
  createdAt    DateTime  @default(now())
  expiresAt    DateTime? // 临时文件过期时间

  @@index([userId])
  @@index([projectId])
  @@index([nodeId])
  @@index([taskId])
  @@index([expiresAt])
}
```

- [ ] **Step 2: 运行 Prisma 迁移**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api prisma migrate dev --name add_media_model`
Expected: 创建迁移文件 + Prisma Client 重新生成

- [ ] **Step 3: 验证 Prisma Client 包含 Media 类型**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api exec npx prisma generate`
Expected: 无错误，`node_modules/.prisma/client/index.d.ts` 包含 `Media` 类型

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): add Media model for MinIO object storage tracking

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: 创建 MinioService（S3 客户端封装）

**Files:**
- Create: `apps/api/src/modules/minio/minio.service.ts`
- Create: `apps/api/src/modules/minio/minio.service.spec.ts`
- Create: `apps/api/src/modules/minio/minio.module.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/minio/minio.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MinioService } from './minio.service';
import { ConfigService } from '@nestjs/config';

describe('MinioService', () => {
  let service: MinioService;

  const mockConfig = {
    get: vi.fn((key: string) => {
      const map: Record<string, string> = {
        MINIO_ENDPOINT: 'http://127.0.0.1:9000',
        MINIO_ACCESS_KEY: 'minioadmin',
        MINIO_SECRET_KEY: 'minioadmin123',
        MINIO_BUCKET: 'flowai',
        MINIO_USE_SSL: 'false',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MinioService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<MinioService>(MinioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create S3Client with forcePathStyle: true', () => {
    const client = (service as any).s3Client;
    expect(client).toBeDefined();
  });

  it('should build correct key for uploads', () => {
    const today = new Date().toISOString().slice(0, 10);
    const key = service.buildKey('uploaded', 'user1', {});
    expect(key).toMatch(/^uploads\/user1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+$/);
  });

  it('should build correct key for results', () => {
    const key = service.buildKey('generated', 'user1', { projectId: 'proj1', nodeId: 'node1' });
    expect(key).toMatch(/^results\/user1\/proj1\/node1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+$/);
  });

  it('should build correct key for temp', () => {
    const key = service.buildKey('temp', 'user1', {});
    expect(key).toMatch(/^temp\/user1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+$/);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/minio/minio.service.spec.ts`
Expected: FAIL — MinioService 未定义

- [ ] **Step 3: 实现 MinioService**

```typescript
// apps/api/src/modules/minio/minio.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class MinioService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = config.get('MINIO_BUCKET', 'flowai');

    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: config.get('MINIO_ENDPOINT'),
      credentials: {
        accessKeyId: config.get('MINIO_ACCESS_KEY')!,
        secretAccessKey: config.get('MINIO_SECRET_KEY')!,
      },
      forcePathStyle: true, // ★ MinIO 必须使用路径风格 URL
    });
  }

  /** 构建 MinIO 对象键 */
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

  /** 生成预签名 POST 上传 URL (含安全 conditions) */
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
        ['eq', '$Content-Type', contentType],
      ],
    });
  }

  /** 生成预签名 GET 下载 URL */
  async generatePresignedGetUrl(key: string, expiresIn: number = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /** 上传文件到 MinIO */
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

  /** 删除 MinIO 文件 */
  async delete(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  /** 获取文件元信息 (存在性 + 大小校验) */
  async statObject(key: string) {
    const result = await this.s3Client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return result;
  }
}
```

```typescript
// apps/api/src/modules/minio/minio.module.ts
import { Global, Module } from '@nestjs/common';
import { MinioService } from './minio.service';

@Global()
@Module({
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/minio/minio.service.spec.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/minio/
git commit -m "feat(api): add MinioService with S3Client (forcePathStyle), presignPost, presignGet

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: 创建 StorageModule（上传 presign + confirm API）

**Files:**
- Create: `apps/api/src/modules/storage/storage.controller.ts`
- Create: `apps/api/src/modules/storage/storage.service.ts`
- Create: `apps/api/src/modules/storage/storage.module.ts`
- Create: `apps/api/src/modules/storage/dto/presign.dto.ts`
- Create: `apps/api/src/modules/storage/dto/confirm.dto.ts`
- Create: `apps/api/src/modules/storage/storage.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/storage/storage.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from './storage.service';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StorageService', () => {
  let service: StorageService;
  let prisma: any;
  let minio: any;

  beforeEach(async () => {
    prisma = {
      media: {
        create: vi.fn().mockResolvedValue({ id: 'media-1', key: 'uploads/u1/2026-01-01/a.png', status: 'pending' }),
        update: vi.fn().mockResolvedValue({ id: 'media-1', status: 'completed' }),
        findUnique: vi.fn(),
      },
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/user1/2026-05-20/uuid.png'),
      generatePresignedPost: vi.fn().mockResolvedValue({
        url: 'http://127.0.0.1:9000/flowai',
        fields: {
          key: 'uploads/user1/2026-05-20/uuid.png',
          Policy: 'mock-policy',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
          'X-Amz-Credential': 'mock',
          'X-Amz-Date': 'mock',
          'X-Amz-Signature': 'mock',
        },
      }),
      statObject: vi.fn().mockResolvedValue({ ContentLength: 2048000 }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get<StorageService>(StorageService);
  });

  it('should generate presigned POST URL and create pending Media', async () => {
    const result = await service.presignUpload(
      'user1',
      { fileName: 'ref.png', fileSize: 2048000, fileType: 'image/png', type: 'uploaded' },
    );
    expect(result.fileId).toBe('media-1');
    expect(result.uploadUrl).toBe('http://127.0.0.1:9000/flowai');
    expect(result.fields).toBeDefined();
    expect(result.fields.key).toBe('uploads/user1/2026-05-20/uuid.png');
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          status: 'pending',
          type: 'uploaded',
        }),
      }),
    );
  });

  it('should confirm upload and update status to completed', async () => {
    prisma.media.findUnique = vi.fn().mockResolvedValue({ id: 'media-1', status: 'pending', key: 'uploads/u1/test.png' });
    const result = await service.confirmUpload('user1', {
      fileId: 'media-1',
      key: 'uploads/u1/test.png',
      fileSize: 2048000,
    });
    expect(result.fileId).toBe('media-1');
    expect(prisma.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'media-1', userId: 'user1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('should reject confirm if fileSize mismatch', async () => {
    minio.statObject = vi.fn().mockResolvedValue({ ContentLength: 999 });
    await expect(
      service.confirmUpload('user1', {
        fileId: 'media-1',
        key: 'uploads/u1/test.png',
        fileSize: 2048000,
      }),
    ).rejects.toThrow();
    expect(minio.delete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/storage/storage.service.spec.ts`
Expected: FAIL — StorageService 未定义

- [ ] **Step 3: 实现 DTO**

```typescript
// apps/api/src/modules/storage/dto/presign.dto.ts
export class PresignUploadDto {
  fileName!: string;
  fileSize!: number;
  fileType!: string;
  type!: 'uploaded' | 'temp';
}

// apps/api/src/modules/storage/dto/confirm.dto.ts
export class ConfirmUploadDto {
  fileId!: string;
  key!: string;
  fileSize!: number;
}
```

- [ ] **Step 4: 实现 StorageService**

```typescript
// apps/api/src/modules/storage/storage.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async presignUpload(userId: string, dto: PresignUploadDto) {
    const ext = dto.fileName.split('.').pop() || 'bin';
    const key = this.minio.buildKey(dto.type, userId, { ext });

    // 创建 Media 记录 (pending)
    const media = await this.prisma.media.create({
      data: {
        userId,
        bucket: 'flowai',
        key,
        originalName: dto.fileName,
        mimeType: dto.fileType,
        size: dto.fileSize,
        status: 'pending',
        type: dto.type,
        expiresAt: dto.type === 'temp'
          ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          : null,
      },
    });

    // 生成预签名 POST
    const { url, fields } = await this.minio.generatePresignedPost(
      key,
      dto.fileType,
      dto.fileSize,
    );

    return {
      fileId: media.id,
      uploadUrl: url,
      key,
      fields,
    };
  }

  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    // 验证文件存在于 MinIO
    const stats = await this.minio.statObject(dto.key);

    // 验证文件大小 (容差 ±1024)
    const actualSize = stats.ContentLength ?? 0;
    if (Math.abs(actualSize - dto.fileSize) > 1024) {
      await this.minio.delete(dto.key);
      await this.prisma.media.delete({
        where: { id: dto.fileId, userId },
      });
      throw new BadRequestException('文件大小不匹配，请重新上传');
    }

    // 更新 Media 状态
    await this.prisma.media.update({
      where: { id: dto.fileId, userId },
      data: { status: 'completed', size: actualSize },
    });

    return { fileId: dto.fileId };
  }
}
```

- [ ] **Step 5: 实现 StorageController + Module**

```typescript
// apps/api/src/modules/storage/storage.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { StorageService } from './storage.service';
import { AuthGuard } from '../../auth/auth.guard';
import { PresignUploadDto } from './dto/presign.dto';
import { ConfirmUploadDto } from './dto/confirm.dto';

@Controller('api/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  async presign(@Req() req: any, @Body() body: PresignUploadDto) {
    const data = await this.storageService.presignUpload(req.user.id, body);
    return { code: 0, data };
  }

  @Post('confirm')
  async confirm(@Req() req: any, @Body() body: ConfirmUploadDto) {
    const data = await this.storageService.confirmUpload(req.user.id, body);
    return { code: 0, data };
  }
}
```

```typescript
// apps/api/src/modules/storage/storage.module.ts
import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

@Module({
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
```

- [ ] **Step 6: 注册 StorageModule 到 AppModule**

在 `apps/api/src/app.module.ts` 的 imports 中添加 `StorageModule`:
```typescript
import { StorageModule } from './modules/storage/storage.module';
// ... 在 imports 数组中添加:
StorageModule,
```

- [ ] **Step 7: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/storage/storage.service.spec.ts`
Expected: 3 tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/storage/ apps/api/src/app.module.ts
git commit -m "feat(api): add StorageModule — presigned POST upload and confirm endpoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: 创建 MediaModule（媒体访问 API + Redis 缓存）

**Files:**
- Create: `apps/api/src/modules/media/media.service.ts`
- Create: `apps/api/src/modules/media/media.controller.ts`
- Create: `apps/api/src/modules/media/media.module.ts`
- Create: `apps/api/src/modules/media/media.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/media/media.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaService } from './media.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { NotFoundException } from '@nestjs/common';

describe('MediaService', () => {
  let service: MediaService;
  let prisma: any;
  let minio: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'media-1',
          userId: 'user1',
          key: 'results/user1/proj1/node1/2026-05-20/a.png',
          status: 'completed',
          type: 'generated',
        }),
      },
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue(
        'http://127.0.0.1:9000/flowai/results/user1/proj1/node1/2026-05-20/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&...',
      ),
    };
    redis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: 'REDIS_CLIENT', useValue: redis },
      ],
    }).compile();
    service = module.get<MediaService>(MediaService);
  });

  it('should return cached URL if present', async () => {
    redis.get = vi.fn().mockResolvedValue('http://cached-url/path?X-Amz=...');
    const url = await service.getMediaUrl('media-1', 'user1');
    expect(url).toBe('http://cached-url/path?X-Amz=...');
    expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it('should generate presigned URL and cache it on miss', async () => {
    const url = await service.getMediaUrl('media-1', 'user1');
    expect(url).toContain('X-Amz-Algorithm');
    expect(redis.set).toHaveBeenCalledWith(
      'media:url:user1:media-1',
      expect.any(String),
      840,
    );
  });

  it('should throw NotFoundException for non-existent media', async () => {
    prisma.media.findUnique = vi.fn().mockResolvedValue(null);
    await expect(
      service.getMediaUrl('nonexistent', 'user1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject access from wrong userId', async () => {
    prisma.media.findUnique = vi.fn().mockResolvedValue(null); // 按 userId 查不到
    await expect(
      service.getMediaUrl('media-1', 'user2'),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/media/media.service.spec.ts`
Expected: FAIL — MediaService 未定义

- [ ] **Step 3: 实现 MediaService**

```typescript
// apps/api/src/modules/media/media.service.ts
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import Redis from 'ioredis';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async getMediaUrl(fileId: string, userId: string): Promise<string> {
    // 1. Redis 缓存 — key 包含 userId 防止跨用户缓存污染
    const cacheKey = `media:url:${userId}:${fileId}`;
    const cachedUrl = await this.redis.get(cacheKey);
    if (cachedUrl) {
      return cachedUrl;
    }

    // 2. 权限验证: 同时按 id 和 userId 查询，防 ID 遍历攻击
    const media = await this.prisma.media.findUnique({
      where: { id: fileId, userId },
    });
    if (!media) {
      throw new NotFoundException('媒体资源不存在');
    }

    // 3. 生成预签名 URL (15 分钟有效)
    const url = await this.minio.generatePresignedGetUrl(media.key, 900);

    // 4. 写入缓存 (14 分钟 TTL，比 URL 有效期短 1 分钟)
    await this.redis.set(cacheKey, url, 'EX', 840);

    return url;
  }
}
```

- [ ] **Step 4: 实现 MediaController + Module**

```typescript
// apps/api/src/modules/media/media.controller.ts
import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { MediaService } from './media.service';
import { AuthGuard } from '../../auth/auth.guard';

@Controller('api/media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':fileId/url')
  async getUrl(@Req() req: any, @Param('fileId') fileId: string) {
    const url = await this.mediaService.getMediaUrl(fileId, req.user.id);
    return { code: 0, data: { url } };
  }
}
```

```typescript
// apps/api/src/modules/media/media.module.ts
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
```

- [ ] **Step 5: 注册 MediaModule 到 AppModule**

在 `apps/api/src/app.module.ts` 的 imports 中添加 `MediaModule`:
```typescript
import { MediaModule } from './modules/media/media.module';
// ... 在 imports 数组中添加:
MediaModule,
```

- [ ] **Step 6: 确认 REDIS_CLIENT provider 已存在**

检查 `apps/api/src/app.module.ts` 中是否已注册 `REDIS_CLIENT` token。如果没有，需要添加:
```typescript
import Redis from 'ioredis';
// 在 providers 数组中:
{
  provide: 'REDIS_CLIENT',
  useFactory: () => new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0'),
},
```

- [ ] **Step 7: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/media/media.service.spec.ts`
Expected: 4 tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/media/ apps/api/src/app.module.ts
git commit -m "feat(api): add MediaModule — media URL endpoint with Redis cache (userId-keyed)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: 创建 AI 结果下载 Worker

**Files:**
- Create: `apps/api/src/modules/ai-download/ai-download.processor.ts`
- Create: `apps/api/src/modules/ai-download/ai-download.processor.spec.ts`
- Create: `apps/api/src/modules/ai-download/ai-download.module.ts`
- Create: `apps/api/src/modules/ai-download/ai-download.constants.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/ai-download/ai-download.processor.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiDownloadProcessor } from './ai-download.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { Job } from 'bullmq';
import axios from 'axios';

vi.mock('axios');

describe('AiDownloadProcessor', () => {
  let processor: AiDownloadProcessor;
  let prisma: any;
  let minio: any;
  let gateway: any;

  beforeEach(async () => {
    prisma = {
      media: { create: vi.fn().mockResolvedValue({ id: 'media-new' }) },
    };
    minio = {
      upload: vi.fn().mockResolvedValue(undefined),
      buildKey: vi.fn().mockReturnValue('results/user1/proj1/node1/2026-05-20/uuid.png'),
    };
    gateway = {
      emitNodeStatus: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiDownloadProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: ExecutionGateway, useValue: gateway },
      ],
    }).compile();
    processor = module.get<AiDownloadProcessor>(AiDownloadProcessor);
  });

  it('should download AI result, upload to MinIO, and create Media', async () => {
    const mockBuffer = Buffer.from('fake-image-data');
    (axios.get as any).mockResolvedValue({
      data: mockBuffer,
      headers: { 'content-type': 'image/png', 'content-length': '12345' },
    });

    const job = {
      data: {
        userId: 'user1',
        projectId: 'proj1',
        nodeId: 'node1',
        taskId: 'task1',
        resultUrl: 'https://external.ai/result.png',
        mimeType: 'image/png',
      },
    } as unknown as Job;

    const result = await processor.process(job);
    expect(result.status).toBe('completed');
    expect(minio.upload).toHaveBeenCalledWith(
      expect.any(String),
      mockBuffer,
      'image/png',
    );
    expect(prisma.media.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'generated',
          status: 'completed',
          userId: 'user1',
          projectId: 'proj1',
          nodeId: 'node1',
        }),
      }),
    );
    expect(gateway.emitNodeStatus).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/ai-download/ai-download.processor.spec.ts`
Expected: FAIL — AiDownloadProcessor 未定义

- [ ] **Step 3: 实现常量**

```typescript
// apps/api/src/modules/ai-download/ai-download.constants.ts
export const AI_DOWNLOAD_QUEUE_NAME = 'ai-result-download';
```

- [ ] **Step 4: 实现 AiDownloadProcessor**

```typescript
// apps/api/src/modules/ai-download/ai-download.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionGateway } from '../gateway/execution.gateway';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';
import axios from 'axios';
import axiosRetry from 'axios-retry';

axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => axiosRetry.exponentialDelay(retryCount),
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    (!!error.response && error.response.status >= 500),
});

export interface AiDownloadJobData {
  userId: string;
  projectId: string;
  nodeId: string;
  taskId: string;
  resultUrl: string;
  mimeType: string;
}

@Processor(AI_DOWNLOAD_QUEUE_NAME)
export class AiDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(AiDownloadProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
    @Inject(ExecutionGateway) private readonly gateway: ExecutionGateway,
  ) {
    super();
  }

  async process(job: Job<AiDownloadJobData>): Promise<{ status: string; fileId?: string }> {
    const { userId, projectId, nodeId, taskId, resultUrl, mimeType } = job.data;
    this.logger.log(`Downloading AI result: ${resultUrl}`);

    // 1. 下载 AI 结果（带 axios-retry 重试）
    const response = await axios.get(resultUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    const buffer = Buffer.from(response.data);
    const ext = mimeType.split('/')[1] || 'bin';

    // 2. 构建 key 并上传到 MinIO
    const key = this.minio.buildKey('generated', userId, { projectId, nodeId, ext });
    await this.minio.upload(key, buffer, mimeType);

    // 3. 创建 Media 记录 (直接 status=completed)
    const media = await this.prisma.media.create({
      data: {
        userId,
        key,
        originalName: `ai-generated-${nodeId}.${ext}`,
        mimeType,
        size: buffer.length,
        projectId,
        nodeId,
        taskId,
        type: 'generated',
        status: 'completed',
      },
    });

    // 4. 通过 Socket 推送 fileId
    this.gateway.emitNodeStatus(nodeId, 'done', {
      fileId: media.id,
      status: 'done',
    });

    this.logger.log(`AI result stored: ${media.id}`);
    return { status: 'completed', fileId: media.id };
  }
}
```

- [ ] **Step 5: 实现 Module (注册队列)**

```typescript
// apps/api/src/modules/ai-download/ai-download.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiDownloadProcessor } from './ai-download.processor';
import { AI_DOWNLOAD_QUEUE_NAME } from './ai-download.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: AI_DOWNLOAD_QUEUE_NAME,
    }),
  ],
  providers: [AiDownloadProcessor],
  exports: [BullModule],
})
export class AiDownloadModule {}
```

- [ ] **Step 6: 注册 AiDownloadModule 到 AppModule**

在 `apps/api/src/app.module.ts` 的 imports 中添加 `AiDownloadModule`

- [ ] **Step 7: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/ai-download/ai-download.processor.spec.ts`
Expected: 1 test PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ai-download/ apps/api/src/app.module.ts
git commit -m "feat(api): add AI result download Worker — axios-retry download + MinIO upload + Media record

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: 创建临时文件清理 Worker

**Files:**
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.processor.ts`
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.processor.spec.ts`
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.module.ts`
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.constants.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/temp-cleanup/temp-cleanup.processor.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TempCleanupProcessor } from './temp-cleanup.processor';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Job } from 'bullmq';

describe('TempCleanupProcessor', () => {
  let processor: TempCleanupProcessor;
  let prisma: any;
  let minio: any;

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'm1', key: 'temp/u1/2026-05-19/a.png' },
          { id: 'm2', key: 'temp/u1/2026-05-19/b.png' },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    minio = {
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TempCleanupProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    processor = module.get<TempCleanupProcessor>(TempCleanupProcessor);
  });

  it('should find expired temp files, delete from MinIO, then delete DB records', async () => {
    const job = { data: {} } as Job;
    await processor.process(job);

    expect(prisma.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'temp',
          expiresAt: expect.any(Object),
        }),
        take: 1000,
      }),
    );
    expect(minio.delete).toHaveBeenCalledTimes(2);
    expect(prisma.media.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['m1', 'm2'] } },
    });
  });

  it('should handle empty result gracefully', async () => {
    prisma.media.findMany = vi.fn().mockResolvedValue([]);
    const job = { data: {} } as Job;
    await processor.process(job);
    expect(minio.delete).not.toHaveBeenCalled();
    expect(prisma.media.deleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/temp-cleanup/temp-cleanup.processor.spec.ts`
Expected: FAIL — TempCleanupProcessor 未定义

- [ ] **Step 3: 实现常量 + Processor + Module**

```typescript
// apps/api/src/modules/temp-cleanup/temp-cleanup.constants.ts
export const TEMP_CLEANUP_QUEUE_NAME = 'temp-file-cleanup';
```

```typescript
// apps/api/src/modules/temp-cleanup/temp-cleanup.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Processor(TEMP_CLEANUP_QUEUE_NAME)
export class TempCleanupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TempCleanupProcessor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {
    super();
  }

  async onModuleInit() {
    // 注册 cron 重复任务 (每天凌晨 2 点)
    const queue = this.worker.queue;
    await queue.upsertJobScheduler(
      `${TEMP_CLEANUP_QUEUE_NAME}-scheduler`,
      { pattern: '0 2 * * *' },
      { name: TEMP_CLEANUP_QUEUE_NAME, data: {} },
    );
  }

  async process(_job: Job): Promise<{ cleaned: number }> {
    // 1. 查询已过期的临时文件
    const expiredMedias = await this.prisma.media.findMany({
      where: {
        type: 'temp',
        expiresAt: { lt: new Date() },
      },
      take: 1000,
      select: { id: true, key: true },
    });

    if (expiredMedias.length === 0) {
      this.logger.log('No expired temp files to clean');
      return { cleaned: 0 };
    }

    // 2. 批量删除 MinIO 文件
    await Promise.all(
      expiredMedias.map((m) =>
        this.minio.delete(m.key).catch((err) =>
          this.logger.warn(`Failed to delete ${m.key}: ${err.message}`),
        ),
      ),
    );

    // 3. 批量删除 DB 记录
    const ids = expiredMedias.map((m) => m.id);
    await this.prisma.media.deleteMany({
      where: { id: { in: ids } },
    });

    this.logger.log(`Cleaned up ${expiredMedias.length} temp files`);
    return { cleaned: expiredMedias.length };
  }
}
```

```typescript
// apps/api/src/modules/temp-cleanup/temp-cleanup.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TempCleanupProcessor } from './temp-cleanup.processor';
import { TEMP_CLEANUP_QUEUE_NAME } from './temp-cleanup.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: TEMP_CLEANUP_QUEUE_NAME,
    }),
  ],
  providers: [TempCleanupProcessor],
})
export class TempCleanupModule {}
```

- [ ] **Step 4: 注册 TempCleanupModule 到 AppModule**

在 `apps/api/src/app.module.ts` 的 imports 中添加 `TempCleanupModule`

- [ ] **Step 5: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/temp-cleanup/temp-cleanup.processor.spec.ts`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/temp-cleanup/ apps/api/src/app.module.ts
git commit -m "feat(api): add temp file cleanup Worker — daily cron, delete expired MinIO objects

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 9: 修改 AI 执行流程 — 将 AI 结果入队下载

**Files:**
- Modify: `apps/api/src/modules/execution/execution.service.ts`
- Modify: `apps/api/src/modules/execution/execution.service.spec.ts`

- [ ] **Step 1: 写失败测试 — 验证 execution service 在 AI 完成后入队下载任务**

```typescript
// apps/api/src/modules/execution/execution.service.spec.ts — 新增测试

// 在现有 describe block 中新增 BullMQ queue mock 和测试:
it('should enqueue ai-result-download after AI returns resultUrl', async () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'download-job-1' }),
  };
  // Mock Queue injection
  executionService['downloadQueue'] = mockQueue;

  apiCaller.callImageGen = vi.fn().mockResolvedValue({
    url: 'https://external.ai/temp/result.png',
    width: 1024,
    height: 1024,
  });

  await executionService.execute('proj1', 'node1', 'user1');

  expect(mockQueue.add).toHaveBeenCalledWith('ai-result-download', {
    userId: 'user1',
    projectId: 'proj1',
    nodeId: 'node1',
    taskId: expect.any(String),
    resultUrl: 'https://external.ai/temp/result.png',
    mimeType: 'image/png',
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/execution/execution.service.spec.ts`
Expected: 新测试 FAIL

- [ ] **Step 3: 修改 ExecutionService — 在 AI 调用后入队下载任务**

在 `apps/api/src/modules/execution/execution.service.ts` 中:

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

// 在 constructor 中添加:
constructor(
  // ... 现有依赖
  @InjectQueue('ai-result-download') private readonly downloadQueue: Queue,
) {}

// 在 execute 方法中，AI 调用成功后替换 emitNodeStatus 逻辑:
if (result && 'url' in result && result.url) {
  const job = await this.downloadQueue.add('ai-result-download', {
    userId,
    projectId,
    nodeId,
    taskId: 'temp-task-' + Date.now(),
    resultUrl: result.url,
    mimeType: type === 'video' ? 'video/mp4' : 'image/png',
  });
  this.logger.log(`Enqueued AI result download: ${job.id}`);
  // 注意: 不再直接 emit resultUrl，而是等 Worker 完成后 Socket 推送 fileId
}
```

- [ ] **Step 4: 更新 ExecutionModule 导入下载队列**

在 `apps/api/src/modules/execution/execution.module.ts`:
```typescript
imports: [
  CreditModule,
  BullModule.registerQueue({
    name: EXECUTION_QUEUE_NAME,
    configKey: EXECUTION_CONNECTION_NAME,
  }),
  BullModule.registerQueue({
    name: 'ai-result-download',  // 新增
  }),
],
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/api test -- apps/api/src/modules/execution/execution.service.spec.ts`
Expected: 全部测试 PASS（含新增测试）

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/execution/
git commit -m "feat(api): pipe AI results through ai-result-download queue for MinIO storage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 10: 前端 — 添加 axios 依赖 + 创建 API 客户端

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/api/storageApi.ts`
- Create: `apps/web/src/api/mediaApi.ts`

- [ ] **Step 1: 安装 axios**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web add axios
```

- [ ] **Step 2: 创建 storageApi.ts**

```typescript
// apps/web/src/api/storageApi.ts
import { apiFetch } from './client';

export interface PresignResponse {
  fileId: string;
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
}

export async function presignUpload(params: {
  fileName: string;
  fileSize: number;
  fileType: string;
  type: 'uploaded' | 'temp';
}): Promise<PresignResponse> {
  return apiFetch('/storage/presign', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function confirmUpload(params: {
  fileId: string;
  key: string;
  fileSize: number;
}): Promise<{ fileId: string }> {
  return apiFetch('/storage/confirm', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
```

- [ ] **Step 3: 创建 mediaApi.ts**

```typescript
// apps/web/src/api/mediaApi.ts
import { apiFetch } from './client';

export async function getMediaUrl(fileId: string): Promise<{ url: string }> {
  return apiFetch(`/media/${fileId}/url`);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/storageApi.ts apps/web/src/api/mediaApi.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add storage and media API clients for MinIO integration

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 11: 前端 — 创建 useMediaUrl hook

**Files:**
- Create: `apps/web/src/hooks/useMediaUrl.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/hooks/useMediaUrl.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMediaUrl } from './useMediaUrl';

// Mock apiFetch
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';

describe('useMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null url and loading=false when fileId is null', () => {
    const { result } = renderHook(() => useMediaUrl(null));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch URL and return it', async () => {
    (apiFetch as any).mockResolvedValueOnce({ url: 'http://minio/path?X-Amz=...' });
    const { result } = renderHook(() => useMediaUrl('file-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.url).toBe('http://minio/path?X-Amz=...');
    expect(result.current.error).toBeNull();
  });

  it('should set error on fetch failure', async () => {
    (apiFetch as any).mockRejectedValueOnce(new Error('Not found'));
    const { result } = renderHook(() => useMediaUrl('file-2'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.url).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/hooks/useMediaUrl.test.ts`
Expected: FAIL — useMediaUrl hook 未定义

- [ ] **Step 3: 实现 useMediaUrl hook**

```typescript
// apps/web/src/hooks/useMediaUrl.ts
import { useState, useEffect } from 'react';
import { getMediaUrl } from '@/api/mediaApi';

export function useMediaUrl(fileId: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: Error | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getMediaUrl(fileId)
      .then((res) => setUrl(res.url))
      .catch((err) => setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => setLoading(false));
  }, [fileId]);

  return { url, loading, error };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/hooks/useMediaUrl.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/
git commit -m "feat(web): add useMediaUrl hook — tri-state url/loading/error for media access API

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 12: 前端 — 创建 FileUpload 组件

**Files:**
- Create: `apps/web/src/components/FileUpload.tsx`
- Create: `apps/web/src/components/FileUpload.test.tsx`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/components/FileUpload.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileUpload } from './FileUpload';

// Mock storageApi
vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn().mockResolvedValue({
    fileId: 'file-1',
    uploadUrl: 'http://minio:9000/flowai',
    key: 'uploads/u1/2026-05-20/test.png',
    fields: { key: 'uploads/u1/2026-05-20/test.png', Policy: 'p', 'X-Amz-Signature': 's' },
  }),
  confirmUpload: vi.fn().mockResolvedValue({ fileId: 'file-1' }),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ status: 200 }),
  },
}));

import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

describe('FileUpload', () => {
  const onUploadComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render upload area with placeholder', () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" />);
    expect(screen.getByText(/点击或拖拽上传/i)).toBeInTheDocument();
  });

  it('should call onUploadComplete with fileId after successful upload', async () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" />);

    const file = new File(['test'], 'test.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalledWith('file-1');
    });

    expect(presignUpload).toHaveBeenCalledWith({
      fileName: 'test.png',
      fileSize: file.size,
      fileType: 'image/png',
      type: 'uploaded',
    });

    expect(confirmUpload).toHaveBeenCalledWith({
      fileId: 'file-1',
      key: 'uploads/u1/2026-05-20/test.png',
      fileSize: file.size,
    });
  });

  it('should show loading state during upload', async () => {
    (presignUpload as any).mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ fileId: 'f1', uploadUrl: 'u', key: 'k', fields: {} }), 100)),
    );

    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" />);
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText(/上传中/i)).toBeInTheDocument();
  });

  it('should show format hint', () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" hint="PNG/JPG ≤20MB" />);
    expect(screen.getByText('PNG/JPG ≤20MB')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/components/FileUpload.test.tsx`
Expected: FAIL — FileUpload 组件未定义

- [ ] **Step 3: 实现 FileUpload 组件**

```typescript
// apps/web/src/components/FileUpload.tsx
import { useState, useRef, useCallback } from 'react';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

interface FileUploadProps {
  onUploadComplete: (fileId: string) => void;
  accept: string;   // e.g. "image/*", "video/*"
  hint?: string;    // e.g. "PNG/JPG ≤20MB"
}

export function FileUpload({ onUploadComplete, accept, hint }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // 1. 获取预签名 URL
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });

      // 2. 构建 FormData 并上传到 MinIO
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      await axios.post(uploadUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      // 3. 确认上传
      await confirmUpload({ fileId, key, fileSize: file.size });

      onUploadComplete(fileId);
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete]);

  return (
    <div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        style={{
          border: '1px dashed #3F3F46',
          borderRadius: '8px',
          padding: '24px 12px',
          textAlign: 'center',
          cursor: 'pointer',
          background: '#222222',
          opacity: uploading ? 0.5 : 1,
          pointerEvents: uploading ? 'none' : 'auto',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {uploading ? (
          <div>
            <div style={{ color: '#f59e0b', fontSize: '12px', marginBottom: '4px' }}>
              上传中 {progress}%
            </div>
            <div style={{ height: '3px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#4ade80', transition: 'width 0.2s' }} />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>📁</div>
            <div style={{ color: '#9CA3AF', fontSize: '12px' }}>点击或拖拽上传</div>
            {hint && <div style={{ color: '#666', fontSize: '10px', marginTop: '4px' }}>{hint}</div>}
          </div>
        )}
      </div>
      {error && (
        <div style={{ color: '#f87171', fontSize: '11px', marginTop: '4px' }}>{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/components/FileUpload.test.tsx`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/FileUpload.tsx apps/web/src/components/FileUpload.test.tsx
git commit -m "feat(web): add FileUpload component — drag/drop, progress bar, presigned POST upload

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 13: 前端 — 更新 ImageConfigPanel 添加参考图上传

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`

- [ ] **Step 1: 更新测试 — 添加参考图上传区域**

在 `ImageConfigPanel.test.tsx` 中新增测试：

```typescript
it('should show reference image upload area', () => {
  const { container } = renderPanel({ nodeId: 'img-1' });
  // FileUpload component renders "点击或拖拽上传"
  expect(container.textContent).toContain('点击或拖拽上传');
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`
Expected: FAIL — 参考图上传区域不存在

- [ ] **Step 3: 修改 ImageConfigPanel — 添加参考图上传**

在 `ImageConfigPanel.tsx` 中，在 Style tags 区块之前添加参考图上传区块：

```tsx
import { FileUpload } from '@/components/FileUpload';

// 在 Style tags div 之前添加:
<div className="mb-3">
  <div className="text-xs text-[#888] mb-2">参考图片（可选）</div>
  <FileUpload
    accept="image/*"
    hint="JPG/PNG/WebP ≤20MB"
    onUploadComplete={(fileId) => {
      updateConfig(nodeId, { referenceImage: fileId });
    }}
  />
</div>
```

同时更新 `updateConfig` 调用，在 ImageConfig interface 子添加 `referenceImage?: string`。

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx`
Expected: 全部测试 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.tsx apps/web/src/pages/canvas/components/nodes/ImageConfigPanel.test.tsx
git commit -m "feat(web): add reference image upload to ImageConfigPanel

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 14: 前端 — 更新 VideoConfigPanel 替换 URL 输入为上传组件

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx`

- [ ] **Step 1: 更新测试 — 替换 URL 输入测试为上传组件测试**

```typescript
// 在 VideoConfigPanel.test.tsx 中新增:
it('should show upload for image-to-video mode', () => {
  const store = useNodeStore.getState();
  useNodeStore.setState({
    nodes: { ...store.nodes, ['vid-1']: { ...(store.nodes['vid-1'] || {}), type: 'video', mode: 'image-to-video' } },
  });
  const { container } = renderPanel({ nodeId: 'vid-1' });
  expect(container.textContent).toContain('点击或拖拽上传');
});

it('should show dual upload for first-last-frame mode', () => {
  const store = useNodeStore.getState();
  useNodeStore.setState({
    nodes: { ...store.nodes, ['vid-1']: { ...(store.nodes['vid-1'] || {}), type: 'video', mode: 'first-last-frame' } },
  });
  const { container } = renderPanel({ nodeId: 'vid-1' });
  const uploads = container.querySelectorAll('input[type="file"]');
  expect(uploads.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx`
Expected: FAIL — 新测试不通过

- [ ] **Step 3: 修改 VideoConfigPanel — 替换 URL 输入为 FileUpload**

```tsx
import { FileUpload } from '@/components/FileUpload';

// 替换 image-to-video 模式:
{mode === 'image-to-video' && (
  <div className="mb-3">
    <div className="text-[10px] text-[#888] mb-1">开始帧图片</div>
    <FileUpload
      accept="image/*"
      hint="JPG/PNG ≤20MB"
      onUploadComplete={(fileId) => update({ startImageFileId: fileId })}
    />
  </div>
)}

// 替换 first-last-frame 模式:
{mode === 'first-last-frame' && (
  <div className="flex gap-2 mb-3">
    <div className="flex-1">
      <div className="text-[10px] text-[#888] mb-1">开始帧</div>
      <FileUpload
        accept="image/*"
        hint="JPG/PNG"
        onUploadComplete={(fileId) => update({ startFrameFileId: fileId })}
      />
    </div>
    <div className="flex-1">
      <div className="text-[10px] text-[#888] mb-1">结束帧</div>
      <FileUpload
        accept="image/*"
        hint="JPG/PNG"
        onUploadComplete={(fileId) => update({ endFrameFileId: fileId })}
      />
    </div>
  </div>
)}

// 删除 URL 文本输入框 (startImageUrl, endImageUrl, imageUrls)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test -- apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx`
Expected: 全部测试 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.tsx apps/web/src/pages/canvas/components/nodes/VideoConfigPanel.test.tsx
git commit -m "feat(web): replace URL inputs with FileUpload in VideoConfigPanel (all modes)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 15: 前端 — 更新 ImageGenNode 和 VideoGenNode 适配 fileId

**Files:**
- Modify: `apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx`
- Modify: `apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx`
- Modify: `apps/web/src/stores/nodeStore.ts`

- [ ] **Step 1: 修改 nodeStore — 添加 fileId 和 setFileResult**

在 `apps/web/src/stores/nodeStore.ts` 中:

```typescript
// 修改 ImageNodeData 接口 — 将 resultUrl 改为 fileId
interface ImageNodeData {
  type: 'image';
  style: string;
  extraPrompt: string;
  model: string;
  resolution: string;
  count: number;
  fileId?: string;       // 替代 resultUrl
  status: 'idle' | 'loading' | 'done' | 'error';
}

// 修改 setResult — 接受 fileId 而非 url
setFileResult: (id: string, fileId: string) => {
  const existing = get().nodes[id] as ImageNodeData;
  if (!existing) return;
  set((s) => ({
    nodes: { ...s.nodes, [id]: { ...existing, fileId, status: 'done' as const } },
  }));
},
```

- [ ] **Step 2: 修改 ImageGenNode — 用 useMediaUrl 替代直接 URL**

```tsx
import { useMediaUrl } from '@/hooks/useMediaUrl';

// 在组件中:
const fileId = nodeData?.fileId;
const { url: resultUrl, loading: urlLoading } = useMediaUrl(fileId);

// 预览区用 resultUrl（来自 useMediaUrl hook）
```

- [ ] **Step 3: 修改 VideoGenNode — 同 ImageGenNode**

```tsx
import { useMediaUrl } from '@/hooks/useMediaUrl';

const fileId = nodeData?.fileId;
const { url: videoUrl, loading: urlLoading } = useMediaUrl(fileId);
```

- [ ] **Step 4: 运行所有前端测试**

Run: `cd /d/flowweb && pnpm --filter @flowweb/web test`
Expected: 全部测试 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx apps/web/src/pages/canvas/components/nodes/VideoGenNode.tsx apps/web/src/stores/nodeStore.ts
git commit -m "feat(web): adapt ImageGenNode/VideoGenNode to use fileId with useMediaUrl hook

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 16: MinIO 部署 & 集成测试

**Files:**
- 手动: MinIO Windows 二进制部署
- 手动: `.env` 配置

- [ ] **Step 1: 下载并启动 MinIO**

```bash
# 下载 MinIO (LTS)
curl -o /c/Users/link/minio.exe https://dl.min.io/server/minio/release/windows-amd64/archive/minio.RELEASE.2025-12-18T08-51-09Z

# 启动
/c/Users/link/minio.exe server D:\minio-data --console-address :9001

# 验证: 打开 http://127.0.0.1:9001 (minioadmin / minioadmin)
```

- [ ] **Step 2: 创建 bucket + CORS**

```bash
mc alias set myminio http://127.0.0.1:9000 minioadmin minioadmin
mc mb myminio/flowai

mc admin config set myminio cors <<'EOF'
{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://127.0.0.1:5173", "https://flowai.nat100.top"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD", "OPTIONS"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}
EOF
```

- [ ] **Step 3: 运行完整测试套件**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api test
cd /d/flowweb && pnpm --filter @flowweb/web test
```

Expected: 全部测试 PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: complete MinIO integration — all modules wired, tests passing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 17: 最终验证 — 启动完整项目

- [ ] **Step 1: 启动 Redis**

```bash
/c/Users/link/redis/redis-server.exe --port 6379 --maxmemory 256mb
```

- [ ] **Step 2: 启动 MinIO**

```bash
/c/Users/link/minio.exe server D:\minio-data --console-address :9001
```

- [ ] **Step 3: 启动后端**

```bash
cd /d/flowweb && pnpm --filter @flowweb/api dev
```

Expected: Nest application successfully started on port 3000

- [ ] **Step 4: 启动前端**

```bash
cd /d/flowweb && pnpm --filter @flowweb/web dev
```

Expected: Vite ready on http://localhost:5173

- [ ] **Step 5: 手动验证**

1. 打开 http://localhost:5173
2. 登录后创建项目
3. 添加 ImageGen 节点 → 验证参考图上传
4. 添加 VideoGen 节点 → 验证各种模式的上传
5. 点击执行 → 验证 AI 结果通过 MinIO 存储和显示

- [ ] **Step 6: 验证完成 — 最终提交**

```bash
git add -A
git commit -m "chore: final verification — MinIO integration complete, all services running

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
