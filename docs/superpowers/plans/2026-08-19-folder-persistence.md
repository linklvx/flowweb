# 文件夹持久化（后端阶段）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作台文件夹从前端会话状态变为真实持久化数据：Folder 表 + 文件夹 CRUD API + Template.folderId 落库 + 画布创建即入列 + 服务端分页 + 草稿清理端点。

**Architecture:** 后端新增 `folder`、`canvas` 两个 NestJS 模块（canvas 模块承载画布创建与保存端点，避免 Template↔Project 循环依赖）；template 模块扩展 folderId 过滤/移动/删除级联；project 模块加草稿清理。前端重写 `useWorkspaceData` 直连 API，删除 fixtures/占位机制，WorkspacePage/CanvasCard 小幅适配。

**Tech Stack:** NestJS + Prisma 5.22（PostgreSQL）+ Vitest（后端单测 mock PrismaService）；React 18 + react-router + antd + Vitest/Testing Library（前端）。

**Spec:** `docs/superpowers/specs/2026-08-19-folder-persistence-design.md`（10 项决策见 spec §2）

**测试命令：**
- 后端单测（当前任务相关）：`pnpm --filter @flowweb/api test -- <文件名关键字>`
- 后端全量：`pnpm --filter @flowweb/api test`
- 前端：`pnpm --filter @flowweb/web test -- <文件名关键字>`
- lint：`pnpm --filter @flowweb/api lint` / `pnpm --filter @flowweb/web lint`

**全局响应约定（新端点遵守）：** 全局 `TransformInterceptor` 把 controller 返回值包成 `{ code: 0, data, message }`；异常经 `HttpExceptionFilter` 变 `{ code: -1, data: null, message }`。前端统一用 `apiFetch`（`apps/web/src/api/client.ts`，取 `json.data`）。新 controller 未登录直接 `throw new UnauthorizedException('未登录')`（不要 template.controller 的 `{ success: false }` 返回风格——那种形状 `apiFetch` 解析不了）。

**Folder 级联 updatedAt 实现要点：** Prisma `updateMany` 不触发 `@updatedAt`，touch 必须**显式传** `data: { updatedAt: new Date() }`（见 FolderService.touch）。

---

## 文件结构总览

**后端（apps/api）：**

| 文件 | 动作 | 职责 |
|---|---|---|
| `prisma/schema.prisma` | 改 | Folder 模型、Template 加 folderId/status/relation/@unique、CanvasProject/User 反向 relation |
| `prisma/migrations/<ts>_folder_persistence/migration.sql` | 新 | 建表/加列/backfill/去重/约束 |
| `src/modules/folder/folder.service.ts` | 新 | 文件夹 CRUD + 聚合列表 + touch |
| `src/modules/folder/folder.controller.ts` | 新 | GET/POST/PATCH/DELETE /api/folders |
| `src/modules/folder/folder.module.ts` | 新 | 模块定义 |
| `src/modules/folder/dto/create-folder.dto.ts`、`update-folder.dto.ts` | 新 | 入参校验 |
| `src/modules/canvas/canvas.service.ts` | 新 | 画布创建（事务）+ save upsert（P2002 回退） |
| `src/modules/canvas/canvas.controller.ts` | 新 | POST /api/canvases + POST /api/projects/:id/save |
| `src/modules/canvas/dto/create-canvas.dto.ts`、`save-canvas.dto.ts` | 新 | 入参校验 |
| `src/modules/canvas/canvas.module.ts` | 新 | 模块定义 |
| `src/modules/template/template.service.ts` | 改 | update 加 folderId/touch、delete 级联、findMany folderId 过滤、**删除 create()** |
| `src/modules/template/template.controller.ts` | 改 | **删除 POST /api/templates 端点** |
| `src/modules/template/dto/update-template.dto.ts`、`template-list-query.dto.ts` | 改 | 加 folderId |
| `src/modules/template/dto/create-template.dto.ts` | 删 | 随端点移除 |
| `src/modules/template/template.constants.ts` | 改 | clearCache 移到 service public（不改文件位置） |
| `src/modules/project/project.service.ts` | 改 | cleanDrafts |
| `src/modules/project/project.controller.ts` | 改 | DELETE /api/projects/drafts |
| `src/app.module.ts` | 改 | 注册 FolderModule、CanvasModule |
| 对应 `.spec.ts` | 新/改 | 见各任务 |

**前端（apps/web/src）：**

| 文件 | 动作 | 职责 |
|---|---|---|
| `api/folderApi.ts` | 新 | 文件夹 CRUD 客户端 |
| `api/canvasApi.ts` | 新 | createCanvas/saveCanvas 客户端 |
| `api/templateApi.ts` | 改 | getTemplates 加 folderId、updateTemplate 类型加 folderId、**删 createTemplate** |
| `api/projectApi.ts` | 改 | **删 createProject** |
| `pages/workspace/types.ts` | 改 | Folder 删 workspaceId、Canvas 删 isPlaceholder |
| `pages/workspace/fixtures.ts` | 删 | mock 数据 |
| `pages/workspace/hooks/useWorkspaceData.ts` | 重写 | 直连 API + 分页 |
| `pages/workspace/WorkspacePage.tsx` | 改 | 删占位分支、enterFolder 联动、删除提示、加载更多 |
| `pages/workspace/components/CanvasCard.tsx` | 改 | 删 isPlaceholder 分支 |
| `pages/canvas/components/SaveAsTemplateDialog.tsx` | 改 | 改调 saveCanvas |
| `__tests__/` 各文件 | 重写/改 | 对应新行为 |

---

### Task 1: Prisma schema 变更与迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_folder_persistence/migration.sql`（由 prisma 生成后手改）

- [ ] **Step 1: 修改 schema.prisma**

在 `model User` 的 relation 列表末尾（`materialFolders MaterialFolder[]` 之后）加一行：

```prisma
  folders      Folder[]
```

在 `model CanvasProject` 的 `user User? @relation(...)` 行后加：

```prisma
  templates Template[]
```

在 `model CanvasProject` 定义后新增（`schema.prisma` 约第 145 行之后）：

```prisma
enum TemplateStatus {
  DRAFT
  SAVED
}

model Folder {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(255)
  parentId  String?
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  parent    Folder?    @relation("FolderHierarchy", fields: [parentId], references: [id], onDelete: SetNull)
  children  Folder[]   @relation("FolderHierarchy")
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  templates Template[]

  @@index([userId, parentId])
}
```

在 `model Template` 中（现有 `projectId String?` 行替换，新增三行，删除 `@@unique([name, userId])` 行）：

```prisma
  folderId    String?
  folder      Folder?         @relation(fields: [folderId], references: [id], onDelete: SetNull)
  projectId   String?         @unique
  project     CanvasProject?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  status      TemplateStatus  @default(DRAFT)

  @@index([folderId])
```

注意：`@@unique([name, userId])` **删除**（决策 #3），`@@index([userId])` 等其余索引保留。

- [ ] **Step 2: 生成迁移骨架（不立即应用）**

```bash
cd apps/api && npx prisma migrate dev --create-only --name folder_persistence
```

预期：在 `prisma/migrations/` 下生成 `<timestamp>_folder_persistence/migration.sql`。

- [ ] **Step 3: 手动编辑 migration.sql**

Prisma 生成的 SQL 需要调整顺序并补充数据修复步骤。**最终文件应包含（顺序如下，Prisma 自动生成的语句位置可能不同，手工调整）**：

```sql
-- 1. 类型与建表（Prisma 自动生成）
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'SAVED');
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Folder_userId_parentId_idx" ON "Folder"("userId", "parentId");
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Template 加列（Prisma 自动生成）
ALTER TABLE "Template" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Template" ADD COLUMN "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT';

-- 3. 删除 (name, userId) 唯一约束（Prisma 自动生成，确认存在）
DROP INDEX/"CONSTRAINT" "Template_name_userId_key";  -- 用 Prisma 生成的实际语句

-- 4. 数据修复（手写补充，必须在 FK 与唯一索引之前）
UPDATE "Template" SET "projectId" = NULL
WHERE "projectId" IS NOT NULL
  AND "projectId" NOT IN (SELECT "id" FROM "CanvasProject");

UPDATE "Template" SET "projectId" = NULL
WHERE "projectId" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("projectId") "id" FROM "Template"
    WHERE "projectId" IS NOT NULL
    ORDER BY "projectId", "createdAt" DESC
  );

UPDATE "Template" SET "status" = 'SAVED';

-- 5. 外键与索引（Prisma 自动生成，确认在数据修复之后）
ALTER TABLE "Template" ADD CONSTRAINT "Template_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Template_folderId_idx" ON "Template"("folderId");
CREATE UNIQUE INDEX "Template_projectId_key" ON "Template"("projectId");
```

- [ ] **Step 4: 应用迁移并重新生成 client**

```bash
cd apps/api && npx prisma migrate dev && npx prisma generate
```

预期：迁移成功、无 drift 报错、`@prisma/client` 重新生成（`TemplateStatus`、`Folder` 类型可用）。

