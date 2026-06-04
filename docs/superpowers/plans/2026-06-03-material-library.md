# 我的素材库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建全局弹窗式素材库（左侧文件夹树 + 右侧文件网格），复用现有 StorageController/MinioService/Media 模型

**Architecture:** 新增 MaterialFolder 表 + 扩展 Media 表（追加 folderId/isFavorite/thumbnailKey）；新增 MaterialLibrary 模块（NestJS），含 FolderService/MaterialService/FileController/FolderController/ThumbnailGeneratorConsumer；前端使用 Zustand store + Ant Design 暗色主题组件

**部署依赖：** 服务器需安装 ffmpeg 和 ffprobe（视频缩略图生成）— Ubuntu: `apt install ffmpeg`，Windows: 下载二进制并添加到 PATH

**Tech Stack:** NestJS 10 + Prisma 5 + PostgreSQL 16 + MinIO (S3 SDK) + BullMQ + React 18 + Zustand + Ant Design 5 + Vitest + @dnd-kit/core

---

## File Structure

```
apps/api/
├── prisma/schema.prisma                    # [MODIFY] Extend Media, add MaterialFolder
├── src/
│   ├── app.module.ts                       # [MODIFY] Import MaterialLibraryModule
│   ├── auth/auth.controller.ts             # [MODIFY] Create default folders on sign-up
│   ├── modules/minio/minio.service.ts      # [MODIFY] Add getObject method
│   └── modules/material-library/
│       ├── material-library.module.ts      # [CREATE]
│       ├── constants/material-library.constants.ts  # [CREATE]
│       ├── dto/
│       │   ├── create-folder.dto.ts        # [CREATE]
│       │   ├── update-folder.dto.ts        # [CREATE]
│       │   └── move-file.dto.ts            # [CREATE]
│       ├── controllers/
│       │   ├── folder.controller.ts        # [CREATE]
│       │   └── file.controller.ts          # [CREATE]
│       ├── services/
│       │   ├── folder.service.ts           # [CREATE]
│       │   └── material.service.ts         # [CREATE]
│       └── consumers/
│           └── thumbnail-generator.consumer.ts  # [CREATE]

apps/web/src/
├── components/MaterialLibrary/
│   ├── MaterialLibraryModal.tsx            # [CREATE]
│   ├── MaterialLibraryModal.test.tsx       # [CREATE]
│   ├── FolderTree/
│   │   ├── FolderTree.tsx                  # [CREATE]
│   │   └── FolderTree.test.tsx            # [CREATE]
│   ├── FileGrid/
│   │   ├── FileGrid.tsx                    # [CREATE]
│   │   ├── FileGrid.test.tsx              # [CREATE]
│   │   ├── FileCard.tsx                    # [CREATE]
│   │   └── FileCard.test.tsx              # [CREATE]
│   ├── Uploader/
│   │   └── MaterialUploader.tsx            # [CREATE]
│   └── FileGridZoomControl.tsx             # [CREATE]
├── stores/
│   ├── materialLibraryStore.ts             # [CREATE]
│   └── materialLibraryStore.test.ts        # [CREATE]
└── pages/canvas/page.tsx                   # [MODIFY] Add shortcut button + modal

packages/shared/
└── src/types/material-library.ts           # [CREATE]
```

---

### Task 1: Prisma Schema — Extend Media + Add MaterialFolder

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Add MaterialFolder model and extend Media**

Add after the existing `Media` model (after line 271):

```prisma
// 素材文件夹表
model MaterialFolder {
  id        String   @id @default(cuid())
  name      String
  parentId  String?
  userId    String
  sortOrder Int      @default(0)
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  parent   MaterialFolder?  @relation("FolderHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children MaterialFolder[] @relation("FolderHierarchy")
  files    Media[]

  user     User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, parentId])
  @@index([userId, sortOrder])
  @@index([userId, deletedAt])
}
```

Modify the existing `Media` model — add fields at line 255 (after `expiresAt`):

```prisma
  folderId      String?   // 关联素材库文件夹
  isFavorite    Boolean   @default(false)  // 收藏标记
  thumbnailKey  String?   // 缩略图对象键（URL动态生成，避免过期）
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // 软删除

  folder        MaterialFolder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([userId, folderId])
  @@index([userId, isFavorite])
  @@index([userId, createdAt])
```

Add to `User` model (after `canvasProjects CanvasProject[]` at line 23):

```prisma
  media          Media[]
  materialFolders MaterialFolder[]
```

- [ ] **Step 2: Run Prisma migration**

```bash
cd D:\flowweb\apps\api && npx prisma migrate dev --name add-material-library
```

Expected: migration file created in `prisma/migrations/` with the new tables and columns.

- [ ] **Step 3: Verify Prisma client generation**

```bash
cd D:\flowweb\apps\api && npx prisma generate
```

Expected: `@prisma/client` regenerated with new types.

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git -C D:/flowweb commit -m "feat: add MaterialFolder model and extend Media for material library"
```

---

### Task 2: MinioService — Add getObject Method

**Files:**
- Modify: `apps/api/src/modules/minio/minio.service.ts`
- Test: `apps/api/src/modules/minio/minio.service.spec.ts` (create if doesn't exist)

- [ ] **Step 1: Write failing test**

Create `apps/api/src/modules/minio/minio.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MinioService, MinioConfig } from './minio.service';
import { describe, it, expect, beforeEach } from 'vitest';

describe('MinioService', () => {
  let service: MinioService;

  beforeEach(async () => {
    const config: MinioConfig = {
      endpoint: 'http://localhost:9000',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'test-bucket',
      useSsl: false,
    };
    service = new MinioService(config);
  });

  it('should have getObject method', () => {
    expect(typeof service.getObject).toBe('function');
  });
});
```

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/minio/minio.service.spec.ts`
Expected: FAIL — `service.getObject is not a function`

- [ ] **Step 2: Implement getObject**

Add to `apps/api/src/modules/minio/minio.service.ts` (add import at top, method before `upload`):

```typescript
import { Readable } from 'stream';
```

Add method after `generatePresignedGetUrl`:

```typescript
  /** Download object stream from MinIO */
  async getObject(key: string): Promise<Readable> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.s3Client.send(command);
    return response.Body as Readable;
  }
```

- [ ] **Step 3: Run test to verify**

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/minio/minio.service.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/minio/minio.service.ts apps/api/src/modules/minio/minio.service.spec.ts
git -C D:/flowweb commit -m "feat: add getObject method to MinioService"
```

---

### Task 3: Constants + DTOs

**Files:**
- Create: `apps/api/src/modules/material-library/constants/material-library.constants.ts`
- Create: `apps/api/src/modules/material-library/dto/create-folder.dto.ts`
- Create: `apps/api/src/modules/material-library/dto/update-folder.dto.ts`
- Create: `apps/api/src/modules/material-library/dto/move-file.dto.ts`

- [ ] **Step 1: Create constants file**

`apps/api/src/modules/material-library/constants/material-library.constants.ts`:

```typescript
export const THUMBNAIL_GENERATOR_QUEUE = 'thumbnail-generator';
export const THUMBNAIL_GENERATOR_CONNECTION = 'default';
export const DEFAULT_FOLDER_NAMES = ['角色', '场景', '道具', '风格', '音效', '生成历史'];
export const MAX_FILE_SIZE = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
};
```

- [ ] **Step 2: Create DTOs**

`apps/api/src/modules/material-library/dto/create-folder.dto.ts`:

```typescript
export class CreateFolderDto {
  name!: string;
  parentId?: string | null;
}
```

`apps/api/src/modules/material-library/dto/update-folder.dto.ts`:

```typescript
export class UpdateFolderDto {
  name?: string;
}
```

`apps/api/src/modules/material-library/dto/move-file.dto.ts`:

```typescript
export class MoveFileDto {
  folderId!: string | null;
}
```

- [ ] **Step 3: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/
git -C D:/flowweb commit -m "feat: add material-library constants and DTOs"
```