- [ ] **Step 5: 验证后端既有测试不受影响**

```bash
pnpm --filter @flowweb/api test
```

预期：全部 PASS（schema 变更不影响 mock 单测；若 `template.service.spec.ts` 因 `initOfficialTemplates` 用到 `name_userId` 复合键报错，把该测试中 `prisma.template.upsert` mock 的 `where: { name_userId: ... }` 参数保持原样即可——mock 不校验类型）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): add Folder table and Template folderId/status with migration"
```

---

### Task 2: FolderService（CRUD + 聚合列表 + touch）

**Files:**
- Create: `apps/api/src/modules/folder/folder.service.ts`
- Test: `apps/api/src/modules/folder/folder.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/folder/folder.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { FolderService } from './folder.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('FolderService', () => {
  let service: FolderService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      folder: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'f1', name: '新建', userId: 'u1' }),
        update: vi.fn().mockResolvedValue({ id: 'f1', name: '改名' }),
        delete: vi.fn().mockResolvedValue({ id: 'f1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      template: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn().mockResolvedValue([0, { id: 'f1' }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FolderService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<FolderService>(FolderService);
  });

  it('list 返回聚合 canvasCount 与最近3张缩略图', async () => {
    prisma.folder.findMany.mockResolvedValue([
      {
        id: 'f1', name: '工作', parentId: null,
        createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-18'),
        templates: [
          { id: 't1', coverUrl: 'http://a.png' },
          { id: 't2', coverUrl: null },
        ],
        _count: { templates: 5 },
      },
    ]);
    const result = await service.list('u1');
    expect(prisma.folder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      include: {
        templates: { take: 3, orderBy: { updatedAt: 'desc' }, select: { id: true, coverUrl: true } },
        _count: { select: { templates: true } },
      },
    }));
    expect(result.folders[0].canvasCount).toBe(5);
    expect(result.folders[0].thumbnails).toEqual([
      { id: 't1', coverUrl: 'http://a.png' },
      { id: 't2', coverUrl: null },
    ]);
  });

  it('create 同级重名抛 BadRequest', async () => {
    prisma.folder.findFirst.mockResolvedValue({ id: 'f1', name: '工作' });
    await expect(service.create('工作', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('create 正常创建', async () => {
    const folder = await service.create('新文件夹', 'u1');
    expect(prisma.folder.create).toHaveBeenCalledWith({
      data: { name: '新文件夹', userId: 'u1' },
    });
    expect(folder.id).toBe('f1');
  });

  it('rename 排除自身的重名校验：同名其他文件夹存在才报错', async () => {
    prisma.folder.findFirst.mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve({ id: 'f1', name: '旧名', parentId: null, userId: 'u1' }) : Promise.resolve(null),
    );
    await service.rename('f1', '任何名', 'u1');
    expect(prisma.folder.findFirst).toHaveBeenLastCalledWith({
      where: { userId: 'u1', parentId: null, name: '任何名', id: { not: 'f1' } },
    });
  });

  it('rename 同名其他文件夹存在抛 BadRequest', async () => {
    prisma.folder.findFirst.mockImplementation(({ where }: any) =>
      where.id ? Promise.resolve({ id: 'f1', name: '旧名', parentId: null, userId: 'u1' }) : Promise.resolve({ id: 'f2' }),
    );
    await expect(service.rename('f1', '重名', 'u1')).rejects.toThrow(BadRequestException);
  });

  it('rename 非本人文件夹抛 NotFound', async () => {
    prisma.folder.findFirst.mockResolvedValue(null);
    await expect(service.rename('fx', '名', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('remove 在同事务内 count + delete，返回 movedCanvasCount', async () => {
    prisma.folder.findFirst.mockResolvedValue({ id: 'f1', userId: 'u1' });
    prisma.$transaction.mockResolvedValue([3, { id: 'f1' }]);
    const result = await service.remove('f1', 'u1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result).toEqual({ movedCanvasCount: 3 });
  });

  it('touch 显式更新 updatedAt（updateMany 不触发 @updatedAt）', async () => {
    await service.touch(['f1', 'f2', null]);
    expect(prisma.folder.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['f1', 'f2'] } },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('touch 空数组不发起查询', async () => {
    await service.touch([null]);
    expect(prisma.folder.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- folder.service
```

预期：FAIL（找不到 `./folder.service` 模块）。

- [ ] **Step 3: 实现 FolderService**

```typescript
// apps/api/src/modules/folder/folder.service.ts
import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FolderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const folders = await this.prisma.folder.findMany({
      where: { userId },
      include: {
        templates: { take: 3, orderBy: { updatedAt: 'desc' }, select: { id: true, coverUrl: true } },
        _count: { select: { templates: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        canvasCount: f._count.templates,
        thumbnails: f.templates.map((t) => ({ id: t.id, coverUrl: t.coverUrl })),
      })),
    };
  }

  async create(name: string, userId: string) {
    const duplicate = await this.prisma.folder.findFirst({ where: { userId, parentId: null, name } });
    if (duplicate) throw new BadRequestException('已存在同名文件夹');
    return this.prisma.folder.create({ data: { name, userId } });
  }

  async rename(id: string, name: string, userId: string) {
    const folder = await this.findById(id, userId);
    const duplicate = await this.prisma.folder.findFirst({
      where: { userId, parentId: folder.parentId, name, id: { not: id } },
    });
    if (duplicate) throw new BadRequestException('已存在同名文件夹');
    return this.prisma.folder.update({ where: { id }, data: { name } });
  }

  async remove(id: string, userId: string) {
    await this.findById(id, userId);
    const [count] = await this.prisma.$transaction([
      this.prisma.template.count({ where: { folderId: id } }),
      this.prisma.folder.delete({ where: { id } }),
    ]);
    return { movedCanvasCount: count };
  }

  async touch(ids: Array<string | null | undefined>) {
    const valid = ids.filter((v): v is string => !!v);
    if (valid.length === 0) return;
    // updateMany 不触发 @updatedAt，必须显式赋值
    await this.prisma.folder.updateMany({
      where: { id: { in: valid } },
      data: { updatedAt: new Date() },
    });
  }

  private async findById(id: string, userId: string) {
    const folder = await this.prisma.folder.findFirst({ where: { id, userId } });
    if (!folder) throw new NotFoundException('文件夹不存在');
    return folder;
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
pnpm --filter @flowweb/api test -- folder.service
```

预期：PASS（9 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/folder
git commit -m "feat(api): add FolderService with aggregated list, CRUD and touch"
```

---

### Task 3: FolderController + FolderModule + 模块注册

**Files:**
- Create: `apps/api/src/modules/folder/dto/create-folder.dto.ts`
- Create: `apps/api/src/modules/folder/dto/update-folder.dto.ts`
- Create: `apps/api/src/modules/folder/folder.controller.ts`
- Create: `apps/api/src/modules/folder/folder.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/folder/folder.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/folder/folder.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

describe('FolderController', () => {
  let controller: FolderController;
  let service: any;
  const req = (id?: string) => ({ user: id ? { id } : undefined });

  beforeEach(async () => {
    service = {
      list: vi.fn().mockResolvedValue({ folders: [] }),
      create: vi.fn().mockResolvedValue({ id: 'f1', name: 'n' }),
      rename: vi.fn().mockResolvedValue({ id: 'f1', name: 'n2' }),
      remove: vi.fn().mockResolvedValue({ movedCanvasCount: 2 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FolderController],
      providers: [{ provide: FolderService, useValue: service }],
    }).compile();
    controller = module.get<FolderController>(FolderController);
  });

  it('GET 未登录抛 Unauthorized', async () => {
    await expect(controller.list(req() as any)).rejects.toThrow(UnauthorizedException);
  });

  it('GET 登录返回列表', async () => {
    const result = await controller.list(req('u1') as any);
    expect(service.list).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ folders: [] });
  });

  it('POST 校验并创建', async () => {
    const result = await controller.create({ name: '工作' }, req('u1') as any);
    expect(service.create).toHaveBeenCalledWith('工作', 'u1');
    expect(result).toEqual({ id: 'f1', name: 'n' });
  });

  it('PATCH 重命名', async () => {
    await controller.rename('f1', { name: '新名' }, req('u1') as any);
    expect(service.rename).toHaveBeenCalledWith('f1', '新名', 'u1');
  });

  it('DELETE 返回 movedCanvasCount', async () => {
    const result = await controller.remove('f1', req('u1') as any);
    expect(service.remove).toHaveBeenCalledWith('f1', 'u1');
    expect(result).toEqual({ movedCanvasCount: 2 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- folder.controller
```

预期：FAIL（找不到模块）。

- [ ] **Step 3: 实现 DTO、Controller、Module 并注册**

```typescript
// apps/api/src/modules/folder/dto/create-folder.dto.ts
import { IsString, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString() @Length(1, 255) name!: string;
}
```

```typescript
// apps/api/src/modules/folder/dto/update-folder.dto.ts
import { IsString, Length } from 'class-validator';

export class UpdateFolderDto {
  @IsString() @Length(1, 255) name!: string;
}
```

```typescript
// apps/api/src/modules/folder/folder.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { FolderService } from './folder.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Controller('api/folders')
export class FolderController {
  constructor(@Inject(FolderService) private readonly folderService: FolderService) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.list(userId);
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(@Body() dto: CreateFolderDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.create(dto.name, userId);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async rename(@Param('id') id: string, @Body() dto: UpdateFolderDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.rename(id, dto.name, userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.remove(id, userId);
  }
}
```

```typescript
// apps/api/src/modules/folder/folder.module.ts
import { Module } from '@nestjs/common';
import { FolderService } from './folder.service';
import { FolderController } from './folder.controller';

@Module({
  controllers: [FolderController],
  providers: [FolderService],
  exports: [FolderService],
})
export class FolderModule {}
```

`apps/api/src/app.module.ts`：imports 数组中 `TemplateModule,` 行后加两行（CanvasModule 在 Task 7 创建，此处先只加 FolderModule）：

```typescript
    FolderModule,
```

并在文件顶部 import：`import { FolderModule } from './modules/folder/folder.module';`

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- folder
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add folder CRUD endpoints GET/POST/PATCH/DELETE /api/folders"
```

---

### Task 4: TemplateService.update 支持 folderId 移动

**Files:**
- Modify: `apps/api/src/modules/template/dto/update-template.dto.ts`
- Modify: `apps/api/src/modules/template/template.service.ts`（update 方法，现约 168-182 行）
- Modify: `apps/api/src/modules/template/template.module.ts`（imports FolderModule）
- Test: `apps/api/src/modules/template/template.service.spec.ts`（追加用例）

- [ ] **Step 1: 追加失败测试（template.service.spec.ts 的 describe 内，需在现有 mock prisma 中补 `folder` delegate：`folder: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() }`，并给 TestingModule providers 加 `{ provide: FolderService, useValue: { touch: vi.fn() } }`，import FolderService）**

```typescript
  describe('update folderId 移动', () => {
    it('folderId 变化时校验目标文件夹归属并 touch 源与目标', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.folder.findFirst.mockResolvedValue({ id: 'f2', userId: 'u1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: 'f2' });
      await service.update('t1', { folderId: 'f2' } as any, 'u1');
      expect(prisma.folder.findFirst).toHaveBeenCalledWith({ where: { id: 'f2', userId: 'u1' } });
      expect(folderService.touch).toHaveBeenCalledWith(['f1', 'f2']);
    });

    it('目标文件夹非本人抛 BadRequest', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: null });
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', { folderId: 'fx' } as any, 'u1')).rejects.toThrow(BadRequestException);
    });

    it('folderId 传 null 移到根目录，touch 源文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1', folderId: null });
      await service.update('t1', { folderId: null } as any, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { folderId: null },
      });
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('改名时 touch 所在文件夹；isPublic 切换不 touch', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1' });
      prisma.template.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', { name: '新名' } as any, 'u1');
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
      (folderService.touch as any).mockClear();
      await service.update('t1', { isPublic: true } as any, 'u1');
      expect(folderService.touch).not.toHaveBeenCalled();
    });
  });
```

（`folderService` 变量：`let folderService: { touch: ReturnType<typeof vi.fn> };` 在 beforeEach 中赋值，从 module.get(FolderService) 取。）

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- template.service
```

预期：新用例 FAIL（UpdateTemplateInput 无 folderId / touch 未调用），既有用例仍 PASS。

- [ ] **Step 3: 实现**

`update-template.dto.ts` 全文替换为：

```typescript
import { IsString, IsOptional, IsBoolean, Length, ValidateIf, IsNotEmpty } from 'class-validator';

export class UpdateTemplateDto {
  @IsOptional() @IsString() @Length(1, 255) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @IsNotEmpty() folderId?: string | null;
}
```

`template.service.ts`：import 加 `FolderService`（`import { FolderService } from '../folder/folder.service';`）；constructor 注入 `@Inject(FolderService) private readonly folderService: FolderService`；`UpdateTemplateInput` 接口加 `folderId?: string | null;`；`update` 方法整体替换为：

```typescript
  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      throw new ForbiddenException('无权编辑此模板');
    }
    this.clearCache();
    const data: any = {};
    const touchIds = new Set<string>();

    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isPublic !== undefined) {
      data.isPublic = input.isPublic;
      data.category = input.isPublic ? 'COMMUNITY' : undefined;
    }
    if (input.folderId !== undefined) {
      if (input.folderId !== null) {
        const folder = await this.prisma.folder.findFirst({ where: { id: input.folderId, userId } });
        if (!folder) throw new BadRequestException('目标文件夹不存在');
      }
      data.folderId = input.folderId;
      if (input.folderId !== template.folderId) {
        if (template.folderId) touchIds.add(template.folderId);
        if (input.folderId) touchIds.add(input.folderId);
      }
    }
    if (input.name !== undefined && template.folderId) touchIds.add(template.folderId);

    const updated = await this.prisma.template.update({ where: { id }, data });
    if (touchIds.size > 0) await this.folderService.touch([...touchIds]);
    return updated;
  }
```

`template.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';
import { ProjectModule } from '../project/project.module';
import { FolderModule } from '../folder/folder.module';

@Module({
  imports: [ProjectModule, FolderModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
```

同时把 `template.service.ts` 的 `private clearCache()` 改为 `clearCache()`（CanvasService 在 Task 7/8 要调用）。

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- template
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/template
git commit -m "feat(api): support folderId move in template update with folder touch"
```

---

### Task 5: TemplateService.delete 级联删除关联工程

**Files:**
- Modify: `apps/api/src/modules/template/template.service.ts`（delete 方法，现约 184-190 行）
- Test: `apps/api/src/modules/template/template.service.spec.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**

```typescript
  describe('delete 级联删除工程', () => {
    it('同事务删除 Template 与关联 CanvasProject，并 touch 文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: 'f1', projectId: 'p1' });
      prisma.$transaction.mockResolvedValue([{}, {}]);
      await service.delete('t1', 'u1');
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(2);
      await expect(ops[0]).resolves.toBeUndefined(); // template.delete mock
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('无关联工程时不删工程', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't1', userId: 'u1', folderId: null, projectId: null });
      prisma.$transaction.mockResolvedValue([{}]);
      await service.delete('t1', 'u1');
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1);
    });
  });
```

注意：现有 spec 的 prisma mock 无 `$transaction`，需在 beforeEach 的 prisma 对象加 `$transaction: vi.fn((ops: any[]) => Promise.resolve(ops.map(() => ({}))))`。

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- template.service
```

预期：新用例 FAIL（现 delete 不删工程、不 touch、不用事务）。

- [ ] **Step 3: 实现（delete 方法替换）**

```typescript
  async delete(id: string, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      throw new ForbiddenException('无权删除此模板');
    }
    this.clearCache();
    // 先删 Template 解除 projectId FK，再删工程（nodes/edges 由 DB 级联 Cascade 清理）
    await this.prisma.$transaction([
      this.prisma.template.delete({ where: { id } }),
      ...(template.projectId
        ? [this.prisma.canvasProject.delete({ where: { id: template.projectId } })]
        : []),
    ]);
    if (template.folderId) await this.folderService.touch([template.folderId]);
    return null;
  }
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- template
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/template
git commit -m "feat(api): cascade delete linked project and touch folder on template delete"
```

---

### Task 6: 模板列表 folderId 过滤（仅 type=my）

**Files:**
- Modify: `apps/api/src/modules/template/dto/template-list-query.dto.ts`
- Modify: `apps/api/src/modules/template/template.service.ts`（findMany 方法）
- Test: `apps/api/src/modules/template/template.service.spec.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**

```typescript
  describe('findMany folderId 过滤', () => {
    it('type=my + folderId=root 过滤 folderId=null', async () => {
      prisma.template.findMany.mockResolvedValue([]);
      await service.findMany({ type: 'my', folderId: 'root' } as any, 'u1');
      expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', folderId: null }),
      }));
    });

    it('type=my + 具体 folderId 精确匹配', async () => {
      prisma.template.findMany.mockResolvedValue([]);
      await service.findMany({ type: 'my', folderId: 'f1' } as any, 'u1');
      expect(prisma.template.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ folderId: 'f1' }),
      }));
    });

    it('非 type=my 时 folderId 被忽略', async () => {
      prisma.template.findMany.mockResolvedValue([]);
      await service.findMany({ type: 'community', folderId: 'f1' } as any, 'u1');
      const where = prisma.template.findMany.mock.calls[0][0].where;
      expect(where.folderId).toBeUndefined();
    });
  });
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- template.service
```

预期：新用例 FAIL（findMany 不识别 folderId；另需在 mock 初始化后清缓存——若缓存干扰断言，在用例开头调用 `(service as any).cache.clear()`）。

- [ ] **Step 3: 实现**

`template-list-query.dto.ts` 追加字段：

```typescript
  @IsOptional() @IsString() folderId?: string;
```

（文件顶部 import 已有 `IsString`。）

`template.service.ts`：`TemplateListQuery` 接口加 `folderId?: string;`；`findMany` 中 `if (query.search)` 块之前插入：

```typescript
    if (query.type === 'my' && query.folderId) {
      where.folderId = query.folderId === 'root' ? null : query.folderId;
    }
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- template
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/template
git commit -m "feat(api): filter template list by folderId for type=my"
```

---

### Task 7: CanvasService.create + POST /api/canvases

**Files:**
- Create: `apps/api/src/modules/canvas/canvas.service.ts`
- Create: `apps/api/src/modules/canvas/canvas.controller.ts`
- Create: `apps/api/src/modules/canvas/canvas.module.ts`
- Create: `apps/api/src/modules/canvas/dto/create-canvas.dto.ts`
- Modify: `apps/api/src/app.module.ts`（注册 CanvasModule）
- Test: `apps/api/src/modules/canvas/canvas.service.spec.ts`

**说明：** spec §4.2 说"复用 ProjectService.create"，但事务内必须用事务客户端 `tx`（ProjectService.create 用的是非事务 prisma 实例），故此处直接 `tx.canvasProject.create`，数据形状与 `ProjectService.create` 完全对齐（name/userId/viewport 默认值）——原子性优先，是对 spec 的有意小偏离。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/modules/canvas/canvas.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CanvasService } from './canvas.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

describe('CanvasService', () => {
  let service: CanvasService;
  let prisma: any;
  let projectService: any;
  let folderService: any;
  let templateService: any;

  beforeEach(async () => {
    prisma = {
      folder: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(),
    };
    projectService = {};
    folderService = { touch: vi.fn() };
    templateService = { clearCache: vi.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanvasService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: FolderService, useValue: folderService },
        { provide: TemplateService, useValue: templateService },
      ],
    }).compile();
    service = module.get<CanvasService>(CanvasService);
  });

  describe('create', () => {
    it('事务创建 CanvasProject + DRAFT Template，返回 templateId/projectId', async () => {
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
      }));
      const result = await service.create('新画布', 'f1', 'u1');
      expect(result).toEqual({ templateId: 't1', projectId: 'p1' });
      expect(templateService.clearCache).toHaveBeenCalled();
      expect(folderService.touch).toHaveBeenCalledWith(['f1']);
    });

    it('事务内 Template 数据含 folderId/status DRAFT/isPublic false', async () => {
      const templateCreate = vi.fn().mockResolvedValue({ id: 't1' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn({
        canvasProject: { create: vi.fn().mockResolvedValue({ id: 'p1' }) },
        template: { create: templateCreate },
      }));
      await service.create('新画布', null, 'u1');
      expect(templateCreate).toHaveBeenCalledWith({
        data: {
          name: '新画布', userId: 'u1', projectId: 'p1',
          folderId: null, status: 'DRAFT', isPublic: false,
        },
      });
    });

    it('folderId 非本人文件夹抛 BadRequest', async () => {
      prisma.folder.findFirst.mockResolvedValue(null);
      await expect(service.create('新画布', 'fx', 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- canvas.service
```

预期：FAIL（找不到模块）。

- [ ] **Step 3: 实现**

```typescript
// apps/api/src/modules/canvas/dto/create-canvas.dto.ts
import { IsString, IsOptional, Length, ValidateIf, IsNotEmpty } from 'class-validator';

export class CreateCanvasDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @IsNotEmpty() folderId?: string | null;
}
```

```typescript
// apps/api/src/modules/canvas/canvas.service.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { TemplateService } from '../template/template.service';

@Injectable()
export class CanvasService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
  ) {}

  async create(name: string, folderId: string | null, userId: string) {
    if (folderId) {
      const folder = await this.prisma.folder.findFirst({ where: { id: folderId, userId } });
      if (!folder) throw new BadRequestException('目标文件夹不存在');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.canvasProject.create({
        data: { name, userId, viewport: { x: 0, y: 0, zoom: 1 } },
      });
      const template = await tx.template.create({
        data: { name, userId, projectId: project.id, folderId, status: 'DRAFT', isPublic: false },
      });
      return { templateId: template.id, projectId: project.id };
    });
    this.templateService.clearCache();
    if (folderId) await this.folderService.touch([folderId]);
    return result;
  }
}
```

（`projectService` 注入保留给 Task 8 的 save 使用。）

```typescript
// apps/api/src/modules/canvas/canvas.controller.ts
import { Controller, Post, Param, Body, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { CanvasService } from './canvas.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';

@Controller('api/canvases')
export class CanvasController {
  constructor(@Inject(CanvasService) private readonly canvasService: CanvasService) {}

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(@Body() dto: CreateCanvasDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.canvasService.create(dto.name, dto.folderId ?? null, userId);
  }
}
```

```typescript
// apps/api/src/modules/canvas/canvas.module.ts
import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController } from './canvas.controller';
import { ProjectModule } from '../project/project.module';
import { FolderModule } from '../folder/folder.module';
import { TemplateModule } from '../template/template.module';

@Module({
  imports: [ProjectModule, FolderModule, TemplateModule],
  controllers: [CanvasController],
  providers: [CanvasService],
})
export class CanvasModule {}
```

`app.module.ts`：`FolderModule,` 行后加 `CanvasModule,`，顶部 import `import { CanvasModule } from './modules/canvas/canvas.module';`。

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- canvas
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): add POST /api/canvases creating project+template transactionally"
```

---

### Task 8: CanvasService.save（upsert by projectId + P2002 回退）

**Files:**
- Modify: `apps/api/src/modules/canvas/canvas.service.ts`
- Create: `apps/api/src/modules/canvas/dto/save-canvas.dto.ts`
- Modify: `apps/api/src/modules/canvas/canvas.controller.ts`（加 save 端点）
- Test: `apps/api/src/modules/canvas/canvas.service.spec.ts`（追加用例）

- [ ] **Step 1: 追加失败测试（canvas.service.spec.ts）**

```typescript
  describe('save', () => {
    const project = {
      id: 'p1', userId: 'u1',
      nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n1' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    beforeEach(() => {
      projectService.findById = vi.fn().mockResolvedValue(project);
      prisma.template = {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 't1', status: 'SAVED' }),
        update: vi.fn().mockResolvedValue({ id: 't2', status: 'SAVED' }),
      };
    });

    it('无关联 Template 时创建，status=SAVED，规范化 edges 的 sourceId/targetId', async () => {
      const result = await service.save('p1', { name: '名', description: 'd', isPublic: false }, 'u1');
      expect(prisma.template.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: '名', description: 'd', isPublic: false, status: 'SAVED',
          projectId: 'p1', userId: 'u1',
          templateData: {
            nodes: [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
            edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
            viewport: { x: 0, y: 0, zoom: 1 },
          },
        }),
      });
      expect(result.id).toBe('t1');
      expect(templateService.clearCache).toHaveBeenCalled();
    });

    it('有关联 Template 时更新且不 touch 文件夹', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', folderId: 'f1', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ name: '名', status: 'SAVED' }),
      });
      expect(prisma.template.create).not.toHaveBeenCalled();
      expect(folderService.touch).not.toHaveBeenCalled();
    });

    it('update 保留未传的 isPublic', async () => {
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: true });
      await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalledWith({
        where: { id: 't2' },
        data: expect.objectContaining({ isPublic: true }),
      });
    });

    it('非本人工程抛 Forbidden', async () => {
      projectService.findById.mockResolvedValue({ ...project, userId: 'other' });
      await expect(service.save('p1', { name: '名' }, 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('并发首存 P2002 回退为 update', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      prisma.template.create.mockRejectedValueOnce(p2002);
      prisma.template.findUnique.mockResolvedValue({ id: 't2', isPublic: false });
      const result = await service.save('p1', { name: '名' }, 'u1');
      expect(prisma.template.update).toHaveBeenCalled();
      expect(result.id).toBe('t2');
    });
  });
```

（import 加 `ForbiddenException`。）

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- canvas.service
```

预期：新用例 FAIL（save 方法不存在）。

- [ ] **Step 3: 实现**

```typescript
// apps/api/src/modules/canvas/dto/save-canvas.dto.ts
import { IsString, IsOptional, IsBoolean, Length } from 'class-validator';

export class SaveCanvasDto {
  @IsString() @Length(1, 255) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
}
```

`canvas.service.ts`：import 补 `ForbiddenException, BadRequestException`（BadRequest 已有则不重复）与 `validateTemplateData`（`import { validateTemplateData } from '../template/template.validation';`），类内追加：

```typescript
  async save(projectId: string, input: { name: string; description?: string; isPublic?: boolean }, userId: string) {
    const project = await this.projectService.findById(projectId);
    if (project.userId !== null && project.userId !== userId) {
      throw new ForbiddenException('无权保存此工程');
    }

    const nodes = (project.nodes || []).map((n: any) => ({
      id: n.id, type: n.type, position: n.position, data: n.data,
    }));
    const edges = (project.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sourceId || e.source || '',
      target: e.targetId || e.target || '',
    }));
    const templateData = { nodes, edges, viewport: project.viewport };

    try {
      validateTemplateData(templateData);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '画布数据验证失败';
      throw new BadRequestException(message);
    }

    const existing = await this.prisma.template.findUnique({ where: { projectId } });
    this.templateService.clearCache();

    if (existing) {
      return this.prisma.template.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          description: input.description,
          isPublic: input.isPublic ?? existing.isPublic,
          templateData,
          status: 'SAVED',
          category: input.isPublic ? 'COMMUNITY' : undefined,
        },
      });
    }

    try {
      return await this.prisma.template.create({
        data: {
          name: input.name,
          description: input.description,
          isPublic: input.isPublic ?? false,
          projectId,
          userId,
          templateData,
          status: 'SAVED',
          category: input.isPublic ? 'COMMUNITY' : undefined,
        },
      });
    } catch (e: any) {
      // 并发首存：另一请求已创建，回退为更新
      if (e?.code === 'P2002') {
        const raced = await this.prisma.template.findUnique({ where: { projectId } });
        if (raced) {
          return this.prisma.template.update({
            where: { id: raced.id },
            data: {
              name: input.name,
              description: input.description,
              isPublic: input.isPublic ?? raced.isPublic,
              templateData,
              status: 'SAVED',
              category: input.isPublic ? 'COMMUNITY' : undefined,
            },
          });
        }
      }
      throw e;
    }
  }
```

`canvas.controller.ts` 追加 save 端点（注意 `@Controller('api/projects')` 是第二个 controller 类，加在文件末尾并 export）：

```typescript
import { Controller as NestController } from '@nestjs/common'; // 如需避免命名冲突可省略，直接同文件两个类

@Controller('api/projects')
export class CanvasSaveController {
  constructor(@Inject(CanvasService) private readonly canvasService: CanvasService) {}

  @Post(':id/save')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async save(@Param('id') id: string, @Body() dto: SaveCanvasDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.canvasService.save(id, dto, userId);
  }
}
```

（import 补 `SaveCanvasDto`；`canvas.module.ts` 的 controllers 改为 `[CanvasController, CanvasSaveController]`。）

- [ ] **Step 4: 运行确认通过 + 全量回归**

```bash
pnpm --filter @flowweb/api test -- canvas
pnpm --filter @flowweb/api test
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/canvas
git commit -m "feat(api): add POST /api/projects/:id/save upserting template by projectId"
```

---

### Task 9: 移除旧 POST /api/templates 端点

**Files:**
- Modify: `apps/api/src/modules/template/template.controller.ts`（删 create 端点）
- Modify: `apps/api/src/modules/template/template.service.ts`（删 create 方法与 CreateTemplateInput 接口）
- Delete: `apps/api/src/modules/template/dto/create-template.dto.ts`
- Test: `apps/api/src/modules/template/template.controller.spec.ts`、`template.service.spec.ts`（删对应用例与 mock 字段）

- [ ] **Step 1: 先删测试（红）——删除以下内容**

`template.controller.spec.ts`：service mock 中删 `create: vi.fn()...` 行；删除"create 端点"相关用例（如 `it('create ...')`）；import 清理。
`template.service.spec.ts`：删除 `describe('create')` 或所有调用 `service.create` 的用例；`projectService.findById` 的 create 相关 mock 断言用例删除。

- [ ] **Step 2: 运行确认剩余测试仍绿**

```bash
pnpm --filter @flowweb/api test -- template
```

预期：PASS（测试先删，此时实现还在——这是删除类重构，测试先行删除后实现删除前必须保持绿）。

- [ ] **Step 3: 删除实现**

- `template.controller.ts`：删 `@Post() create` 整个方法、`CreateTemplateDto` import。
- `template.service.ts`：删 `async create(...)` 整个方法、`CreateTemplateInput` 接口。
- 删除文件 `dto/create-template.dto.ts`。

- [ ] **Step 4: 运行全量 + lint**

```bash
pnpm --filter @flowweb/api test && pnpm --filter @flowweb/api lint
```

预期：PASS / 无错误。

- [ ] **Step 5: Commit**

```bash
git add -A apps/api/src/modules/template
git commit -m "refactor(api): remove legacy POST /api/templates superseded by save endpoint"
```

---

### Task 10: 草稿清理 DELETE /api/projects/drafts

**Files:**
- Modify: `apps/api/src/modules/project/project.service.ts`（加 cleanDrafts）
- Modify: `apps/api/src/modules/project/project.controller.ts`（加端点，**必须放在 `@Delete(':id')` 之前**，NestJS 按声明顺序匹配路由）
- Test: `apps/api/src/modules/project/project.service.spec.ts`（如不存在则新建）

- [ ] **Step 1: 写失败测试（若 project.service.spec.ts 不存在则创建，头部参照 template.service.spec.ts 的 mock 模式）**

```typescript
  describe('cleanDrafts', () => {
    it('删除无 Template 关联且 24h 未更新的本人工程', async () => {
      prisma.canvasProject.deleteMany.mockResolvedValue({ count: 4 });
      const result = await service.cleanDrafts('u1');
      expect(prisma.canvasProject.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          updatedAt: { lt: expect.any(Date) },
          templates: { none: {} },
        },
      });
      expect(result).toEqual({ deletedCount: 4 });
    });
  });