---

### Task 4: FolderService (TDD)

**Files:**
- Create: `apps/api/src/modules/material-library/services/folder.service.ts`
- Test: `apps/api/src/modules/material-library/services/folder.service.spec.ts`

- [ ] **Step 1: Write failing tests for create + findAll**

`apps/api/src/modules/material-library/services/folder.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: { materialFolder: any };

  beforeEach(async () => {
    prisma = {
      materialFolder: {
        create: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        aggregate: vi.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FolderService>(FolderService);
  });

  describe('create', () => {
    it('should create a folder with auto-calculated sortOrder', async () => {
      const dto = { name: 'My Folder' };
      const userId = 'user-1';
      // aggregate returns max sortOrder = 2
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', ...dto, userId, sortOrder: 3 });

      const result = await service.create(dto, userId);

      expect(prisma.materialFolder.aggregate).toHaveBeenCalledWith({
        where: { userId, parentId: null, deletedAt: null },
        _max: { sortOrder: true },
      });
      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'My Folder', parentId: null, userId, sortOrder: 3 },
      });
      expect(result.sortOrder).toBe(3);
    });

    it('should start sortOrder at 0 when no existing folders', async () => {
      prisma.materialFolder.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.materialFolder.create.mockResolvedValue({ id: 'f-1', name: 'Root', userId: 'u1', sortOrder: 0 });

      const result = await service.create({ name: 'Root' }, 'u1');

      expect(prisma.materialFolder.create).toHaveBeenCalledWith({
        data: { name: 'Root', parentId: null, userId: 'u1', sortOrder: 0 },
      });
      expect(result.sortOrder).toBe(0);
    });
  });

  describe('findAllByUserId', () => {
    it('should return folders sorted by sortOrder', async () => {
      const userId = 'user-1';
      const folders = [
        { id: 'f-1', name: 'A', sortOrder: 0 },
        { id: 'f-2', name: 'B', sortOrder: 1 },
      ];
      prisma.materialFolder.findMany.mockResolvedValue(folders);

      const result = await service.findAllByUserId(userId);

      expect(prisma.materialFolder.findMany).toHaveBeenCalledWith({
        where: { userId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual(folders);
    });
  });

  describe('update', () => {
    it('should update a non-default folder', async () => {
      prisma.materialFolder.findUnique.mockResolvedValue({
        id: 'f-1', name: 'Old', isDefault: false, userId: 'user-1',
      });
      prisma.materialFolder.update.mockResolvedValue({
        id: 'f-1', name: 'New', isDefault: false,
      });

      const result = await service.update('f-1', { name: 'New' }, 'user-1');

      expect(result.name).toBe('New');
    });

    it('should throw if folder is default', async () => {
      prisma.materialFolder.findUnique.mockResolvedValue({
        id: 'f-1', name: '角色', isDefault: true, userId: 'user-1',
      });

      await expect(
        service.update('f-1', { name: 'New' }, 'user-1')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should soft-delete and move children to root', async () => {
      prisma.materialFolder.findUnique.mockResolvedValue({
        id: 'f-1', name: 'Test', isDefault: false, userId: 'user-1',
      });
      prisma.materialFolder.update.mockResolvedValue({});
      prisma.materialFolder.updateMany.mockResolvedValue({});

      await service.remove('f-1', 'user-1');

      expect(prisma.materialFolder.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
```

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/services/folder.service.spec.ts`
Expected: FAIL — `FolderService` not found

- [ ] **Step 2: Implement FolderService**

`apps/api/src/modules/material-library/services/folder.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';