```

（mock 需含 `canvasProject.deleteMany`。）

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/api test -- project.service
```

预期：FAIL（cleanDrafts 不存在）。

- [ ] **Step 3: 实现**

`project.service.ts` 追加：

```typescript
  async cleanDrafts(userId: string) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await this.prisma.canvasProject.deleteMany({
      where: {
        userId,
        updatedAt: { lt: cutoff },
        templates: { none: {} },
      },
    });
    return { deletedCount: result.count };
  }
```

`project.controller.ts`：import 补 `Delete, Req, UnauthorizedException`（按需）与 `Request` 类型；**在 `@Delete(':id')` 方法之前**插入：

```typescript
  @Delete('drafts')
  cleanDrafts(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.projectService.cleanDrafts(userId);
  }
```

- [ ] **Step 4: 运行确认通过 + 后端全量回归**

```bash
pnpm --filter @flowweb/api test -- project
pnpm --filter @flowweb/api test
```

预期：全部 PASS。**后端阶段到此完成。**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/project
git commit -m "feat(api): add DELETE /api/projects/drafts for orphan project cleanup"
```

---

### Task 11: 前端 API 客户端 + useWorkspaceData 改造（直连 + 分页 + 真实入列）

**Files:**
- Create: `apps/web/src/api/folderApi.ts`
- Create: `apps/web/src/api/canvasApi.ts`
- Modify: `apps/web/src/api/templateApi.ts`（getTemplates 加 folderId；**暂不动 createTemplate**——Task 13 处理，避免中间态编译错）
- Modify: `apps/web/src/pages/workspace/types.ts`
- Delete: `apps/web/src/pages/workspace/fixtures.ts`（含 fixtures.test.ts）
- Modify: `apps/web/src/pages/workspace/hooks/useWorkspaceData.ts`（重写）
- Test: `apps/web/src/pages/workspace/__tests__/useWorkspaceData.test.tsx`（重写）

- [ ] **Step 1: 更新 types.ts**

全文替换为（Folder 删 workspaceId；Canvas 删 isPlaceholder）：

```typescript
export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderViewModel extends Folder {
  canvasCount: number;
  thumbnails: string[];
}

export interface Canvas {
  id: string;
  name: string;
  coverUrl: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  folderId: string | null;
}

export type WorkspaceItem =
  | { type: 'folder'; data: FolderViewModel }
  | { type: 'canvas'; data: Canvas };

export type ViewMode = 'grid' | 'list';
export type FilterKind = 'all' | 'folders' | 'canvases';
```

- [ ] **Step 2: 重写失败测试（useWorkspaceData.test.tsx 全文替换）**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/api/folderApi', () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/api/canvasApi', () => ({
  createCanvas: vi.fn(),
}));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { getFolders, createFolder as apiCreateFolder, renameFolder as apiRenameFolder, deleteFolder as apiDeleteFolder } from '@/api/folderApi';
import { createCanvas as apiCreateCanvas } from '@/api/canvasApi';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';

const tpl = (id: string, name: string, updatedAt: string, folderId: string | null = null) => ({
  id, name, description: '', coverUrl: null, isPublic: false, folderId,
  status: 'SAVED', createdAt: updatedAt, updatedAt, importCount: 0,
});
const folderDto = (id: string, name: string, count = 0) => ({
  id, name, parentId: null,
  createdAt: '2026-08-17T10:00:00', updatedAt: '2026-08-18T10:00:00',
  canvasCount: count, thumbnails: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({
    folders: [folderDto('f1', '工作', 2), folderDto('f2', '项目', 0)],
  } as never);
  vi.mocked(getTemplates).mockResolvedValue({
    templates: [], total: 0, page: 1, limit: 20, totalPages: 0,
  } as never);
  vi.mocked(updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(deleteTemplate).mockResolvedValue(undefined as never);
});

describe('useWorkspaceData', () => {
  it('初始加载：根目录画布 + 文件夹 ViewModel（缩略图渐变）', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00', null)],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    vi.mocked(getFolders).mockResolvedValue({
      folders: [folderDto('f1', '工作', 1)],
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(getTemplates).toHaveBeenCalledWith(expect.objectContaining({ folderId: 'root', page: 1 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1']);
    expect(result.current.folders[0].canvasCount).toBe(1);
    expect(typeof result.current.folders[0].thumbnails[0]).toBe('string');
  });

  it('加载失败 → status=error，可重试', async () => {
    vi.mocked(getFolders).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.status).toBe('success');
  });

  it('loadFolder 切换文件夹并按 folderId 请求画布', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c2', '画布 2', '2026-08-18T09:00:00', 'f1')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.loadFolder('f1'); });
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ folderId: 'f1', page: 1 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c2']);
  });

  it('loadMore 追加下一页，无更多时 hasMore=false', async () => {
    vi.mocked(getTemplates)
      .mockResolvedValueOnce({ templates: [tpl('c1', 'a', '2026-08-18T10:00:00')], total: 25, page: 1, limit: 20, totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [tpl('c21', 'b', '2026-08-18T09:00:00')], total: 25, page: 2, limit: 20, totalPages: 2 } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(getTemplates).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(result.current.canvases.map((c) => c.id)).toEqual(['c1', 'c21']);
    expect(result.current.hasMore).toBe(false);
  });

  it('createCanvas 真实入列（无占位）并返回 projectId', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiCreateCanvas).mockResolvedValue({ templateId: 't9', projectId: 'p9' } as never);
    let projectId: string | undefined;
    await act(async () => { projectId = await result.current.createCanvas('新作品', 'f1'); });
    expect(projectId).toBe('p9');
    const created = result.current.canvases.find((c) => c.id === 't9');
    expect(created).toBeDefined();
    expect(created?.folderId).toBe('f1');
    expect(created?.isPlaceholder).toBeUndefined();
  });

  it('createFolder 直连 API 并刷新列表', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiCreateFolder).mockResolvedValue(folderDto('f9', '新建') as never);
    await act(async () => { await result.current.createFolder('新建'); });
    expect(apiCreateFolder).toHaveBeenCalledWith('新建');
  });

  it('renameFolder 乐观更新失败回滚', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiRenameFolder).mockRejectedValueOnce(new Error('x'));
    await act(async () => { await result.current.renameFolder('f1', '改名'); });
    expect(result.current.folders.find((f) => f.id === 'f1')?.name).toBe('工作');
  });

  it('deleteFolder 成功返回 movedCanvasCount 并刷新', async () => {
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(apiDeleteFolder).mockResolvedValue({ movedCanvasCount: 3 } as never);
    let count = -1;
    await act(async () => { count = await result.current.deleteFolder('f1'); });
    expect(count).toBe(3);
    expect(apiDeleteFolder).toHaveBeenCalledWith('f1');
  });

  it('moveCanvas 乐观更新 folderId，调 updateTemplate', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00', 'f1')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    await act(async () => { await result.current.moveCanvas('c1', null); });
    expect(updateTemplate).toHaveBeenCalledWith('c1', { folderId: null });
    expect(result.current.canvases.find((c) => c.id === 'c1')?.folderId).toBeNull();
  });

  it('renameCanvas / deleteCanvas 走 API，失败回滚', async () => {
    vi.mocked(getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布 1', '2026-08-18T10:00:00')],
      total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    const { result } = renderHook(() => useWorkspaceData());
    await waitFor(() => expect(result.current.status).toBe('success'));
    vi.mocked(updateTemplate).mockRejectedValueOnce(new Error('x'));
    await act(async () => { await result.current.renameCanvas('c1', '新名'); }).catch(() => {});
    expect(result.current.canvases.find((c) => c.id === 'c1')?.name).toBe('画布 1');
    vi.mocked(deleteTemplate).mockRejectedValueOnce(new Error('x'));
    await act(async () => { await result.current.deleteCanvas('c1'); }).catch(() => {});
    expect(result.current.canvases.find((c) => c.id === 'c1')).toBeDefined();
  });
});
```