@Injectable()
export class FolderService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateFolderDto, userId: string) {
    // Auto-calculate sortOrder: max existing sortOrder + 1
    const maxResult = await this.prisma.materialFolder.aggregate({
      where: { userId, parentId: dto.parentId ?? null, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxResult._max.sortOrder ?? -1) + 1;

    return this.prisma.materialFolder.create({
      data: {
        name: dto.name,
        parentId: dto.parentId ?? null,
        userId,
        sortOrder,
      },
    });
  }

  async findAllByUserId(userId: string) {
    return this.prisma.materialFolder.findMany({
      where: { userId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async update(id: string, dto: UpdateFolderDto, userId: string) {
    const folder = await this.prisma.materialFolder.findUnique({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可修改');
    return this.prisma.materialFolder.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    const folder = await this.prisma.materialFolder.findUnique({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可删除');

    await this.prisma.$transaction([
      this.prisma.materialFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.materialFolder.updateMany({
        where: { parentId: id, userId },
        data: { parentId: null },
      }),
      this.prisma.media.updateMany({
        where: { folderId: id, userId },
        data: { folderId: null },
      }),
    ]);
  }

  async moveUp(id: string, userId: string) {
    const folder = await this.prisma.materialFolder.findUnique({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');

    const previousFolder = await this.prisma.materialFolder.findFirst({
      where: {
        userId,
        parentId: folder.parentId,
        deletedAt: null,
        sortOrder: { lt: folder.sortOrder },
      },
      orderBy: { sortOrder: 'desc' },
    });

    if (!previousFolder) return;

    await this.prisma.$transaction([
      this.prisma.materialFolder.update({
        where: { id: folder.id },
        data: { sortOrder: previousFolder.sortOrder },
      }),
      this.prisma.materialFolder.update({
        where: { id: previousFolder.id },
        data: { sortOrder: folder.sortOrder },
      }),
    ]);
  }
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/services/folder.service.spec.ts`
Expected: all 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/services/
git -C D:/flowweb commit -m "feat: add FolderService with TDD"
```

---

### Task 5: MaterialService (TDD)

**Files:**
- Create: `apps/api/src/modules/material-library/services/material.service.ts`
- Test: `apps/api/src/modules/material-library/services/material.service.spec.ts`

- [ ] **Step 1: Write failing tests**

`apps/api/src/modules/material-library/services/material.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MaterialService } from './material.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('MaterialService', () => {
  let service: MaterialService;
  let prisma: { media: any; materialFolder: any };
  let minio: { generatePresignedGetUrl: ReturnType<typeof vi.fn> };
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      materialFolder: {
        findUnique: vi.fn(),
      },
    };
    minio = { generatePresignedGetUrl: vi.fn() };
    queue = { add: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: getQueueToken(THUMBNAIL_GENERATOR_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get<MaterialService>(MaterialService);
  });

  describe('getFilesByFolderId', () => {
    it('should return files with generated presigned URLs', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'test.png', key: 'key1', thumbnailKey: null }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl.mockResolvedValue('http://minio/signed/test.png');

      const result = await service.getFilesByFolderId('user-1', 'folder-1');

      expect(prisma.media.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', folderId: 'folder-1', deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('key1');
      expect(result[0].url).toBe('http://minio/signed/test.png');
    });

    it('should generate thumbnail URLs when thumbnailKey exists', async () => {
      const dbFiles = [{ id: 'm-1', originalName: 'test.png', key: 'key1', thumbnailKey: 'thumb/key1.webp' }];
      prisma.media.findMany.mockResolvedValue(dbFiles);
      minio.generatePresignedGetUrl
        .mockResolvedValueOnce('http://minio/signed/test.png')
        .mockResolvedValueOnce('http://minio/signed/thumb.webp');

      const result = await service.getFilesByFolderId('user-1', 'folder-1');

      expect(result[0].url).toBe('http://minio/signed/test.png');
      expect(result[0].thumbnailUrl).toBe('http://minio/signed/thumb.webp');
    });
  });

  describe('moveFile', () => {
    it('should move file to folder and trigger thumbnail', async () => {
      prisma.media.findUnique.mockResolvedValue({
        id: 'm-1', originalName: 'test.png', key: 'uploads/test.png', thumbnailKey: null, mimeType: 'image/png',
      });
      prisma.materialFolder.findUnique.mockResolvedValue({ id: 'folder-1' });
      prisma.media.update.mockResolvedValue({
        id: 'm-1', folderId: 'folder-1', thumbnailKey: null,
      });

      const result = await service.moveFile('user-1', 'm-1', 'folder-1');

      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { folderId: 'folder-1' },
      });
      expect(queue.add).toHaveBeenCalledWith('generate-thumbnail', {
        mediaId: 'm-1', key: 'uploads/test.png', mimeType: 'image/png',
      });
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle isFavorite from false to true', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'm-1', isFavorite: false });
      prisma.media.update.mockResolvedValue({ id: 'm-1', isFavorite: true });

      const result = await service.toggleFavorite('user-1', 'm-1');

      expect(result.isFavorite).toBe(true);
    });
  });

  describe('deleteFile', () => {
    it('should soft-delete file', async () => {
      prisma.media.findUnique.mockResolvedValue({ id: 'm-1' });
      prisma.media.update.mockResolvedValue({ id: 'm-1', deletedAt: new Date() });

      await service.deleteFile('user-1', 'm-1');

      expect(prisma.media.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });
  });
});
```

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/services/material.service.spec.ts`
Expected: FAIL — `MaterialService` not found

- [ ] **Step 2: Implement MaterialService**

`apps/api/src/modules/material-library/services/material.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE } from '../constants/material-library.constants';

@Injectable()
export class MaterialService {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    @InjectQueue(THUMBNAIL_GENERATOR_QUEUE) private thumbnailQueue: Queue,
  ) {}

  async getFilesByFolderId(userId: string, folderId: string | null) {
    const files = await this.prisma.media.findMany({
      where: { userId, folderId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    // Generate presigned URLs dynamically (never store expiring URLs in DB)
    // 3600s = 1hr for file list, sufficient for browse session
    return Promise.all(
      files.map(async (file) => ({
        ...file,
        url: await this.minioService.generatePresignedGetUrl(file.key, 3600),
        thumbnailUrl: file.thumbnailKey
          ? await this.minioService.generatePresignedGetUrl(file.thumbnailKey, 3600)
          : null,
      })),
    );
  }

  async moveFile(userId: string, fileId: string, folderId: string | null) {
    const file = await this.prisma.media.findUnique({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    if (folderId) {
      const folder = await this.prisma.materialFolder.findUnique({
        where: { id: folderId, userId, deletedAt: null },
      });
      if (!folder) throw new BadRequestException('文件夹不存在');
    }

    const updated = await this.prisma.media.update({
      where: { id: fileId },
      data: { folderId },
    });

    if (!updated.thumbnailKey) {
      await this.thumbnailQueue.add('generate-thumbnail', {
        mediaId: updated.id,
        key: updated.key,
        mimeType: updated.mimeType,
      });
    }

    return updated;
  }

  async toggleFavorite(userId: string, fileId: string) {
    const file = await this.prisma.media.findUnique({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { isFavorite: !file.isFavorite },
    });
  }

  async deleteFile(userId: string, fileId: string) {
    const file = await this.prisma.media.findUnique({
      where: { id: fileId, userId, deletedAt: null },
    });
    if (!file) throw new BadRequestException('文件不存在');

    return this.prisma.media.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });
  }
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/services/material.service.spec.ts`
Expected: all 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/services/
git -C D:/flowweb commit -m "feat: add MaterialService with TDD"
```

---

### Task 6: FolderController (TDD)

**Files:**
- Create: `apps/api/src/modules/material-library/controllers/folder.controller.ts`
- Test: `apps/api/src/modules/material-library/controllers/folder.controller.spec.ts`

- [ ] **Step 1: Write failing tests**

`apps/api/src/modules/material-library/controllers/folder.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FolderController } from './folder.controller';
import { FolderService } from '../services/folder.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FolderController', () => {
  let controller: FolderController;
  let service: { create: any; findAllByUserId: any; update: any; remove: any; moveUp: any };

  beforeEach(async () => {
    service = {
      create: vi.fn(),
      findAllByUserId: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      moveUp: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderController],
      providers: [{ provide: FolderService, useValue: service }],
    }).compile();

    controller = module.get<FolderController>(FolderController);
  });

  const mockReq = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  it('POST / should return { success: true, data }', async () => {
    service.create.mockResolvedValue({ id: 'f-1', name: 'Test' });
    const res = await controller.create({ name: 'Test' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'f-1', name: 'Test' } });
  });

  it('GET / should return { success: true, data }', async () => {
    service.findAllByUserId.mockResolvedValue([{ id: 'f-1' }]);
    const res = await controller.findAll(mockReq());
    expect(res).toEqual({ success: true, data: [{ id: 'f-1' }] });
  });

  it('PUT /:id should return { success: true, data }', async () => {
    service.update.mockResolvedValue({ id: 'f-1', name: 'Updated' });
    const res = await controller.update('f-1', { name: 'Updated' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'f-1', name: 'Updated' } });
  });

  it('DELETE /:id should return { success: true }', async () => {
    service.remove.mockResolvedValue(undefined);
    const res = await controller.remove('f-1', mockReq());
    expect(res).toEqual({ success: true });
  });

  it('PUT /:id/move-up should return { success: true }', async () => {
    service.moveUp.mockResolvedValue(undefined);
    const res = await controller.moveUp('f-1', mockReq());
    expect(res).toEqual({ success: true });
  });
});
```

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/controllers/folder.controller.spec.ts`
Expected: FAIL — `FolderController` not found

- [ ] **Step 2: Implement FolderController**

`apps/api/src/modules/material-library/controllers/folder.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Param, Delete, Put, Req } from '@nestjs/common';
import { FolderService } from '../services/folder.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';

@Controller('material/folders')
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @Post()
  async create(@Body() dto: CreateFolderDto, @Req() req: any) {
    const folder = await this.folderService.create(dto, req.user.id);
    return { success: true, data: folder };
  }

  @Get()
  async findAll(@Req() req: any) {
    const folders = await this.folderService.findAllByUserId(req.user.id);
    return { success: true, data: folders };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFolderDto, @Req() req: any) {
    const folder = await this.folderService.update(id, dto, req.user.id);
    return { success: true, data: folder };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.folderService.remove(id, req.user.id);
    return { success: true };
  }

  @Put(':id/move-up')
  async moveUp(@Param('id') id: string, @Req() req: any) {
    await this.folderService.moveUp(id, req.user.id);
    return { success: true };
  }
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/controllers/folder.controller.spec.ts`
Expected: all 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/controllers/
git -C D:/flowweb commit -m "feat: add FolderController with TDD"
```

---

### Task 7: FileController (TDD)

**Files:**
- Create: `apps/api/src/modules/material-library/controllers/file.controller.ts`
- Test: `apps/api/src/modules/material-library/controllers/file.controller.spec.ts`

- [ ] **Step 1: Write failing tests**

`apps/api/src/modules/material-library/controllers/file.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FileController } from './file.controller';
import { MaterialService } from '../services/material.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('FileController', () => {
  let controller: FileController;
  let service: { getFilesByFolderId: any; moveFile: any; toggleFavorite: any; deleteFile: any };

  beforeEach(async () => {
    service = {
      getFilesByFolderId: vi.fn(),
      moveFile: vi.fn(),
      toggleFavorite: vi.fn(),
      deleteFile: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileController],
      providers: [{ provide: MaterialService, useValue: service }],
    }).compile();

    controller = module.get<FileController>(FileController);
  });

  const mockReq = (userId = 'user-1') => ({ user: { id: userId } }) as any;

  it('GET / should return files in folder', async () => {
    service.getFilesByFolderId.mockResolvedValue([{ id: 'm-1' }]);
    const res = await controller.getFiles(mockReq(), 'folder-1');
    expect(res).toEqual({ success: true, data: [{ id: 'm-1' }] });
    expect(service.getFilesByFolderId).toHaveBeenCalledWith('user-1', 'folder-1');
  });

  it('PUT /:id/move should move file', async () => {
    service.moveFile.mockResolvedValue({ id: 'm-1', folderId: 'folder-1' });
    const res = await controller.moveFile('m-1', { folderId: 'folder-1' }, mockReq());
    expect(res).toEqual({ success: true, data: { id: 'm-1', folderId: 'folder-1' } });
  });

  it('PUT /:id/toggle-favorite should toggle', async () => {
    service.toggleFavorite.mockResolvedValue({ id: 'm-1', isFavorite: true });
    const res = await controller.toggleFavorite('m-1', mockReq());
    expect(res).toEqual({ success: true, data: { id: 'm-1', isFavorite: true } });
  });

  it('DELETE /:id should delete file', async () => {
    service.deleteFile.mockResolvedValue({ id: 'm-1' });
    const res = await controller.deleteFile('m-1', mockReq());
    expect(res).toEqual({ success: true });
  });
});
```

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/controllers/file.controller.spec.ts`
Expected: FAIL — `FileController` not found

- [ ] **Step 2: Implement FileController**

`apps/api/src/modules/material-library/controllers/file.controller.ts`:

```typescript
import { Controller, Get, Put, Delete, Param, Body, Req, Query } from '@nestjs/common';
import { MaterialService } from '../services/material.service';
import { MoveFileDto } from '../dto/move-file.dto';

@Controller('material/files')
export class FileController {
  constructor(private readonly materialService: MaterialService) {}

  @Get()
  async getFiles(@Req() req: any, @Query('folderId') folderId?: string) {
    const files = await this.materialService.getFilesByFolderId(
      req.user.id,
      folderId || null,
    );
    return { success: true, data: files };
  }

  @Put(':id/move')
  async moveFile(
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
    @Req() req: any,
  ) {
    const file = await this.materialService.moveFile(req.user.id, id, dto.folderId);
    return { success: true, data: file };
  }

  @Put(':id/toggle-favorite')
  async toggleFavorite(@Param('id') id: string, @Req() req: any) {
    const file = await this.materialService.toggleFavorite(req.user.id, id);
    return { success: true, data: file };
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string, @Req() req: any) {
    await this.materialService.deleteFile(req.user.id, id);
    return { success: true };
  }
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\api && npx vitest run src/modules/material-library/controllers/file.controller.spec.ts`
Expected: all 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/controllers/
git -C D:/flowweb commit -m "feat: add FileController with TDD"
```

---

### Task 8: ThumbnailGeneratorConsumer

**Files:**
- Create: `apps/api/src/modules/material-library/consumers/thumbnail-generator.consumer.ts`

Since this is a BullMQ consumer that depends on external binaries (sharp, ffmpeg), TDD here focuses on the module/queue registration, not the image processing itself (tested via integration).

- [ ] **Step 1: Create consumer**

`apps/api/src/modules/material-library/consumers/thumbnail-generator.consumer.ts`:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { THUMBNAIL_GENERATOR_QUEUE, THUMBNAIL_GENERATOR_CONNECTION } from '../constants/material-library.constants';
import * as sharp from 'sharp';
import * as fs from 'fs';
import * as tmp from 'tmp';

// Auto-cleanup temp files on process exit (cross-platform safe)
tmp.setGracefulCleanup();

@Processor(THUMBNAIL_GENERATOR_QUEUE, { connection: THUMBNAIL_GENERATOR_CONNECTION })
export class ThumbnailGeneratorConsumer extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
  ) {
    super();
  }

  async process(job: Job<{ mediaId: string; key: string; mimeType: string }>) {
    const { mediaId, key, mimeType } = job.data;
    try {
      if (mimeType.startsWith('image/')) {
        await this.processImage(mediaId, key);
      } else if (mimeType.startsWith('video/')) {
        await this.processVideo(mediaId, key);
      }
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      throw error;
    }
  }

  private async processImage(mediaId: string, key: string) {
    const stream = await this.minioService.getObject(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const thumbnailBuffer = await sharp(buffer)
      .resize(300, 225, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    const thumbnailKey = `thumbnails/${mediaId}.webp`;
    await this.minioService.upload(thumbnailKey, thumbnailBuffer, 'image/webp');

    // Store key, NOT signed URL — URLs expire after 24h
    await this.prisma.media.update({
      where: { id: mediaId },
      data: { thumbnailKey },
    });
  }

  private async processVideo(mediaId: string, key: string) {
    const ffmpeg = await import('fluent-ffmpeg');
    // Use tmp package for automatic cleanup (handles Windows paths with spaces)
    const tempFile = tmp.fileSync({ postfix: '.mp4' });
    const tempPath = tempFile.name;
    const thumbFile = tmp.fileSync({ postfix: '.jpg' });
    const thumbnailPath = thumbFile.name;

    const stream = await this.minioService.getObject(key);
    const writeStream = fs.createWriteStream(tempPath);
    stream.pipe(writeStream);
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', reject);
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg.default(tempPath)
        .screenshots({
          timestamps: [1],
          filename: path.basename(thumbnailPath),
          folder: path.dirname(thumbnailPath),
          size: '300x225',
        })
        .on('end', () => resolve())
        .on('error', reject);
    });

    const thumbnailBuffer = fs.readFileSync(thumbnailPath);
    const thumbnailKey = `thumbnails/${mediaId}.webp`;
    const webpBuffer = await sharp(thumbnailBuffer).webp({ quality: 80 }).toBuffer();

    await this.minioService.upload(thumbnailKey, webpBuffer, 'image/webp');

    // Store key, NOT signed URL
    await this.prisma.media.update({
      where: { id: mediaId },
      data: { thumbnailKey },
    });
    // tmp cleans up temp files automatically on process exit
  }
}
```

- [ ] **Step 2: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/consumers/
git -C D:/flowweb commit -m "feat: add ThumbnailGeneratorConsumer"
```

---

### Task 9: MaterialLibraryModule + Auth Integration

**Files:**
- Create: `apps/api/src/modules/material-library/material-library.module.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create MaterialLibraryModule**

`apps/api/src/modules/material-library/material-library.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FolderController } from './controllers/folder.controller';
import { FileController } from './controllers/file.controller';
import { FolderService } from './services/folder.service';
import { MaterialService } from './services/material.service';
import { ThumbnailGeneratorConsumer } from './consumers/thumbnail-generator.consumer';
import { THUMBNAIL_GENERATOR_QUEUE, THUMBNAIL_GENERATOR_CONNECTION } from './constants/material-library.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: THUMBNAIL_GENERATOR_QUEUE,
      connection: THUMBNAIL_GENERATOR_CONNECTION,
    }),
  ],
  controllers: [FolderController, FileController],
  providers: [FolderService, MaterialService, ThumbnailGeneratorConsumer],
  exports: [MaterialService],
})
export class MaterialLibraryModule {}
```

- [ ] **Step 2: Register module in AppModule**

In `apps/api/src/app.module.ts`, add import:

```typescript
import { MaterialLibraryModule } from './modules/material-library/material-library.module';
```

And add `MaterialLibraryModule` to the `imports` array (after `TempCleanupModule`):

```typescript
TempCleanupModule,
MaterialLibraryModule,
```

- [ ] **Step 3: Add default folder creation to sign-up**

Modify `apps/api/src/auth/auth.controller.ts` — inject `PrismaService` and `DEFAULT_FOLDER_NAMES`, create folders after successful sign-up:

Add imports at top:
```typescript
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_FOLDER_NAMES } from '../modules/material-library/constants/material-library.constants';
```

Modify constructor:
```typescript
constructor(
  private readonly authService: AuthService,
  private readonly prisma: PrismaService,
) {}
```

Modify `signUp` method — after `const result = await this.authService.signUp(...)` insert:
```typescript
// Create default material folders
try {
  await this.prisma.materialFolder.createMany({
    data: DEFAULT_FOLDER_NAMES.map((name, index) => ({
      name,
      userId: result.user.id,
      isDefault: true,
      sortOrder: index, // 按数组顺序：角色=0, 场景=1, 道具=2, 风格=3, 音效=4, 生成历史=5
    })),
  });
} catch {
  // Non-fatal — user can still use the app, folders can be created later
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd D:\flowweb\apps\api && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/api/src/modules/material-library/material-library.module.ts apps/api/src/app.module.ts apps/api/src/auth/auth.controller.ts
git -C D:/flowweb commit -m "feat: register MaterialLibraryModule and create default folders on sign-up"
```

---

### Task 10: Shared Types

**Files:**
- Create: `packages/shared/src/types/material-library.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create type definitions**

`packages/shared/src/types/material-library.ts`:

```typescript
export interface MaterialFolder {
  id: string;
  name: string;
  parentId: string | null;
  userId: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url?: string;           // 动态生成的预签名URL，不持久化
  thumbnailUrl?: string;   // 动态生成，来自 thumbnailKey
  folderId: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Export from shared index**

In `packages/shared/src/index.ts`, add:
```typescript
export * from './types/material-library';
```

- [ ] **Step 3: Verify types compile**

```bash
cd D:\flowweb\packages\shared && pnpm build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add packages/shared/
git -C D:/flowweb commit -m "feat: add material-library shared types"
```

---

### Task 11: materialLibraryStore (TDD)

**Files:**
- Create: `apps/web/src/stores/materialLibraryStore.ts`
- Test: `apps/web/src/stores/materialLibraryStore.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/web/src/stores/materialLibraryStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMaterialLibraryStore } from './materialLibraryStore';
import axios from 'axios';

vi.mock('axios');

describe('materialLibraryStore', () => {
  beforeEach(() => {
    useMaterialLibraryStore.setState({
      isOpen: false,
      selectedFolderId: null,
      folders: [],
      files: [],
      fileGridSize: 200,
      loading: false,
      uploading: false,
    });
    vi.clearAllMocks();
  });

  it('should open and close', () => {
    const { open, close } = useMaterialLibraryStore.getState();
    open();
    expect(useMaterialLibraryStore.getState().isOpen).toBe(true);
    close();
    expect(useMaterialLibraryStore.getState().isOpen).toBe(false);
  });

  it('should set selected folder', () => {
    useMaterialLibraryStore.getState().setSelectedFolder('f-1');
    expect(useMaterialLibraryStore.getState().selectedFolderId).toBe('f-1');
  });

  it('should set file grid size', () => {
    useMaterialLibraryStore.getState().setFileGridSize(250);
    expect(useMaterialLibraryStore.getState().fileGridSize).toBe(250);
  });

  it('should load folders on success', async () => {
    (axios.get as any).mockResolvedValue({
      data: { success: true, data: [{ id: 'f-1', name: '角色' }] },
    });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'f-1', name: '角色' }]);
  });

  it('should handle load folders failure', async () => {
    (axios.get as any).mockRejectedValue(new Error('network'));
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().loading).toBe(false);
  });
});
```

Run: `cd D:\flowweb\apps\web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: FAIL — store not found

- [ ] **Step 2: Implement store**

`apps/web/src/stores/materialLibraryStore.ts`:

```typescript
import { create } from 'zustand';
import axios from 'axios';
import type { MaterialFolder, MaterialFile } from '@flowweb/shared';

const MAX_FILE_SIZE = { image: 10 * 1024 * 1024, video: 100 * 1024 * 1024 };

interface MaterialLibraryState {
  isOpen: boolean;
  selectedFolderId: string | null;
  folders: MaterialFolder[];
  files: MaterialFile[];
  fileGridSize: number;
  loading: boolean;
  uploading: boolean;
  uploadProgress: number;

  open: () => void;
  close: () => void;
  setSelectedFolder: (id: string | null) => void;
  setFileGridSize: (size: number) => void;
  loadFolders: () => Promise<void>;
  loadFiles: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolderUp: (id: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
}

export const useMaterialLibraryStore = create<MaterialLibraryState>((set, get) => ({
  isOpen: false,
  selectedFolderId: null,
  folders: [],
  files: [],
  fileGridSize: 200,
  loading: false,
  uploading: false,
  uploadProgress: 0,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSelectedFolder: (id) => set({ selectedFolderId: id }),
  setFileGridSize: (size) => set({ fileGridSize: size }),

  loadFolders: async () => {
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/material/folders');
      if (data.success) set({ folders: data.data });
    } finally {
      set({ loading: false });
    }
  },

  loadFiles: async () => {
    set({ loading: true });
    try {
      const { selectedFolderId } = get();
      const { data } = await axios.get('/api/material/files', {
        params: { folderId: selectedFolderId },
      });
      if (data.success) set({ files: data.data });
    } finally {
      set({ loading: false });
    }
  },

  createFolder: async (name, parentId = null) => {
    await axios.post('/api/material/folders', { name, parentId });
    await get().loadFolders();
  },

  renameFolder: async (id, name) => {
    await axios.put(`/api/material/folders/${id}`, { name });
    await get().loadFolders();
  },

  deleteFolder: async (id) => {
    await axios.delete(`/api/material/folders/${id}`);
    const { selectedFolderId } = get();
    if (selectedFolderId === id) set({ selectedFolderId: null });
    await get().loadFolders();
  },

  moveFolderUp: async (id) => {
    await axios.put(`/api/material/folders/${id}/move-up`);
    await get().loadFolders();
  },

  uploadFile: async (file) => {
    // Frontend pre-validation — reject invalid files before API call
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert('仅支持图片和视频文件');
      return;
    }
    const maxSize = isVideo ? MAX_FILE_SIZE.video : MAX_FILE_SIZE.image;
    if (file.size > maxSize) {
      alert(`文件太大，${isVideo ? '视频' : '图片'}最大 ${maxSize / 1024 / 1024}MB`);
      return;
    }

    set({ uploading: true, uploadProgress: 0 });
    const source = axios.CancelToken.source();
    try {
      const { selectedFolderId } = get();

      const presignRes = await axios.post('/api/storage/presign', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });
      const { fileId, uploadUrl, fields } = presignRes.data;

      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v as string));
      formData.append('file', file);

      await axios.post(uploadUrl, formData, {
        cancelToken: source.token,
        onUploadProgress: (e) => {
          const pct = Math.round((e.loaded * 100) / (e.total || 1));
          set({ uploadProgress: pct });
        },
      });

      await axios.post('/api/storage/confirm', {
        fileId,
        key: fields.key,
        fileSize: file.size,
      });

      await axios.put(`/api/material/files/${fileId}/move`, {
        folderId: selectedFolderId,
      });

      await get().loadFiles();
    } catch (err) {
      if (!axios.isCancel(err)) console.error('Upload failed:', err);
    } finally {
      set({ uploading: false, uploadProgress: 0 });
    }
  },

  deleteFile: async (id) => {
    await axios.delete(`/api/material/files/${id}`);
    set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
  },

  toggleFavorite: async (id) => {
    const { data } = await axios.put(`/api/material/files/${id}/toggle-favorite`);
    if (data.success) {
      set((s) => ({
        files: s.files.map((f) =>
          f.id === id ? { ...f, isFavorite: data.data.isFavorite } : f
        ),
      }));
    }
  },
}));
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\web && npx vitest run src/stores/materialLibraryStore.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/web/src/stores/materialLibraryStore.ts apps/web/src/stores/materialLibraryStore.test.ts
git -C D:/flowweb commit -m "feat: add materialLibraryStore with TDD"
```

---

### Task 12: FolderTree Component (TDD)

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/FolderTree/FolderTree.tsx`
- Test: `apps/web/src/components/MaterialLibrary/FolderTree/FolderTree.test.tsx`

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/MaterialLibrary/FolderTree/FolderTree.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FolderTree from './FolderTree';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';

vi.mock('../../../stores/materialLibraryStore');

describe('FolderTree', () => {
  const setSelectedFolder = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      folders: [
        { id: '1', name: '角色', parentId: null, isDefault: true, sortOrder: 0 },
        { id: '2', name: '场景', parentId: null, isDefault: true, sortOrder: 1 },
      ],
      selectedFolderId: null,
      setSelectedFolder,
    });
  });

  it('should render default folders', () => {
    render(<FolderTree />);
    expect(screen.getByText('角色')).toBeInTheDocument();
    expect(screen.getByText('场景')).toBeInTheDocument();
  });

  it('should show new folder button', () => {
    render(<FolderTree />);
    expect(screen.getByText('+ 新建文件夹')).toBeInTheDocument();
  });
});
```

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FolderTree/FolderTree.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 2: Implement FolderTree**

`apps/web/src/components/MaterialLibrary/FolderTree/FolderTree.tsx`:

```typescript
import { Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';

function buildTree(folders: MaterialFolder[], parentId: string | null = null): TreeDataNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      key: f.id,
      title: f.name,
      children: buildTree(folders, f.id),
    }));
}

export default function FolderTree() {
  const folders = useMaterialLibraryStore((s) => s.folders);
  const selectedFolderId = useMaterialLibraryStore((s) => s.selectedFolderId);
  const setSelectedFolder = useMaterialLibraryStore((s) => s.setSelectedFolder);

  const treeData = buildTree(folders);

  return (
    <div className="folder-tree-container">
      <div className="sidebar-header">
        <button className="new-folder-btn" onClick={() => {
          const name = prompt('请输入文件夹名称');
          if (name) useMaterialLibraryStore.getState().createFolder(name);
        }}>
          + 新建文件夹
        </button>
      </div>
      <Tree
        showLine
        defaultExpandAll
        selectedKeys={selectedFolderId ? [selectedFolderId] : []}
        onSelect={(keys) => setSelectedFolder(keys[0] as string || null)}
        treeData={treeData}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run tests to verify**

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FolderTree/FolderTree.test.tsx`
Expected: all 2 tests PASS

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/MaterialLibrary/FolderTree/
git -C D:/flowweb commit -m "feat: add FolderTree component with TDD"
```

---

### Task 12b: FolderContextMenu Component (TDD)

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/FolderTree/FolderContextMenu.tsx`
- Test: `apps/web/src/components/MaterialLibrary/FolderTree/FolderContextMenu.test.tsx`

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/MaterialLibrary/FolderTree/FolderContextMenu.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FolderContextMenu from './FolderContextMenu';

describe('FolderContextMenu', () => {
  const folder = { id: 'f-1', name: 'My Folder', isDefault: false, parentId: null, sortOrder: 0, userId: 'u1', createdAt: '', updatedAt: '' };
  const onClose = vi.fn();

  it('should render menu options for non-default folder', () => {
    render(<FolderContextMenu x={100} y={200} folder={folder} onClose={onClose} />);
    expect(screen.getByText('新建子文件夹')).toBeInTheDocument();
    expect(screen.getByText('重命名')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByText('向上移动')).toBeInTheDocument();
  });

  it('should render only "新建子文件夹" for default folder', () => {
    const defaultFolder = { ...folder, isDefault: true };
    render(<FolderContextMenu x={100} y={200} folder={defaultFolder} onClose={onClose} />);
    expect(screen.getByText('新建子文件夹')).toBeInTheDocument();
    expect(screen.queryByText('重命名')).not.toBeInTheDocument();
    expect(screen.queryByText('删除')).not.toBeInTheDocument();
  });

  it('should call onClose when clicking outside', () => {
    render(<FolderContextMenu x={100} y={200} folder={folder} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});
```

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FolderTree/FolderContextMenu.test.tsx`
Expected: FAIL

- [ ] **Step 2: Implement FolderContextMenu**

`apps/web/src/components/MaterialLibrary/FolderTree/FolderContextMenu.tsx`:

```typescript
import { useEffect } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFolder } from '@flowweb/shared';

interface Props {
  x: number;
  y: number;
  folder: MaterialFolder;
  onClose: () => void;
}

export default function FolderContextMenu({ x, y, folder, onClose }: Props) {
  const createFolder = useMaterialLibraryStore((s) => s.createFolder);
  const renameFolder = useMaterialLibraryStore((s) => s.renameFolder);
  const deleteFolder = useMaterialLibraryStore((s) => s.deleteFolder);
  const moveFolderUp = useMaterialLibraryStore((s) => s.moveFolderUp);

  useEffect(() => {
    const handler = () => onClose();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleCreateSub = () => {
    const name = prompt('请输入子文件夹名称');
    if (name) createFolder(name, folder.id);
    onClose();
  };

  const handleRename = () => {
    const name = prompt('请输入新名称', folder.name);
    if (name && name !== folder.name) renameFolder(folder.id, name);
    onClose();
  };

  const handleDelete = () => {
    if (confirm(`确定删除文件夹"${folder.name}"及其内容？`)) deleteFolder(folder.id);
    onClose();
  };

  const items: { label: string; onClick: () => void; danger?: boolean }[] = [
    { label: '新建子文件夹', onClick: handleCreateSub },
  ];
  if (!folder.isDefault) {
    items.push(
      { label: '重命名', onClick: handleRename },
      { label: '删除', onClick: handleDelete, danger: true },
      { label: '向上移动', onClick: () => { moveFolderUp(folder.id); onClose(); } },
    );
  }

  // Prevent menu from overflowing viewport edges
  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <div
      className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded-lg py-1 shadow-lg"
      style={{ left: adjustedX, top: adjustedY, minWidth: 140 }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#333] transition-colors ${item.danger ? 'text-red-400' : 'text-gray-200'}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify tests pass + Commit**

```bash
cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FolderTree/
git -C D:/flowweb add apps/web/src/components/MaterialLibrary/FolderTree/
git -C D:/flowweb commit -m "feat: add FolderContextMenu component with TDD"
```

---

### Task 13: FileGrid + FileCard Components (TDD)

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.tsx`
- Create: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.tsx`
- Test: `apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.test.tsx`
- Test: `apps/web/src/components/MaterialLibrary/FileGrid/FileCard.test.tsx`

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileGrid from './FileGrid';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';

vi.mock('../../../stores/materialLibraryStore');

describe('FileGrid', () => {
  beforeEach(() => {
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      files: [],
      fileGridSize: 200,
      loading: false,
    });
  });

  it('should show empty state when no files', () => {
    render(<FileGrid />);
    expect(screen.getByText('暂无素材，点击上传按钮添加')).toBeInTheDocument();
  });

  it('should show loading state', () => {
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      files: [],
      fileGridSize: 200,
      loading: true,
    });
    render(<FileGrid />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('should group files by date', () => {
    const files = [
      { id: '1', originalName: 'a.png', createdAt: '2026-06-01', mimeType: 'image/png', size: 100, url: '', isFavorite: false },
      { id: '2', originalName: 'b.png', createdAt: '2026-06-01', mimeType: 'image/png', size: 200, url: '', isFavorite: false },
    ];
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      files, fileGridSize: 200, loading: false,
    });
    render(<FileGrid />);
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });
});
```

`apps/web/src/components/MaterialLibrary/FileGrid/FileCard.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import FileCard from './FileCard';

describe('FileCard', () => {
  const file = {
    id: '1',
    originalName: 'test.png',
    mimeType: 'image/png',
    size: 1024,
    url: 'http://example.com/test.png',
    isFavorite: false,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };

  it('should render file name', () => {
    render(<FileCard file={file} />);
    expect(screen.getByText('test.png')).toBeInTheDocument();
  });

  it('should show favorite icon', () => {
    render(<FileCard file={{ ...file, isFavorite: true }} />);
    expect(screen.getByText('⭐')).toBeInTheDocument();
  });

  it('should have delete and favorite buttons', () => {
    render(<FileCard file={file} />);
    expect(screen.getByTitle('收藏')).toBeInTheDocument();
    expect(screen.getByTitle('删除')).toBeInTheDocument();
  });
});
```

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FileGrid/`
Expected: FAIL — components not found

- [ ] **Step 2: Implement FileGrid**

`apps/web/src/components/MaterialLibrary/FileGrid/FileGrid.tsx`:

```typescript
import { useMemo } from 'react';
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import FileCard from './FileCard';
import type { MaterialFile } from '@flowweb/shared';

export default function FileGrid() {
  const files = useMaterialLibraryStore((s) => s.files);
  const fileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const loading = useMaterialLibraryStore((s) => s.loading);

  const grouped = useMemo(() => {
    const groups: Record<string, MaterialFile[]> = {};
    files.forEach((f) => {
      const date = new Date(f.createdAt).toLocaleDateString('zh-CN');
      if (!groups[date]) groups[date] = [];
      groups[date].push(f);
    });
    return Object.entries(groups).sort((a, b) =>
      new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [files]);

  if (loading) return <div className="file-grid-loading">加载中...</div>;
  if (files.length === 0) return <div className="file-grid-empty">暂无素材，点击上传按钮添加</div>;

  return (
    <div className="file-grid-container">
      {grouped.map(([date, items]) => (
        <div key={date} className="file-group">
          <div className="text-sm text-gray-400 mb-2">{date}</div>
          <div
            className="file-grid"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${fileGridSize}px, 1fr))` }}
          >
            {items.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Implement FileCard**

`apps/web/src/components/MaterialLibrary/FileGrid/FileCard.tsx`:

```typescript
import { useMaterialLibraryStore } from '../../../stores/materialLibraryStore';
import type { MaterialFile } from '@flowweb/shared';

interface FileCardProps {
  file: MaterialFile;
}

export default function FileCard({ file }: FileCardProps) {
  const toggleFavorite = useMaterialLibraryStore((s) => s.toggleFavorite);
  const deleteFile = useMaterialLibraryStore((s) => s.deleteFile);

  return (
    <div className="file-card bg-[#2a2a2a] rounded-lg overflow-hidden hover:bg-[#333] transition-colors group relative"
      style={{ aspectRatio: '4/3' }}
    >
      {/* Preview */}
      {file.thumbnailUrl || file.url ? (
        <img
          src={file.thumbnailUrl || file.url}
          alt={file.originalName}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      <div className={`w-full h-full flex items-center justify-center text-4xl ${file.thumbnailUrl || file.url ? 'hidden' : ''}`}>
        {file.mimeType?.startsWith('video/') ? '🎬' : '🖼️'}
      </div>

      {/* Action buttons — visible on hover */}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <button title="收藏"
          className="bg-[#00000080] rounded p-0.5 text-xs hover:bg-[#000000cc]"
          onClick={(e) => { e.stopPropagation(); toggleFavorite(file.id); }}
        >
          {file.isFavorite ? '⭐' : '☆'}
        </button>
        <button title="删除"
          className="bg-[#00000080] rounded p-0.5 text-xs hover:bg-[#000000cc] text-red-400"
          onClick={(e) => { e.stopPropagation(); if (confirm('确定删除？')) deleteFile(file.id); }}
        >
          🗑️
        </button>
      </div>

      {/* Name */}
      <div className="p-1 text-xs truncate text-gray-300">
        {file.isFavorite && '⭐ '}
        {file.originalName}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify**

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/FileGrid/`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/MaterialLibrary/FileGrid/
git -C D:/flowweb commit -m "feat: add FileGrid and FileCard components with TDD"
```

---

### Task 14: MaterialLibraryModal + CSS (TDD)

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/MaterialLibraryModal.tsx`
- Create: `apps/web/src/components/MaterialLibrary/MaterialLibraryModal.css`
- Test: `apps/web/src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MaterialLibraryModal from './MaterialLibraryModal';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

vi.mock('../../stores/materialLibraryStore');
vi.mock('./FolderTree/FolderTree', () => ({ default: () => <div>FolderTree</div> }));
vi.mock('./FileGrid/FileGrid', () => ({ default: () => <div>FileGrid</div> }));

describe('MaterialLibraryModal', () => {
  const close = vi.fn();
  const loadFolders = vi.fn();
  const loadFiles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isOpen: true,
      selectedFolderId: null,
      close,
      loadFolders,
      loadFiles,
      uploading: false,
    });
  });

  it('should render when open', () => {
    render(<MaterialLibraryModal />);
    expect(screen.getByText('我的素材库')).toBeInTheDocument();
  });

  it('should load folders and files on open', () => {
    render(<MaterialLibraryModal />);
    expect(loadFolders).toHaveBeenCalled();
    expect(loadFiles).toHaveBeenCalled();
  });

  it('should not render when closed', () => {
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      isOpen: false, close, loadFolders, loadFiles, uploading: false, selectedFolderId: null,
    });
    render(<MaterialLibraryModal />);
    expect(screen.queryByText('我的素材库')).not.toBeInTheDocument();
  });
});
```

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`
Expected: FAIL

- [ ] **Step 2: Implement MaterialLibraryModal**

`apps/web/src/components/MaterialLibrary/MaterialLibraryModal.tsx`:

```typescript
import { useEffect } from 'react';
import { Modal } from 'antd';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';
import FolderTree from './FolderTree/FolderTree';
import FileGrid from './FileGrid/FileGrid';
import FileGridZoomControl from './FileGridZoomControl';
import './MaterialLibraryModal.css';

export default function MaterialLibraryModal() {
  const isOpen = useMaterialLibraryStore((s) => s.isOpen);
  const close = useMaterialLibraryStore((s) => s.close);
  const loadFolders = useMaterialLibraryStore((s) => s.loadFolders);
  const loadFiles = useMaterialLibraryStore((s) => s.loadFiles);
  const uploading = useMaterialLibraryStore((s) => s.uploading);

  useEffect(() => {
    if (isOpen) { loadFolders(); loadFiles(); }
  }, [isOpen, loadFolders, loadFiles]);

  if (!isOpen) return null;

  return (
    <Modal
      title="我的素材库"
      open={isOpen}
      onCancel={close}
      footer={null}
      width="90%"
      style={{ top: 20 }}
      className="material-library-modal"
    >
      <div className="material-library-container">
        <div className="material-library-sidebar">
          <FolderTree />
        </div>
        <div className="material-library-main">
          <div className="main-header">
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) useMaterialLibraryStore.getState().uploadFile(file);
                  e.target.value = '';
                }}
                disabled={uploading}
              />
              {uploading && <span className="text-blue-400 text-sm">上传中...</span>}
            </div>
            <FileGridZoomControl />
          </div>
          <FileGrid />
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Create CSS**

`apps/web/src/components/MaterialLibrary/MaterialLibraryModal.css`:

```css
.material-library-modal .ant-modal-content {
  height: 85vh;
  display: flex;
  flex-direction: column;
  background-color: #222;
  border: 1px solid #333;
}
.material-library-modal .ant-modal-header { background-color: #222; border-bottom: 1px solid #333; color: #fff; }
.material-library-modal .ant-modal-title { color: #fff; }
.material-library-modal .ant-modal-body { flex: 1; padding: 0; overflow: hidden; background-color: #222; }
.material-library-container { display: flex; height: 100%; }
.material-library-sidebar { width: 240px; border-right: 1px solid #333; display: flex; flex-direction: column; background-color: #222; }
.sidebar-header { padding: 16px; border-bottom: 1px solid #333; }
.new-folder-btn { width: 100%; padding: 8px 12px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; }
.new-folder-btn:hover { background: #2563eb; }
.material-library-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.main-header { padding: 16px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
.file-grid-container { flex: 1; overflow-y: auto; padding: 16px; }
.file-group { margin-bottom: 24px; }
.file-grid { display: grid; gap: 16px; }
.file-grid-loading, .file-grid-empty { display: flex; justify-content: center; align-items: center; height: 200px; color: #71717a; }
```

- [ ] **Step 4: Run tests to verify**

Run: `cd D:\flowweb\apps\web && npx vitest run src/components/MaterialLibrary/MaterialLibraryModal.test.tsx`
Expected: all 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/MaterialLibrary/
git -C D:/flowweb commit -m "feat: add MaterialLibraryModal with TDD"
```

---

### Task 14b: FileGridZoomControl Component

**Files:**
- Create: `apps/web/src/components/MaterialLibrary/FileGridZoomControl.tsx`

- [ ] **Step 1: Implement FileGridZoomControl**

`apps/web/src/components/MaterialLibrary/FileGridZoomControl.tsx`:

```typescript
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

export default function FileGridZoomControl() {
  const fileGridSize = useMaterialLibraryStore((s) => s.fileGridSize);
  const setFileGridSize = useMaterialLibraryStore((s) => s.setFileGridSize);

  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <span>🔍</span>
      <input
        type="range"
        min="150"
        max="300"
        step="10"
        value={fileGridSize}
        onChange={(e) => setFileGridSize(Number(e.target.value))}
        className="w-24 h-1 accent-blue-500"
      />
      <span>{fileGridSize}px</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C D:/flowweb add apps/web/src/components/MaterialLibrary/FileGridZoomControl.tsx
git -C D:/flowweb commit -m "feat: add FileGridZoomControl component"
```

---

### Task 15: Canvas Page Integration

**Files:**
- Modify: `apps/web/src/pages/canvas/page.tsx`

- [ ] **Step 1: Add material library button and modal to canvas page**

In `apps/web/src/pages/canvas/page.tsx`, add import:

```typescript
import MaterialLibraryModal from '@/components/MaterialLibrary/MaterialLibraryModal';
import { useMaterialLibraryStore } from '@/stores/materialLibraryStore';
```

In `CanvasPageInner`, add the open handler near other state:

```typescript
const openMaterialLibrary = useMaterialLibraryStore((s) => s.open);
```

Add the trigger button in NodePalette sidebar (near the existing ⌨️ button at the bottom of the sidebar) and the modal before the closing `</ReactFlowProvider>`:

```tsx
{/* After existing KeyboardShortcutsPanel */}
<MaterialLibraryModal />
```

And add a button to open it — in NodePalette or CanvasToolbar. Simplest: add a button in CanvasToolbar alongside existing buttons:

In `CanvasToolbar.tsx`, add a button:

```tsx
<button className={BTN} onClick={() => useMaterialLibraryStore.getState().open()} title="素材库">
  📁
</button>
```

- [ ] **Step 2: Update integration test**

Modify `apps/web/src/pages/canvas/page.test.tsx` to verify the button renders:

```typescript
it('should have material library button', async () => {
  renderPage();
  await screen.findByText('📁');
});
```

- [ ] **Step 3: Verify all tests pass**

```bash
cd D:\flowweb\apps\web && npx vitest run
```

Expected: all existing tests + new material library tests PASS.

- [ ] **Step 4: Commit**

```bash
git -C D:/flowweb add apps/web/src/pages/canvas/page.tsx apps/web/src/pages/canvas/components/CanvasToolbar.tsx apps/web/src/pages/canvas/page.test.tsx
git -C D:/flowweb commit -m "feat: integrate MaterialLibraryModal into canvas page"
```

---

### Task 16: Full Integration Test

- [ ] **Step 1: Run full test suite**

```bash
cd D:\flowweb\apps\api && npx vitest run
cd D:\flowweb\apps\web && npx vitest run
```

Expected: all tests pass across both packages.

- [ ] **Step 2: Verify API compilation**

```bash
cd D:\flowweb\apps\api && npx tsc --noEmit
cd D:\flowweb\apps\web && npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Final commit**

```bash
git -C D:/flowweb add -A
git -C D:/flowweb commit -m "chore: final verification — all tests pass, types clean"
```

---

## Self-Review

### 1. Spec coverage
- ✅ MaterialFolder model + Prisma migration
- ✅ Media model extension (folderId, isFavorite, thumbnailKey — NOT thumbnailUrl)
- ✅ MinioService.getObject
- ✅ FolderService.create auto-calculates sortOrder, default folders get sequential sortOrder
- ✅ MaterialService.getFilesByFolderId generates dynamic presigned URLs (never expire)
- ✅ ThumbnailGeneratorConsumer saves thumbnailKey (not signed URL)
- ✅ FolderController (CRUD + move-up)
- ✅ FileController (GET files, move, toggle-favorite, DELETE)
- ✅ MaterialLibraryModule + AppModule registration
- ✅ Default folder creation on sign-up with sequential sortOrder
- ✅ Shared types
- ✅ materialLibraryStore (Zustand) with upload cancel token
- ✅ FolderTree component
- ✅ FolderContextMenu (右键菜单：新建子文件夹、重命名、删除、向上移动)
- ✅ FileGrid + FileCard (with delete/favorite buttons, image onError fallback)
- ✅ FileGridZoomControl (150px-300px slider)
- ✅ MaterialLibraryModal component
- ✅ Canvas page integration
- ⚠️ Socket.IO notification — deferred to follow-up
- ⚠️ dnd-kit drag-to-canvas — deferred to follow-up

### 2. Placeholder scan
No TBD/TODO/fill-in-later patterns. All tasks have concrete code.

### 3. Type consistency
- FolderService uses `CreateFolderDto`, `UpdateFolderDto` — matched in DTO files
- MaterialService uses `MoveFileDto` — matched
- Shared types `MaterialFolder`, `MaterialFile` used in both store and components
- API field names (`fileSize`, `fileType`, `type: 'uploaded'`) consistent with existing DTOs