- [ ] **Step 3: 运行确认失败**

```bash
pnpm --filter @flowweb/web test -- useWorkspaceData
```

预期：FAIL（`@/api/folderApi`、`@/api/canvasApi` 模块不存在，loadFolder/loadMore 不存在）。

- [ ] **Step 4: 实现 API 客户端与 hook 重写**

```typescript
// apps/web/src/api/folderApi.ts
import { apiFetch } from './client';

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  canvasCount: number;
  thumbnails: Array<{ id: string; coverUrl: string | null }>;
}

export function getFolders() {
  return apiFetch<{ folders: FolderDto[] }>('/folders');
}

export function createFolder(name: string) {
  return apiFetch<{ id: string }>('/folders', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameFolder(id: string, name: string) {
  return apiFetch<{ id: string }>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function deleteFolder(id: string) {
  return apiFetch<{ movedCanvasCount: number }>(`/folders/${id}`, { method: 'DELETE' });
}
```

```typescript
// apps/web/src/api/canvasApi.ts
import { apiFetch } from './client';

export interface CreateCanvasResult {
  templateId: string;
  projectId: string;
}

export function createCanvas(name: string, folderId: string | null) {
  return apiFetch<CreateCanvasResult>('/canvases', {
    method: 'POST',
    body: JSON.stringify({ name, folderId }),
  });
}

export function saveCanvas(projectId: string, payload: { name: string; description?: string; isPublic?: boolean }) {
  return apiFetch(`/projects/${projectId}/save`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
```

`templateApi.ts`：`TemplateListQuery` 接口加 `folderId?: string;`；`getTemplates` 中参数序列化加：

```typescript
  if (query.folderId) params.set('folderId', query.folderId);
```

`UpdateTemplateDto` 接口加 `folderId?: string | null;`。

`useWorkspaceData.ts` 全文替换：

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { getTemplates, updateTemplate, deleteTemplate } from '@/api/templateApi';
import { getFolders, createFolder as apiCreateFolder, renameFolder as apiRenameFolder, deleteFolder as apiDeleteFolder } from '@/api/folderApi';
import { createCanvas as apiCreateCanvas } from '@/api/canvasApi';
import type { Canvas, FolderViewModel } from '../types';
import { getCanvasGradient } from '../utils/gradient';

const PAGE_SIZE = 20;

function toCanvas(t: any): Canvas {
  return {
    id: t.id, name: t.name, coverUrl: t.coverUrl ?? null, isPublic: !!t.isPublic,
    createdAt: t.createdAt, updatedAt: t.updatedAt, folderId: t.folderId ?? null,
  };
}

export function useWorkspaceData() {
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [folders, setFolders] = useState<FolderViewModel[]>([]);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const currentRef = useRef<string | null>(null);
  const pageRef = useRef(1);

  const refreshFolders = useCallback(async () => {
    const data = await getFolders();
    setFolders(data.folders.map((f) => ({
      id: f.id, name: f.name, parentId: f.parentId,
      createdAt: f.createdAt, updatedAt: f.updatedAt,
      canvasCount: f.canvasCount,
      thumbnails: f.thumbnails.map((t) => (t.coverUrl ? `url("${t.coverUrl}")` : getCanvasGradient(t.id))),
    })));
  }, []);

  const loadFolder = useCallback(async (folderId: string | null) => {
    currentRef.current = folderId;
    pageRef.current = 1;
    setPage(1);
    setStatus('loading');
    try {
      const [, data] = await Promise.all([
        refreshFolders(),
        getTemplates({ type: 'my', folderId: folderId ?? 'root', page: 1, limit: PAGE_SIZE }),
      ]);
      setCanvases((data.templates ?? []).map(toCanvas));
      setHasMore(1 < (data.totalPages ?? 1));
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }, [refreshFolders]);

  useEffect(() => { loadFolder(null); }, [loadFolder]);

  const reload = useCallback(() => loadFolder(currentRef.current), [loadFolder]);

  const loadMore = useCallback(async () => {
    const next = pageRef.current + 1;
    const folderId = currentRef.current;
    try {
      const data = await getTemplates({ type: 'my', folderId: folderId ?? 'root', page: next, limit: PAGE_SIZE });
      setCanvases((prev) => [...prev, ...(data.templates ?? []).map(toCanvas)]);
      pageRef.current = next;
      setPage(next);
      setHasMore(next < (data.totalPages ?? 1));
    } catch {
      message.error('加载失败，请重试');
    }
  }, []);

  const createFolder = useCallback(async (name: string) => {
    await apiCreateFolder(name);
    await refreshFolders();
  }, [refreshFolders]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const prev = folders;
    const now = new Date().toISOString();
    setFolders((fs) => fs.map((f) => (f.id === id ? { ...f, name, updatedAt: now } : f)));
    try {
      await apiRenameFolder(id, name);
    } catch {
      setFolders(prev);
      message.error('重命名失败，请重试');
    }
  }, [folders]);

  const deleteFolder = useCallback(async (id: string): Promise<number> => {
    const { movedCanvasCount } = await apiDeleteFolder(id);
    await Promise.all([refreshFolders(), loadFolder(currentRef.current)]);
    return movedCanvasCount;
  }, [refreshFolders, loadFolder]);

  const moveCanvas = useCallback(async (canvasId: string, folderId: string | null) => {
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === canvasId ? { ...c, folderId } : c)));
    try {
      await updateTemplate(canvasId, { folderId });
    } catch {
      setCanvases(prev);
      message.error('移动失败，请重试');
    }
  }, [canvases]);

  const renameCanvas = useCallback(async (id: string, name: string) => {
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, name } : c)));
    try {
      await updateTemplate(id, { name });
    } catch {
      setCanvases(prev);
      message.error('重命名失败，请重试');
    }
  }, [canvases]);

  const togglePublic = useCallback(async (id: string) => {
    const target = canvases.find((c) => c.id === id);
    if (!target) return;
    const prev = canvases;
    setCanvases((cs) => cs.map((c) => (c.id === id ? { ...c, isPublic: !c.isPublic } : c)));
    try {
      await updateTemplate(id, { isPublic: !target.isPublic });
    } catch {
      setCanvases(prev);
      message.error('操作失败，请重试');
    }
  }, [canvases]);

  const deleteCanvas = useCallback(async (id: string) => {
    const prev = canvases;
    setCanvases((cs) => cs.filter((c) => c.id !== id));
    try {
      await deleteTemplate(id);
    } catch {
      setCanvases(prev);
      message.error('删除失败，请重试');
    }
  }, [canvases]);

  const createCanvas = useCallback(async (name: string, folderId: string | null): Promise<string> => {
    const { templateId, projectId } = await apiCreateCanvas(name, folderId);
    const now = new Date().toISOString();
    setCanvases((prev) => [
      { id: templateId, name, coverUrl: null, isPublic: false, createdAt: now, updatedAt: now, folderId },
      ...prev,
    ]);
    await refreshFolders();
    return projectId;
  }, [refreshFolders]);

  return {
    status, reload, folders, canvases, hasMore, page,
    loadFolder, loadMore,
    createFolder, renameFolder, deleteFolder,
    moveCanvas, renameCanvas, togglePublic, deleteCanvas, createCanvas,
  };
}
```

注意：`page` state 仅供测试断言（真实分页游标在 `pageRef`）；currentFolderId 由 `currentRef` 持有。同时**删除文件** `pages/workspace/fixtures.ts` 与 `__tests__/fixtures.test.ts`。

- [ ] **Step 5: 运行确认通过（其他测试文件此时可能编译失败——WorkspacePage/CanvasCard 仍引用旧字段，属预期，下一步任务处理；本步只跑本文件）**

```bash
pnpm --filter @flowweb/web test -- useWorkspaceData
```

预期：本文件 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api apps/web/src/pages/workspace
git commit -m "feat(web): rewrite useWorkspaceData to hit folder/canvas APIs with pagination"
```

---

### Task 12: WorkspacePage + CanvasCard 适配

**Files:**
- Modify: `apps/web/src/pages/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/pages/workspace/components/CanvasCard.tsx`
- Test: `apps/web/src/pages/workspace/__tests__/WorkspacePage.test.tsx`（重写）
- Test: `apps/web/src/pages/workspace/__tests__/CanvasCard.test.tsx`（删 isPlaceholder 用例）

- [ ] **Step 1: 重写 WorkspacePage.test.tsx（红）**

mock 部分替换为：

```typescript
vi.mock('@/pages/home/components/Navbar', () => ({ Navbar: () => <div data-testid="navbar" /> }));
vi.mock('@/api/folderApi', () => ({
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  renameFolder: vi.fn(),
  deleteFolder: vi.fn(),
}));
vi.mock('@/api/canvasApi', () => ({ createCanvas: vi.fn(), saveCanvas: vi.fn() }));
vi.mock('@/api/templateApi', () => ({
  getTemplates: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return { ...actual, useNavigate: vi.fn() };
});

import * as folderApi from '@/api/folderApi';
import * as canvasApi from '@/api/canvasApi';
import * as templateApi from '@/api/templateApi';
import { useNavigate } from 'react-router';
import { WorkspacePage } from '../WorkspacePage';
```

beforeEach mock 数据：

```typescript
const navigate = vi.fn();
const tpl = (id: string, name: string, folderId: string | null = null) => ({
  id, name, description: '', coverUrl: null, isPublic: false, folderId,
  status: 'SAVED', createdAt: '2026-08-18T10:00:00', updatedAt: '2026-08-18T10:00:00', importCount: 0,
});
const folderDto = (id: string, name: string, canvasCount = 0) => ({
  id, name, parentId: null, createdAt: '2026-08-17T10:00:00', updatedAt: '2026-08-18T10:00:00',
  canvasCount, thumbnails: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(folderApi.getFolders).mockResolvedValue({
    folders: [folderDto('f1', '工作文件夹', 1), folderDto('f2', '项目文件夹', 0)],
  } as never);
  // 默认返回根目录空列表；具体用例按需 override
  vi.mocked(templateApi.getTemplates).mockResolvedValue({
    templates: [], total: 0, page: 1, limit: 20, totalPages: 0,
  } as never);
  vi.mocked(templateApi.updateTemplate).mockResolvedValue(undefined as never);
  vi.mocked(templateApi.deleteTemplate).mockResolvedValue(undefined as never);
  vi.mocked(useNavigate).mockReturnValue(navigate);
});
```

用例改写（保留原结构，调整断言）：

```typescript
describe('WorkspacePage', () => {
  it('根目录渲染：文件夹卡片 + 无根级画布 + 新建文件夹卡首位', async () => {
    renderPage();
    expect(await screen.findByTestId('folder-card-f1')).toBeInTheDocument();
    expect(screen.getByTestId('folder-card-f2')).toBeInTheDocument();
    expect(screen.queryByTestId('canvas-card-c1')).not.toBeInTheDocument();
    const first = document.querySelector('[data-testid="workspace-grid"] > :first-child');
    expect(first).toHaveAttribute('data-testid', 'create-folder-card');
  });

  it('进入文件夹：按 folderId 请求画布，面包屑出现，返回根目录重新请求', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('folder-card-f1'));
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: 'f1' })));
    fireEvent.click(screen.getByText('工作空间'));
    await waitFor(() => expect(templateApi.getTemplates).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: 'root' })));
  });

  it('画布点击跳 /works/:id', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布')], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage();
    fireEvent.click(await screen.findByTestId('canvas-card-c1'));
    expect(navigate).toHaveBeenCalledWith('/works/c1');
  });

  it('hasMore 时显示加载更多，点击追加下一页', async () => {
    vi.mocked(templateApi.getTemplates)
      .mockResolvedValueOnce({ templates: [tpl('c1', 'a')], total: 25, page: 1, limit: 20, totalPages: 2 } as never)
      .mockResolvedValueOnce({ templates: [tpl('c21', 'b')], total: 25, page: 2, limit: 20, totalPages: 2 } as never);
    renderPage();
    fireEvent.click(await screen.findByTestId('load-more'));
    await waitFor(() => expect(screen.getByTestId('canvas-card-c21')).toBeInTheDocument());
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });

  it('新建画布：调 API 后跳转编辑器，无占位卡片', async () => {
    vi.mocked(canvasApi.createCanvas).mockResolvedValue({ templateId: 't9', projectId: 'p9' } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /新建画布/ }));
    fireEvent.change(await screen.findByLabelText('画布名称'), { target: { value: '新作品' } });
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/canvas?projectId=p9'));
    expect(screen.queryByTestId('canvas-card-placeholder-p9')).not.toBeInTheDocument();
  });

  it('删除文件夹提示移根数量', async () => {
    vi.mocked(folderApi.deleteFolder).mockResolvedValue({ movedCanvasCount: 2 } as never);
    renderPage();
    const card = await screen.findByTestId('folder-card-f1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('删除'));
    await waitFor(() => expect(folderApi.deleteFolder).toHaveBeenCalledWith('f1'));
  });

  it('移动画布到根目录：updateTemplate folderId null', async () => {
    vi.mocked(templateApi.getTemplates).mockResolvedValue({
      templates: [tpl('c1', '画布', 'f1')], total: 1, page: 1, limit: 20, totalPages: 1,
    } as never);
    renderPage('/works?folder=f1');
    const card = await screen.findByTestId('canvas-card-c1');
    fireEvent.click(card.querySelector('[aria-label="更多操作"]')!);
    fireEvent.click(await screen.findByText('移动到文件夹'));
    fireEvent.click(await screen.findByText('根目录（未分组）'));
    fireEvent.click(screen.getByRole('button', { name: '确 定' }));
    await waitFor(() => expect(templateApi.updateTemplate).toHaveBeenCalledWith('c1', { folderId: null }));
  });

  it('加载失败显示错误空态，重试成功', async () => {
    vi.mocked(folderApi.getFolders).mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByTestId('empty-state-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重 试' }));
    expect(await screen.findByTestId('folder-card-f1')).toBeInTheDocument();
  });

  it('list 视图渲染行', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('List view'));
    expect(await screen.findByTestId('workspace-list')).toBeInTheDocument();
  });
});
```

（原"搜索防抖"、"筛选"、"新建文件夹"、"无效 folderId"用例保留，mock 数据适配新形状即可——搜索/筛选是本地过滤逻辑不变；无效 folderId 用例改为 `/works?folder=nope` 时 getFolders 返回不含 nope → useFolderNavigation 重置根。）

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/web test -- WorkspacePage
```

预期：FAIL（load-more testid 不存在、旧占位逻辑、deleteFolder 非 async 等）。

- [ ] **Step 3: 修改 WorkspacePage.tsx**

逐点修改：

1. `onItemClick` 删除占位分支（64 行）：

```typescript
  const onItemClick = (item: WorkspaceItem) => {
    if (data.status === 'loading') return;
    if (item.type === 'folder') enterFolder(item.data.id);
    else navigate(`/works/${item.data.id}`);
  };
```

2. `enterFolder` 联动数据加载：

```typescript
  const enterFolder = (folderId: string | null) => {
    nav.setCurrentFolderId(folderId);
    setSearchQuery('');
    void data.loadFolder(folderId);
  };
```

3. `handleDeleteFolder` 改 async + movedCanvasCount 提示：

```typescript
  const handleDeleteFolder = async (folder: FolderViewModel) => {
    try {
      const moved = await data.deleteFolder(folder.id);
      message.success(moved > 0 ? `文件夹已删除，${moved} 张画布已移至根目录` : '文件夹已删除');
    } catch {
      message.error('删除失败，请重试');
    }
  };
```

4. 两处 CanvasCard 的 `onDelete` 简化（grid 139 行、list 180 行）：

```typescript
                      onDelete={(c) => { void data.deleteCanvas(c.id); }}
```

5. grid `<ul>` 之后、list `<ul>` 之后各加加载更多按钮（同级）：

```tsx
          {data.status === 'success' && data.hasMore && !searchQuery && (
            <button
              data-testid="load-more"
              onClick={() => { void data.loadMore(); }}
              className="mt-4 mx-auto block px-6 py-2 border border-white/20 rounded-lg text-sm text-white/70 bg-transparent cursor-pointer hover:border-white/40"
            >
              加载更多
            </button>
          )}
```

（两处渲染分支都要加；用条件 `viewMode === 'grid'` 的分支加在 grid ul 后，list 分支加在 list ul 后。）

- [ ] **Step 4: 修改 CanvasCard.tsx 删占位逻辑**

- 24 行 `menuItems` 三元改为常量数组（取非占位分支内容）；
- 73 行删 `{canvas.isPlaceholder && ...草稿...}`；
- 74 行改为 `{canvas.isPublic && <span ...>公开</span>}`；
- 92 行起的占位删除按钮区块整体删除（保留普通删除确认流程）。
- `CanvasCard.test.tsx` 删除 `isPlaceholder` 相关用例（49 行起）。

- [ ] **Step 5: 运行确认通过 + 前端全量回归（SaveAsTemplateDialog 尚未改，createTemplate 仍在——此时应全绿）**

```bash
pnpm --filter @flowweb/web test
```

预期：全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/workspace
git commit -m "feat(web): adapt workspace page to persisted folders with load-more"
```

---

### Task 13: SaveAsTemplateDialog 改调 save 端点 + 清理旧 API 函数

**Files:**
- Modify: `apps/web/src/pages/canvas/components/SaveAsTemplateDialog.tsx`
- Modify: `apps/web/src/api/templateApi.ts`（删 createTemplate 与 CreateTemplateDto）
- Modify: `apps/web/src/api/projectApi.ts`（删 createProject）
- Test: `apps/web/src/pages/canvas/components/__tests__/SaveAsTemplateDialog.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
// apps/web/src/pages/canvas/components/__tests__/SaveAsTemplateDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/canvasApi', () => ({ saveCanvas: vi.fn() }));
vi.mock('@/api/projectApi', () => ({ syncNodes: vi.fn(), syncEdges: vi.fn() }));
vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ nodes: [], edges: [] }) },
}));

import { saveCanvas } from '@/api/canvasApi';
import { SaveAsTemplateDialog } from '../SaveAsTemplateDialog';

describe('SaveAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveCanvas).mockResolvedValue({} as never);
  });

  it('保存调 saveCanvas（projectId + name/description/isPublic）', async () => {
    render(
      <SaveAsTemplateDialog projectId="p1" projectName="我的画布" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText('简要描述模板用途'), { target: { value: '描述' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveCanvas).toHaveBeenCalledWith('p1', {
      name: '我的画布', description: '描述', isPublic: false,
    }));
  });

  it('保存失败显示错误且不回调 onSaved', async () => {
    vi.mocked(saveCanvas).mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();
    render(<SaveAsTemplateDialog projectId="p1" projectName="n" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm --filter @flowweb/web test -- SaveAsTemplateDialog
```

预期：FAIL（当前调 createTemplate，saveCanvas 未被调用）。

- [ ] **Step 3: 实现**

`SaveAsTemplateDialog.tsx` 第 2、26 行改为：

```typescript
import { saveCanvas } from '@/api/canvasApi';
```

```typescript
      await saveCanvas(projectId, { name: projectName, description: description.trim(), isPublic });
```

`templateApi.ts`：删除 `createTemplate` 函数与 `CreateTemplateDto` 接口（第 13-18、36-38 行区域）。
`projectApi.ts`：删除 `createProject` 函数（第 11-16 行区域）。

- [ ] **Step 4: 运行确认通过 + 前端全量回归**

```bash
pnpm --filter @flowweb/web test -- SaveAsTemplateDialog
pnpm --filter @flowweb/web test
```

预期：全部 PASS（若有测试文件仍 import createProject/createTemplate 会编译报错——同步删除对应 import 与用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): switch save dialog to /projects/:id/save and drop legacy api fns"
```

---

### Task 14: 全量回归 + lint + 浏览器手动验证

**Files:** 无新文件（验证任务）

- [ ] **Step 1: 全量测试与 lint**

```bash
pnpm --filter @flowweb/api test && pnpm --filter @flowweb/api lint
pnpm --filter @flowweb/web test && pnpm --filter @flowweb/web lint
```

预期：全部 PASS / 无 lint 错误。

- [ ] **Step 2: 启动本地环境手动验证（参照记忆 project_startup：本地 PostgreSQL/Redis/MinIO + api + web）**

用 preview 工具启动 web dev server（依赖 api 与本地基础设施运行），登录后走黄金路径：

1. `/works` 页：真实文件夹列表（无 mock 文件夹）
2. 新建文件夹 → 刷新页面仍在（持久化 ✓）
3. 在文件夹内新建画布 → 跳转编辑器 → 返回列表真实入列（无"草稿"占位徽标）
4. 编辑器内"保存项目" → 描述/公开设置保存成功
5. 移动画布到另一文件夹 → 刷新后归属保持
6. 删除文件夹 → toast 显示"N 张画布已移至根目录"，画布出现在根目录
7. 重命名画布/文件夹、切换公开、删除画布
8. （可选，curl 带 cookie）`DELETE /api/projects/drafts` 返回 `{ deletedCount: 0 }`（新架构无孤儿）

发现问题 → 修复 → 重跑对应测试。

- [ ] **Step 3: 最终提交（如有修复）**

```bash
git add -A && git commit -m "fix: address issues found in manual verification"
```

---

## Self-Review 记录

- **Spec 覆盖：** §3 数据模型→T1；§4.1 文件夹 CRUD→T2/T3；§4.2 创建即入列→T7；§4.3 folderId 移动→T4；§4.4 save upsert+P2002→T8；§4.5 删除级联→T5；§4.6 drafts→T10；§4.7 folderId 过滤→T6；§4.8 touch 规则→T2(touch)/T4/T5/T7；§5 前端→T11-T13；§7 四限制消除→T7(占位)/T10(孤儿)/T6+T11(分页)/T1-T3(持久化)；§8 测试→各任务。
- **有意偏离 spec 一处：** T7 事务内直接 `tx.canvasProject.create` 而非复用 ProjectService.create（事务原子性要求，数据形状对齐），已在任务内注明。
- **类型一致性：** touch 签名 `touch(ids: Array<string | null | undefined>)` 各处调用匹配；`{ templateId, projectId }` 返回形状在 T7/T11 一致；`folderId: 'root'` 哨兵 T6/T11 一致。
- **无占位符：** 所有代码步骤含完整代码；命令含预期输出。
