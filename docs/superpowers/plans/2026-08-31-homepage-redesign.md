# 首页布局重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站替换 Navbar 为 liblib.tv 风格布局（公告条+侧边栏+顶部操作栏），重做首页（Banner 轮播+新建画布创作区+Footer），并新增公告条/首页 Banner 的后台配置能力。

**Architecture:** 路由级嵌套布局 `AppLayout`（公开组 + RequireAuth 登录组两组共享）；后端扩展 `Announcement` 模型（互斥启用）+ 新建 `HomeBanner` 模型（MinIO 图片存储），各配公开/admin 端点；前端复用 creditsStore、vipModalStore、TeamSwitcher、LoginModal。

**Tech Stack:** NestJS 10 + Prisma 5 + MinIO（@aws-sdk）；React 18.3 + react-router v7 + Tailwind 3.4 + antd 5 + zustand；Vitest 双端。

**Spec:** `docs/superpowers/specs/2026-08-31-homepage-redesign-design.md`（本计划的上位文档，冲突时以 spec 为准）

**执行约定：**
- 所有命令在仓库根 `D:\flowweb` 下执行（bash）；后端命令需 `cd apps/api`，前端命令需 `cd apps/web`
- 严格 TDD：每个任务先写测试→确认失败→实现→通过→提交
- 提交信息风格：`type(scope): 中文描述`，参考近期 `feat(web):` `test(web):` `docs(spec):`
- TypeScript strict 已开启，禁止 `any` 逃逸（仓库现状遵循度为准）
---

## Task 1: Prisma 模型（Announcement 扩展 + HomeBanner 新建）+ 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma:82-91`（Announcement 模型整体替换）
- 迁移目录由 prisma 生成: `apps/api/prisma/migrations/<本地时间戳>_home_layout_content/`

- [ ] **Step 1: 修改 schema.prisma**

将现有 Announcement 模型（82-91 行）整体替换为：

```prisma
model Announcement {
  id         String    @id @default(cuid())
  message    String    @db.VarChar(200)
  linkText   String?   @db.VarChar(32)
  linkUrl    String?   @db.VarChar(500)
  bgColor    String    @default("#0f2761") @db.VarChar(16)
  textColor  String    @default("#ffffff") @db.VarChar(16)
  active     Boolean   @default(false)
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
}
```

注意：**不保留** `@@index([active])`——下方手工补充的部分唯一索引（WHERE active）已覆盖 active=true 的全部查询路径，普通布尔索引冗余。

在 ContentCard 模型之后新增：

```prisma
model HomeBanner {
  id        String   @id @default(cuid())
  title     String?  @db.VarChar(128)
  subtitle  String?  @db.VarChar(256)
  linkUrl   String?  @db.VarChar(500)
  imageKey  String   @db.VarChar(255)
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}
```

注意：`active` 默认值从 `true` 改为 `false`（admin 显式启用）；seed.ts 的 upsert 显式写 `active: true`，不受默认值变化影响，seed message 长度在 VarChar(200) 内，无需改 seed。

- [ ] **Step 2: 生成迁移**

```bash
cd apps/api && pnpm prisma migrate dev --name home_layout_content
```

注意事项（项目记忆）：迁移目录名用本地时间戳（prisma 自动生成即本地时间，确认即可）；migrate dev 需一次性 CREATEDB 授权（此前已完成）。

生成后打开迁移 SQL，**手工补充互斥部分唯一索引**（prisma 不支持 partial index 声明）：

```sql
-- CreateIndex
CREATE UNIQUE INDEX "announcement_single_active" ON "Announcement"("active") WHERE "active";
```

- [ ] **Step 3: fresh replay 验证**

```bash
cd apps/api && pnpm prisma migrate reset --force
```

Expected: 全部迁移按序重放 + seed 执行成功；单一 seed 公告 active=true 与部分唯一索引不冲突。

- [ ] **Step 4: 验证索引存在**

```bash
psql -U flowweb -d flowweb -c "\d Announcement" | grep announcement_single_active
```

Expected: 输出包含 `announcement_single_active` UNIQUE 索引行。

若本机 psql 要求密码交互，替代验证（任选其一）：

```bash
cd apps/api && pnpm prisma db execute --stdin <<< "SELECT indexname FROM pg_indexes WHERE tablename='Announcement';"
```

或直接以 Step 3 的 `migrate reset --force` 无报错为准——reset 重放包含该 CREATE UNIQUE INDEX，若存在重复 active 行会直接失败，本身就是强验证。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): Announcement 扩展配色/链接字段+新 HomeBanner 模型——含启用互斥部分唯一索引"
```

---

## Task 2: shared 类型定义

**Files:**
- Create: `packages/shared/src/types/home.types.ts`
- Modify: `packages/shared/src/index.ts`（末尾追加一行）

- [ ] **Step 1: 创建 home.types.ts**

```ts
export interface AnnouncementInfo {
  id: string;
  message: string;
  linkText: string | null;
  linkUrl: string | null;
  bgColor: string;
  textColor: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementDto {
  message: string;
  bgColor?: string;
  textColor?: string;
  linkText?: string | null;
  linkUrl?: string | null;
  active?: boolean;
}

export interface UpdateAnnouncementDto {
  message?: string;
  bgColor?: string;
  textColor?: string;
  linkText?: string | null;
  linkUrl?: string | null;
  active?: boolean;
}

export interface HomeBannerInfo {
  id: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
  imageKey?: string;
  imageUrl?: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicHomeBanner {
  id: string;
  title: string | null;
  subtitle: string | null;
  linkUrl: string | null;
  imageUrl: string;
  sortOrder: number;
}

export interface CreateHomeBannerDto {
  title?: string | null;
  subtitle?: string | null;
  linkUrl?: string | null;
  imageKey: string;
  sortOrder?: number;
  active?: boolean;
}

export interface UpdateHomeBannerDto {
  title?: string | null;
  subtitle?: string | null;
  linkUrl?: string | null;
  imageKey?: string;
  sortOrder?: number;
  active?: boolean;
}
```

- [ ] **Step 2: 根 barrel 补导出链**

`packages/shared/src/index.ts` 末尾追加：

```ts
export * from './types/home.types';
```

- [ ] **Step 3: 验证类型可用**

```bash
cd apps/web && npx tsc -b --force
```

Expected: 零错误。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/home.types.ts packages/shared/src/index.ts
git commit -m "feat(shared): 首页公告/Banner 共享类型定义"
```

---

## Task 3: ContentService 公告 CRUD + 启用互斥（TDD）

**Files:**
- Test: `apps/api/src/modules/content/content.service.spec.ts`（新建）
- Modify: `apps/api/src/modules/content/content.service.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

describe('ContentService 公告 CRUD', () => {
  let service: ContentService;
  let prisma: {
    contentCard: { findMany: ReturnType<typeof vi.fn> };
    announcement: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    prisma = {
      contentCard: { findMany: vi.fn().mockResolvedValue([]) },
      announcement: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
        update: vi.fn().mockResolvedValue({ id: 'a1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        delete: vi.fn().mockResolvedValue({ id: 'a1' }),
      },
      $transaction: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ContentService);
  });

  it('getActiveAnnouncement 按 updatedAt 倒序取第一条', async () => {
    prisma.announcement.findFirst.mockResolvedValue({ id: 'a1', message: 'm' });
    const r = await service.getActiveAnnouncement();
    expect(r).toEqual({ id: 'a1', message: 'm' });
    expect(prisma.announcement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    );
  });

  it('listAnnouncements 返回全部（按创建时间倒序）', async () => {
    prisma.announcement.findMany.mockResolvedValue([{ id: 'a1' }]);
    const r = await service.listAnnouncements();
    expect(r).toEqual([{ id: 'a1' }]);
    expect(prisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('createAnnouncement 未启用：直接 create，不走事务', async () => {
    await service.createAnnouncement({ message: 'm' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        message: 'm',
        bgColor: '#0f2761',
        textColor: '#ffffff',
        linkText: null,
        linkUrl: null,
        active: false,
      }),
    });
  });

  it('createAnnouncement active=true：事务内先禁用其他再创建（互斥）', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    await service.createAnnouncement({ message: 'm', active: true });
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ active: true }),
    });
  });

  it('updateAnnouncement active=true：事务内先禁用其他再更新（互斥）', async () => {
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
    await service.updateAnnouncement('a1', { active: true });
    expect(prisma.announcement.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { active: true },
    });
  });

  it('updateAnnouncement 非启用字段：直接 update，不走事务', async () => {
    await service.updateAnnouncement('a1', { message: 'new' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { message: 'new' },
    });
  });

  it('互斥冲突（P2002）转 ConflictException', async () => {
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });
    await expect(
      service.updateAnnouncement('a1', { active: true }),
    ).rejects.toThrow(ConflictException);
  });

  it('deleteAnnouncement 按 id 删除', async () => {
    await service.deleteAnnouncement('a1');
    expect(prisma.announcement.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/content/content.service.spec.ts
```

Expected: FAIL（`service.listAnnouncements is not a function` 等方法缺失）。

- [ ] **Step 3: 实现（content.service.ts 整体替换）**

```ts
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from '@flowweb/shared';

function mapMutexError(e: unknown): unknown {
  if ((e as { code?: string })?.code === 'P2002') {
    return new ConflictException('已有启用中的公告，请先禁用');
  }
  return e;
}

@Injectable()
export class ContentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCards() {
    return this.prisma.contentCard.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getActiveAnnouncement() {
    return this.prisma.announcement.findFirst({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listAnnouncements() {
    return this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAnnouncement(dto: CreateAnnouncementDto) {
    const data = {
      message: dto.message,
      bgColor: dto.bgColor ?? '#0f2761',
      textColor: dto.textColor ?? '#ffffff',
      linkText: dto.linkText ?? null,
      linkUrl: dto.linkUrl ?? null,
      active: dto.active ?? false,
    };
    if (!data.active) {
      return this.prisma.announcement.create({ data });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.announcement.updateMany({ where: { active: true }, data: { active: false } });
        return tx.announcement.create({ data });
      });
    } catch (e) {
      throw mapMutexError(e);
    }
  }

  async updateAnnouncement(id: string, dto: UpdateAnnouncementDto) {
    const data: Record<string, unknown> = {};
    if (dto.message !== undefined) data.message = dto.message;
    if (dto.bgColor !== undefined) data.bgColor = dto.bgColor;
    if (dto.textColor !== undefined) data.textColor = dto.textColor;
    if (dto.linkText !== undefined) data.linkText = dto.linkText;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl;
    if (dto.active !== undefined) data.active = dto.active;

    if (data.active !== true) {
      return this.prisma.announcement.update({ where: { id }, data });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.announcement.updateMany({ where: { active: true }, data: { active: false } });
        return tx.announcement.update({ where: { id }, data });
      });
    } catch (e) {
      throw mapMutexError(e);
    }
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/content/content.service.spec.ts
```

Expected: PASS（8 个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/content/content.service.ts apps/api/src/modules/content/content.service.spec.ts
git commit -m "feat(api): 公告 admin CRUD 与启用互斥——事务+部分唯一索引双保险"
```

---

## Task 4: 公告 Admin Controller + DTO（TDD）

**Files:**
- Create: `apps/api/src/modules/content/dto/create-announcement.dto.ts`
- Create: `apps/api/src/modules/content/dto/update-announcement.dto.ts`
- Create: `apps/api/src/modules/content/admin-announcement.controller.ts`
- Test: `apps/api/src/modules/content/admin-announcement.controller.spec.ts`
- Modify: `apps/api/src/modules/content/content.module.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminAnnouncementController } from './admin-announcement.controller';
import { ContentService } from './content.service';

describe('AdminAnnouncementController', () => {
  let controller: AdminAnnouncementController;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      listAnnouncements: vi.fn().mockResolvedValue([]),
      createAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      updateAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      deleteAnnouncement: vi.fn().mockResolvedValue({ id: 'a1' }),
      getCards: vi.fn(),
      getActiveAnnouncement: vi.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAnnouncementController],
      providers: [{ provide: ContentService, useValue: service }],
    }).compile();
    controller = module.get(AdminAnnouncementController);
  });

  it('GET 列表转发 service.listAnnouncements', async () => {
    service.listAnnouncements.mockResolvedValue([{ id: 'a1' }]);
    expect(await controller.list()).toEqual([{ id: 'a1' }]);
  });

  it('POST 转发 dto 到 createAnnouncement', async () => {
    const dto = { message: 'm', active: true };
    await controller.create(dto);
    expect(service.createAnnouncement).toHaveBeenCalledWith(dto);
  });

  it('PATCH 转发 id 与 dto', async () => {
    await controller.update('a1', { active: false });
    expect(service.updateAnnouncement).toHaveBeenCalledWith('a1', { active: false });
  });

  it('DELETE 转发 id', async () => {
    await controller.remove('a1');
    expect(service.deleteAnnouncement).toHaveBeenCalledWith('a1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/content/admin-announcement.controller.spec.ts
```

Expected: FAIL（模块不存在，无法解析依赖）。

- [ ] **Step 3: 实现 DTO 与 Controller**

`apps/api/src/modules/content/dto/create-announcement.dto.ts`：

```ts
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(200)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'bgColor 必须是十六进制颜色' })
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'textColor 必须是十六进制颜色' })
  textColor?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  linkText?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`apps/api/src/modules/content/dto/update-announcement.dto.ts`：

```ts
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'bgColor 必须是十六进制颜色' })
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^#[0-9a-fA-F]{3,8}$/, { message: 'textColor 必须是十六进制颜色' })
  textColor?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(32)
  linkText?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`apps/api/src/modules/content/admin-announcement.controller.ts`：

```ts
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ContentService } from './content.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller('api/admin/announcements')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminAnnouncementController {
  constructor(@Inject(ContentService) private readonly contentService: ContentService) {}

  @Get()
  list() {
    return this.contentService.listAnnouncements();
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto) {
    return this.contentService.createAnnouncement(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.contentService.updateAnnouncement(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.contentService.deleteAnnouncement(id);
  }
}
```

`apps/api/src/modules/content/content.module.ts` 整体替换：

```ts
import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { AnnouncementController } from './announcement.controller';
import { AdminAnnouncementController } from './admin-announcement.controller';
import { ContentService } from './content.service';

@Module({
  controllers: [ContentController, AnnouncementController, AdminAnnouncementController],
  providers: [ContentService],
})
export class ContentModule {}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/content/
```

Expected: PASS（content 模块全部测试绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/content
git commit -m "feat(api): 公告 admin 端点——CRUD+局部 ValidationPipe 白名单校验"
```

---

## Task 5: HomeBannerService（TDD）

**Files:**
- Test: `apps/api/src/modules/home-banner/home-banner.service.spec.ts`
- Create: `apps/api/src/modules/home-banner/home-banner.service.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import { HomeBannerService } from './home-banner.service';

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  title: null,
  subtitle: null,
  linkUrl: null,
  imageKey: 'uploads/system/x.jpg',
  sortOrder: 0,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('HomeBannerService', () => {
  let service: HomeBannerService;
  let prisma: { homeBanner: Record<string, ReturnType<typeof vi.fn>> };
  let minio: { generatePresignedGetUrl: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = {
      homeBanner: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(ROW()),
        update: vi.fn().mockResolvedValue(ROW()),
        delete: vi.fn().mockResolvedValue(ROW()),
      },
    };
    minio = {
      generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HomeBannerService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    service = module.get(HomeBannerService);
  });

  it('listActive 只取启用行，按 sortOrder 升序，逐行生成 3600s presign', async () => {
    prisma.homeBanner.findMany.mockResolvedValue([ROW({ id: 'b1', sortOrder: 1 }), ROW({ id: 'b2', sortOrder: 2 })]);
    const r = await service.listActive();
    expect(prisma.homeBanner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    );
    expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith('uploads/system/x.jpg', 3600);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ id: 'b1', imageUrl: 'http://minio/presigned' });
  });

  it('listAll 不筛 active，同样附 presign URL', async () => {
    prisma.homeBanner.findMany.mockResolvedValue([ROW({ active: false })]);
    const r = await service.listAll();
    expect(prisma.homeBanner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    );
    expect(r[0]).toMatchObject({ imageUrl: 'http://minio/presigned' });
  });

  it('create 应用默认值（sortOrder=0 active=true，可空字段 null）', async () => {
    await service.create({ imageKey: 'k' });
    expect(prisma.homeBanner.create).toHaveBeenCalledWith({
      data: {
        title: null,
        subtitle: null,
        linkUrl: null,
        imageKey: 'k',
        sortOrder: 0,
        active: true,
      },
    });
  });

  it('update 更换 imageKey 时删除旧对象', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW({ imageKey: 'old.jpg' }));
    await service.update('b1', { imageKey: 'new.jpg' });
    expect(minio.delete).toHaveBeenCalledWith('old.jpg');
    expect(prisma.homeBanner.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ imageKey: 'new.jpg' }),
    });
  });

  it('update 不换图时不删对象', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    await service.update('b1', { title: 't' });
    expect(minio.delete).not.toHaveBeenCalled();
  });

  it('remove 先删 MinIO 对象再删 DB 行（失败可重试不留脏行）', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    await service.remove('b1');
    expect(minio.delete).toHaveBeenCalledWith('uploads/system/x.jpg');
    expect(prisma.homeBanner.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    const order = [minio.delete.mock.invocationCallOrder[0], prisma.homeBanner.delete.mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('remove MinIO 删除抛错时不删 DB 行', async () => {
    prisma.homeBanner.findUnique.mockResolvedValue(ROW());
    minio.delete.mockRejectedValue(new Error('network'));
    await expect(service.remove('b1')).rejects.toThrow('network');
    expect(prisma.homeBanner.delete).not.toHaveBeenCalled();
  });

  it('remove/update 不存在的 id 抛 NotFoundException', async () => {
    await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    await expect(service.update('nope', { title: 't' })).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/home-banner/home-banner.service.spec.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 HomeBannerService**

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../../minio/minio.service';
import type { HomeBanner } from '@prisma/client';
import type { CreateHomeBannerDto, UpdateHomeBannerDto } from '@flowweb/shared';

const ORDER_BY = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] as const;

@Injectable()
export class HomeBannerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  async listActive() {
    const rows = await this.prisma.homeBanner.findMany({
      where: { active: true },
      orderBy: [...ORDER_BY],
    });
    return this.withUrls(rows);
  }

  async listAll() {
    const rows = await this.prisma.homeBanner.findMany({
      orderBy: [...ORDER_BY],
    });
    return this.withUrls(rows);
  }

  private async withUrls(rows: HomeBanner[]) {
    return Promise.all(
      rows.map(async (b) => ({
        ...b,
        imageUrl: await this.minio.generatePresignedGetUrl(b.imageKey, 3600),
      })),
    );
  }

  async create(dto: CreateHomeBannerDto) {
    return this.prisma.homeBanner.create({
      data: {
        title: dto.title ?? null,
        subtitle: dto.subtitle ?? null,
        linkUrl: dto.linkUrl ?? null,
        imageKey: dto.imageKey,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateHomeBannerDto) {
    const existing = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner 不存在');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;
    const imageChanged = dto.imageKey !== undefined && dto.imageKey !== existing.imageKey;
    if (imageChanged) data.imageKey = dto.imageKey;

    const updated = await this.prisma.homeBanner.update({ where: { id }, data });
    if (imageChanged) {
      // 换图后清理旧对象；失败不阻断（次要清理，S3 delete 幂等）
      await this.minio.delete(existing.imageKey).catch(() => {});
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.homeBanner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Banner 不存在');
    // 先删对象再删行：S3 delete 幂等（对象不存在也成功）；失败则抛错，DB 行未删可重试
    await this.minio.delete(existing.imageKey);
    return this.prisma.homeBanner.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/home-banner/home-banner.service.spec.ts
```

Expected: PASS（8 个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/home-banner
git commit -m "feat(api): HomeBannerService——排序/并行 presign/先删对象后删行/换图清旧 key"
```

---

## Task 6: HomeBanner 控制器 + 模块 + AuthGuard 白名单（TDD）

**Files:**
- Create: `apps/api/src/modules/home-banner/dto/create-home-banner.dto.ts`
- Create: `apps/api/src/modules/home-banner/dto/update-home-banner.dto.ts`
- Create: `apps/api/src/modules/home-banner/home-banner.controller.ts`（公开）
- Create: `apps/api/src/modules/home-banner/admin-home-banner.controller.ts`（admin + upload）
- Create: `apps/api/src/modules/home-banner/home-banner.module.ts`
- Test: `apps/api/src/modules/home-banner/home-banner.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`（注册模块）
- Modify: `apps/api/src/auth/auth.guard.ts:3-14`（白名单）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { HomeBannerController } from './home-banner.controller';
import { AdminHomeBannerController } from './admin-home-banner.controller';
import { HomeBannerService } from './home-banner.service';
import { MinioService } from '../../minio/minio.service';

describe('HomeBannerController（公开）', () => {
  it('GET active 转发 service.listActive', async () => {
    const svc = { listActive: vi.fn().mockResolvedValue([{ id: 'b1' }]) };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HomeBannerController],
      providers: [{ provide: HomeBannerService, useValue: svc }],
    }).compile();
    const controller = module.get(HomeBannerController);
    expect(await controller.listActive()).toEqual([{ id: 'b1' }]);
  });
});

describe('AdminHomeBannerController', () => {
  let adminController: AdminHomeBannerController;
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let minio: { buildKey: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = {
      listActive: vi.fn(),
      listAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'b1' }),
      update: vi.fn().mockResolvedValue({ id: 'b1' }),
      remove: vi.fn().mockResolvedValue({ id: 'b1' }),
    };
    minio = {
      buildKey: vi.fn().mockReturnValue('uploads/system/k.jpg'),
      upload: vi.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminHomeBannerController],
      providers: [
        { provide: HomeBannerService, useValue: svc },
        { provide: MinioService, useValue: minio },
      ],
    }).compile();
    adminController = module.get(AdminHomeBannerController);
  });

  it('GET 列表转发 listAll', async () => {
    svc.listAll.mockResolvedValue([{ id: 'b1' }]);
    expect(await adminController.list()).toEqual([{ id: 'b1' }]);
  });

  it('POST/DELETE 转发 service', async () => {
    await adminController.create({ imageKey: 'k' });
    expect(svc.create).toHaveBeenCalledWith({ imageKey: 'k' });
    await adminController.update('b1', { active: false });
    expect(svc.update).toHaveBeenCalledWith('b1', { active: false });
    await adminController.remove('b1');
    expect(svc.remove).toHaveBeenCalledWith('b1');
  });

  it('upload：magic number 校验通过后走 MinIO 并返回 imageKey', async () => {
    // PNG 头
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const r = await adminController.upload({ buffer: png, mimetype: 'image/png' });
    expect(minio.upload).toHaveBeenCalledWith('uploads/system/k.jpg', png, 'image/png');
    expect(r).toEqual({ imageKey: 'uploads/system/k.jpg' });
  });

  it('upload：magic number 不匹配抛 BadRequestException', async () => {
    const bad = Buffer.from([0x00, 0x01, 0x02, 0x03, 4, 5, 6, 7, 8, 9, 10, 11]);
    await expect(
      adminController.upload({ buffer: bad, mimetype: 'image/png' }),
    ).rejects.toThrow('文件类型不匹配');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/api && npx vitest run src/modules/home-banner/home-banner.controller.spec.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 DTO / Controller / Module**

`apps/api/src/modules/home-banner/dto/create-home-banner.dto.ts`：

```ts
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class CreateHomeBannerDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(128)
  title?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(256)
  subtitle?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsString()
  @MaxLength(255)
  imageKey: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`apps/api/src/modules/home-banner/dto/update-home-banner.dto.ts`：

```ts
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateHomeBannerDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(128)
  title?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(256)
  subtitle?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'linkUrl 必须以 http(s):// 开头' })
  linkUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  imageKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

`apps/api/src/modules/home-banner/home-banner.controller.ts`（公开）：

```ts
import { Controller, Get, Inject } from '@nestjs/common';
import { HomeBannerService } from './home-banner.service';

@Controller('api/home-banners')
export class HomeBannerController {
  constructor(@Inject(HomeBannerService) private readonly service: HomeBannerService) {}

  @Get('active')
  listActive() {
    return this.service.listActive();
  }
}
```

`apps/api/src/modules/home-banner/admin-home-banner.controller.ts`：

```ts
import {
  BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post,
  UploadedFile, UseInterceptors, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HomeBannerService } from './home-banner.service';
import { MinioService } from '../../minio/minio.service';
import { CreateHomeBannerDto } from './dto/create-home-banner.dto';
import { UpdateHomeBannerDto } from './dto/update-home-banner.dto';

@Controller('api/admin/home-banners')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminHomeBannerController {
  constructor(
    @Inject(HomeBannerService) private readonly service: HomeBannerService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Post()
  create(@Body() dto: CreateHomeBannerDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateHomeBannerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      }
      cb(null, true);
    },
  }))
  async upload(@UploadedFile() file: { buffer: Buffer; mimetype: string }) {
    if (!file) throw new BadRequestException('未上传文件');

    const head = file.buffer;
    const isJPEG = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    const isPNG = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    const isWebP = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
      && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    if (!(isJPEG || isPNG || isWebP)) {
      throw new BadRequestException('文件类型不匹配');
    }

    const ext = file.mimetype.split('/')[1];
    const key = this.minio.buildKey('uploaded', 'system', { ext: ext === 'jpeg' ? 'jpg' : ext });
    await this.minio.upload(key, file.buffer, file.mimetype);
    return { imageKey: key };
  }
}
```

`apps/api/src/modules/home-banner/home-banner.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { HomeBannerController } from './home-banner.controller';
import { AdminHomeBannerController } from './admin-home-banner.controller';
import { HomeBannerService } from './home-banner.service';

@Module({
  controllers: [HomeBannerController, AdminHomeBannerController],
  providers: [HomeBannerService],
})
export class HomeBannerModule {}
```

（MinioService 是 @Global，无需 import MinioModule。）

`apps/api/src/app.module.ts`：import 区加 `import { HomeBannerModule } from './modules/home-banner/home-banner.module';`，imports 数组加 `HomeBannerModule,`（放在 ContentModule 之后即可）。

`apps/api/src/auth/auth.guard.ts` 白名单数组中 `'/api/announcements',` 之后加一行：

```ts
  '/api/home-banners',
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/api && npx vitest run src/modules/home-banner/
```

Expected: PASS（service + controller 全绿）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/home-banner apps/api/src/app.module.ts apps/api/src/auth/auth.guard.ts
git commit -m "feat(api): 首页 Banner 公开+admin 端点——upload magic 校验+AuthGuard 白名单"
```

---

## Task 7: 后端全量验证

- [ ] **Step 1: 全量测试（含 tsc spec 类型检查）**

```bash
cd apps/api && pnpm test
```

Expected: tsc 零错 + 全部 vitest 用例绿（含存量）。

- [ ] **Step 2: 启动冒烟（可选，本地服务已在跑则重启 api）**

```bash
curl -s http://localhost:3000/api/home-banners/active
```

Expected: `{"code":0,"data":[],"message":...}`（空数组，匿名可访问不 401）。

```bash
curl -s http://localhost:3000/api/announcements/active
```

Expected: seed 公告（含 bgColor/textColor 新字段）。

---

## Task 8: 前端基建（静态资源迁移 + index.css）

**Files:**
- Move: `apps/web/img/` → `apps/web/public/img/`（git mv）
- Modify: `apps/web/src/index.css:27-32`（body 规则）

- [ ] **Step 1: 迁移图片目录**

```bash
mkdir -p apps/web/public && git mv apps/web/img apps/web/public/img
```

背景：`apps/web/img/` 当前不被 Vite 服务（无 publicDir 配置，public/ 原不存在），`/img/LOGO.png` 会 404；移入 public/ 后零配置生效。

- [ ] **Step 2: 修改 index.css body**

将 `apps/web/src/index.css` 中 body 规则（27-32 行）替换为：

```css
body {
  margin: 0;
  background: #141414;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
```

（背景 `#0f0f0f` → `#141414`：布局容器外的过滚边缘不露旧色；字体栈补 `'Helvetica Neue', Arial` 对齐 spec 9.2。）

- [ ] **Step 3: 验证**

```bash
cd apps/web && pnpm test && ls public/img
```

Expected: 测试全绿；`public/img` 下有 `LOGO.png` 与 `wechat-qrcode.jpg`。

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/img apps/web/src/index.css
git commit -m "chore(web): img 迁入 public 生效+body 背景对齐 #141414 与字体栈补全"
```

---

## Task 9: startNewProject 工具（TDD）

**Files:**
- Create: `apps/web/src/utils/startNewProject.ts`
- Test: `apps/web/src/utils/startNewProject.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { startNewProject } from './startNewProject';

describe('startNewProject', () => {
  it('先清 flowweb_projectId 再跳 /canvas', () => {
    localStorage.setItem('flowweb_projectId', 'old-project');
    const navigate = vi.fn();
    startNewProject(navigate);
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/canvas');
  });

  it('无残留 projectId 时也正常跳转', () => {
    localStorage.removeItem('flowweb_projectId');
    const navigate = vi.fn();
    startNewProject(navigate);
    expect(navigate).toHaveBeenCalledWith('/canvas');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/utils/startNewProject.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
import type { NavigateFunction } from 'react-router';

export function startNewProject(navigate: NavigateFunction): void {
  localStorage.removeItem('flowweb_projectId');
  navigate('/canvas');
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd apps/web && npx vitest run src/utils/startNewProject.test.ts
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/startNewProject.ts apps/web/src/utils/startNewProject.test.ts
git commit -m "feat(web): startNewProject 工具——清 projectId 再跳画布，防旧项目恢复"
```

---

## Task 10: announcementStore 改造 + 旧首页适配（TDD）

**Files:**
- Modify: `apps/web/src/stores/announcementStore.ts`（整体替换）
- Test: `apps/web/src/stores/announcementStore.test.ts`（重写）
- Modify: `apps/web/src/pages/home/index.tsx`（去掉公告消费，中间态）
- Delete: `apps/web/src/pages/home/components/AnnouncementBanner.tsx` + `.test.tsx`
- Modify: `apps/web/src/pages/home/page.test.tsx`（去公告 mock 与断言）

- [ ] **Step 1: 重写 store 测试（先失败）**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAnnouncementStore } from './announcementStore';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

describe('announcementStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    useAnnouncementStore.setState({ announcement: null, loaded: false });
  });

  it('fetchActive 拉取 /announcements/active 并写入 announcement', async () => {
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm', bgColor: '#0f2761', textColor: '#ffffff' });
    await useAnnouncementStore.getState().fetchActive();
    expect(mockApiFetch).toHaveBeenCalledWith('/announcements/active');
    expect(useAnnouncementStore.getState().announcement?.id).toBe('a1');
    expect(useAnnouncementStore.getState().loaded).toBe(true);
  });

  it('本会话已 dismiss 过的公告不再写入', async () => {
    sessionStorage.setItem('announcement_dismissed_a1', '1');
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm' });
    await useAnnouncementStore.getState().fetchActive();
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('fetch 失败静默置 null 不抛错', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'));
    await expect(useAnnouncementStore.getState().fetchActive()).resolves.toBeUndefined();
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('loaded 后再次 fetchActive 不重复请求', async () => {
    mockApiFetch.mockResolvedValue({ id: 'a1', message: 'm' });
    await useAnnouncementStore.getState().fetchActive();
    await useAnnouncementStore.getState().fetchActive();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it('dismiss 写入按公告 id 的 sessionStorage 键并清空 announcement', () => {
    useAnnouncementStore.setState({ announcement: { id: 'a9', message: 'x' } as never });
    useAnnouncementStore.getState().dismiss();
    expect(sessionStorage.getItem('announcement_dismissed_a9')).toBe('1');
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });
});
```

```bash
cd apps/web && npx vitest run src/stores/announcementStore.test.ts
```

Expected: FAIL（旧 store 无 fetchActive/announcement）。

- [ ] **Step 2: 重写 store（整体替换 announcementStore.ts）**

```ts
import { create } from 'zustand';
import { apiFetch } from '@/api/client';
import type { AnnouncementInfo } from '@flowweb/shared';

interface AnnouncementState {
  announcement: AnnouncementInfo | null;
  loaded: boolean;
  fetchActive: () => Promise<void>;
  dismiss: () => void;
}

const dismissedKey = (id: string) => `announcement_dismissed_${id}`;

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  announcement: null,
  loaded: false,
  fetchActive: async () => {
    if (get().loaded) return;
    try {
      const data = await apiFetch<AnnouncementInfo | null>('/announcements/active');
      set({
        announcement: data && !sessionStorage.getItem(dismissedKey(data.id)) ? data : null,
        loaded: true,
      });
    } catch {
      set({ announcement: null, loaded: true });
    }
  },
  dismiss: () => {
    const { announcement } = get();
    if (announcement) sessionStorage.setItem(dismissedKey(announcement.id), '1');
    set({ announcement: null });
  },
}));
```

- [ ] **Step 3: 运行 store 测试确认通过**

```bash
cd apps/web && npx vitest run src/stores/announcementStore.test.ts
```

Expected: PASS（5 用例）。

- [ ] **Step 4: 旧首页适配（中间态）+ 删旧组件**

删除文件：`apps/web/src/pages/home/components/AnnouncementBanner.tsx`、`apps/web/src/pages/home/components/AnnouncementBanner.test.tsx`。

`apps/web/src/pages/home/index.tsx` 整体替换为：

```tsx
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { ContentSection } from './components/ContentSection';
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { VipSubscribeModal } from '@/components/VipSubscribeModal';
import { useVipModalStore } from '@/stores/vipModalStore';
import { useNavigate } from 'react-router';

export function HomePage() {
  const vipModalVisible = useVipModalStore(s => s.visible);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <div className="sticky top-0 z-40">
        <Navbar />
      </div>
      <HeroSection onStartCreate={() => { localStorage.removeItem('flowweb_projectId'); navigate('/canvas'); }} />
      <ContentSection />
      <AIAssistantFAB />
      {vipModalVisible && <VipSubscribeModal />}
    </div>
  );
}
```

`apps/web/src/pages/home/page.test.tsx` 中删除两处：
1. 整个 `vi.mock('@/stores/announcementStore', ...)` 块（17-24 行）
2. `it('should render announcement message', ...)` 用例（47-50 行）

其余断言（hero 标题/CTA/导航链接/AI 助手/VIP modal）保留。

- [ ] **Step 5: 全量验证 + Commit**

```bash
cd apps/web && pnpm test
```

Expected: 全绿（无任何文件再引用已删除的 AnnouncementBanner 与旧 store 形状）。

```bash
git add -A apps/web/src
git commit -m "feat(web): announcementStore 重写——fetchActive/按 id dismiss/loaded 防重，摘除旧公告条"
```

---

## Task 11: 首页内容三组件（TDD）

**Files:**
- Create: `apps/web/src/pages/home/components/Footer.tsx` + `Footer.test.tsx`
- Create: `apps/web/src/pages/home/components/CreateCanvasCard.tsx` + `CreateCanvasCard.test.tsx`
- Create: `apps/web/src/pages/home/components/BannerCarousel.tsx` + `BannerCarousel.test.tsx`

- [ ] **Step 1: 写 Footer 失败测试**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from './Footer';

describe('Footer', () => {
  it('渲染网站介绍与功能描述', () => {
    render(<Footer />);
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
    expect(screen.getByText('文生文·文生图·图生图·图生视频·文生视频')).toBeInTheDocument();
  });

  it('备案号链接指向工信部并新窗口打开', () => {
    render(<Footer />);
    const link = screen.getByText('鲁ICP备2026030119号').closest('a');
    expect(link).toHaveAttribute('href', 'https://beian.miit.gov.cn');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
```

- [ ] **Step 2: 实现 Footer**

```tsx
const ICP_NUMBER = '鲁ICP备2026030119号';

export function Footer() {
  return (
    <footer className="border-t border-[#262626] py-6">
      <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
        <span className="text-[#888]">AI 多模态内容创作平台</span>
        <span className="text-[#333] hidden sm:inline">|</span>
        <span className="text-[#666]">文生文·文生图·图生图·图生视频·文生视频</span>
        <span className="text-[#333] hidden sm:inline">|</span>
        <a
          href="https://beian.miit.gov.cn"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#666] no-underline hover:text-[#888] hover:underline"
        >
          {ICP_NUMBER}
        </a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: 写 CreateCanvasCard 失败测试**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { CreateCanvasCard } from './CreateCanvasCard';

function Probe() {
  const navigate = useNavigate();
  return (
    <>
      <CreateCanvasCard />
      <button data-testid="probe" onClick={() => navigate('/probe')} />
    </>
  );
}

describe('CreateCanvasCard', () => {
  beforeEach(() => localStorage.clear());

  it('渲染中央按钮与文案', () => {
    render(<MemoryRouter><Probe /></MemoryRouter>);
    expect(screen.getByText('新建画布创作')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建画布' })).toBeInTheDocument();
  });

  it('点击卡片：清 projectId 并跳 /canvas', () => {
    localStorage.setItem('flowweb_projectId', 'old');
    render(<MemoryRouter><Probe /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('create-canvas-card'));
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
    expect(screen.getByTestId('probe')).toBeInTheDocument(); // 未崩溃
  });
});
```

注意：跳转 `/canvas` 的断言通过「清掉 projectId + 组件不崩溃」验证；路由跳转本身由 startNewProject 单测（Task 9）覆盖，不在此重复。

- [ ] **Step 4: 实现 CreateCanvasCard**

```tsx
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { startNewProject } from '@/utils/startNewProject';

export function CreateCanvasCard() {
  const navigate = useNavigate();
  return (
    <div
      data-testid="create-canvas-card"
      onClick={() => startNewProject(navigate)}
      className="group relative h-[200px] w-full mb-8 rounded-xl border-[0.5px] border-[rgba(8,182,221,0.5)] hover:border-[rgba(8,182,221,0.8)] bg-[#1a1a1a] hover:bg-[#1e1e1e] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col items-center justify-center gap-4"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(to bottom, rgba(4,202,246,0.04), rgba(4,202,246,0.1))',
          filter: 'blur(8px)',
        }}
      />
      <button
        aria-label="新建画布"
        onClick={(e) => { e.stopPropagation(); startNewProject(navigate); }}
        className="w-[120px] h-[56px] rounded-2xl bg-white hover:bg-[#f0f0f0] hover:scale-105 active:scale-95 shadow-[0_4px_24px_rgba(0,0,0,0.3)] flex items-center justify-center border-none cursor-pointer transition-all duration-200"
      >
        <PlusOutlined className="text-[24px] text-black" />
      </button>
      <span className="text-[15px] font-medium leading-6 text-[#d0d0d0] group-hover:scale-105 transition-transform duration-200">
        新建画布创作
      </span>
    </div>
  );
}
```

- [ ] **Step 5: 写 BannerCarousel 失败测试**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { BannerCarousel } from './BannerCarousel';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

const BANNERS = [
  { id: 'b1', title: '标题一', subtitle: null, linkUrl: null, imageUrl: 'http://x/1.jpg', sortOrder: 1 },
  { id: 'b2', title: null, subtitle: '副标题二', linkUrl: 'https://example.com', imageUrl: 'http://x/2.jpg', sortOrder: 2 },
];

describe('BannerCarousel', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
  afterEach(() => vi.useRealTimers());

  it('加载中显示骨架屏', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(<BannerCarousel />);
    expect(screen.getByTestId('banner-skeleton')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="banner-carousel"]')).toBeNull();
  });

  it('空数据不渲染任何内容', async () => {
    mockApiFetch.mockResolvedValue([]);
    const { container } = render(<BannerCarousel />);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="banner-carousel"]')).toBeNull();
  });

  it('多张：渲染图片、箭头、指示器，第一张可见', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '上一张' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳转到第 2 张' })).toBeInTheDocument();
    expect((screen.getAllByRole('img')[0] as HTMLElement).style.opacity).toBe('1');
    expect((screen.getAllByRole('img')[1] as HTMLElement).style.opacity).toBe('0');
    // 叠层防拦截：非当前张禁用指针事件（opacity:0 的元素仍会命中点击）
    expect((screen.getAllByRole('img')[0] as HTMLElement).style.pointerEvents).toBe('auto');
    expect((screen.getAllByRole('img')[1] as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('单张：无箭头无指示器', async () => {
    mockApiFetch.mockResolvedValue([BANNERS[0]]);
    render(<BannerCarousel />);
    await screen.findByTestId('banner-carousel');
    expect(screen.queryByRole('button', { name: '上一张' })).toBeNull();
    expect(screen.queryByRole('button', { name: '跳转到第 1 张' })).toBeNull();
  });

  it('5 秒自动切到下一张（fake timers）', async () => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    await screen.findAllByRole('img');
    expect((screen.getAllByRole('img')[0] as HTMLElement).style.opacity).toBe('1');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect((screen.getAllByRole('img')[0] as HTMLElement).style.opacity).toBe('0');
    expect((screen.getAllByRole('img')[1] as HTMLElement).style.opacity).toBe('1');
  });

  it('hover 暂停自动轮播', async () => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    await screen.findAllByRole('img');
    fireEvent.mouseEnter(screen.getByTestId('banner-carousel'));
    vi.advanceTimersByTime(10000);
    expect((screen.getAllByRole('img')[0] as HTMLElement).style.opacity).toBe('1');
  });

  it('点击指示器跳转', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getByRole('button', { name: '跳转到第 2 张' }));
    expect((screen.getAllByRole('img')[1] as HTMLElement).style.opacity).toBe('1');
  });

  it('点击配置了 linkUrl 的 Banner 新窗口打开（一次）', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    await screen.findAllByRole('img');
    fireEvent.click(screen.getAllByRole('img')[1]);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener noreferrer');
    openSpy.mockRestore();
  });

  it('全部图片加载失败：等价空态不渲染', async () => {
    mockApiFetch.mockResolvedValue(BANNERS);
    render(<BannerCarousel />);
    const imgs = await screen.findAllByRole('img');
    fireEvent.error(imgs[0]);
    fireEvent.error(imgs[1]);
    await waitFor(() => {
      expect(screen.queryByTestId('banner-carousel')).toBeNull();
    });
  });
});
```

实现备注：fake timers 下 `findAllByRole` 若因等待器与假时钟抖动，兜底写法是在状态更新后 `await vi.advanceTimersByTimeAsync(0)` 再断言。

- [ ] **Step 6: 实现 BannerCarousel**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { apiFetch } from '@/api/client';
import type { PublicHomeBanner } from '@flowweb/shared';

const AUTOPLAY_INTERVAL = 5000;

export function BannerCarousel() {
  const [banners, setBanners] = useState<PublicHomeBanner[] | null>(null); // null = 加载中
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicHomeBanner[]>('/home-banners/active')
      .then((items) => { if (!cancelled) setBanners(items); })
      .catch(() => { if (!cancelled) setBanners([]); });
    return () => { cancelled = true; };
  }, []);

  const list = (banners ?? []).filter((b) => !failed.has(b.id));
  const count = list.length;
  const current = count > 0 ? list[index % count] : null;

  const next = useCallback(() => setIndex((i) => (count ? (i + 1) % count : 0)), [count]);
  const prev = useCallback(() => setIndex((i) => (count ? (i - 1 + count) % count : 0)), [count]);

  useEffect(() => {
    if (banners === null || count <= 1 || paused) return;
    const timer = setInterval(next, AUTOPLAY_INTERVAL);
    return () => clearInterval(timer); // unmount/暂停均清理
  }, [banners, count, paused, next]);

  if (banners === null) {
    return <div data-testid="banner-skeleton" className="w-full aspect-[8/1] rounded-xl bg-[#1e1e1e] mb-3 animate-pulse" />;
  }
  if (!current) return null;

  const single = count === 1;
  const currentIndex = index % count;

  return (
    <div
      data-testid="banner-carousel"
      className="group relative w-full aspect-[8/1] rounded-xl overflow-hidden mb-3 bg-[#1e1e1e]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {list.map((b, i) => (
        <img
          key={b.id}
          src={b.imageUrl}
          alt={b.title ?? ''}
          onError={() => setFailed((prev) => { const s = new Set(prev); s.add(b.id); return s; })}
          onClick={() => { if (b.linkUrl) window.open(b.linkUrl, '_blank', 'noopener noreferrer'); }}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 cursor-pointer"
          style={{ opacity: i === currentIndex ? 1 : 0, pointerEvents: i === currentIndex ? 'auto' : 'none' }}
        />
      ))}

      {(current.title || current.subtitle) && (
        <div className="absolute inset-y-0 left-8 flex flex-col justify-center pointer-events-none z-10">
          {current.title && (
            <span className="text-[28px] font-bold text-white" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              {current.title}
            </span>
          )}
          {current.subtitle && <span className="text-sm text-white/80 mt-1">{current.subtitle}</span>}
        </div>
      )}

      {!single && (
        <>
          <button
            aria-label="上一张"
            onClick={prev}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <LeftOutlined className="text-base" />
          </button>
          <button
            aria-label="下一张"
            onClick={next}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center border-none cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <RightOutlined className="text-base" />
          </button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {list.map((b, i) => (
              <button
                key={b.id}
                aria-label={`跳转到第 ${i + 1} 张`}
                onClick={() => setIndex(i)}
                className={`rounded-full border-none cursor-pointer p-0 transition-all duration-300 ${
                  i === currentIndex ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 运行三组件测试确认通过**

```bash
cd apps/web && npx vitest run src/pages/home/components/Footer.test.tsx src/pages/home/components/CreateCanvasCard.test.tsx src/pages/home/components/BannerCarousel.test.tsx
```

Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/home/components
git commit -m "feat(web): 首页内容三组件——Banner 轮播/新建画布创作卡/Footer"
```

---

## Task 12: WeChatFollowModal + Sidebar（TDD）

**Files:**
- Create: `apps/web/src/components/layout/WeChatFollowModal.tsx`
- Create: `apps/web/src/components/layout/Sidebar.tsx`
- Test: `apps/web/src/components/layout/WeChatFollowModal.test.tsx`
- Test: `apps/web/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: 写 WeChatFollowModal 失败测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeChatFollowModal } from './WeChatFollowModal';

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, Modal: (p: { open: boolean; children: React.ReactNode }) => (p.open ? <div data-testid="modal-root">{p.children}</div> : null) };
});

describe('WeChatFollowModal', () => {
  it('open 时渲染标题、二维码与引导文案', () => {
    render(<WeChatFollowModal open onClose={vi.fn()} />);
    expect(screen.getByText('关注公众号')).toBeInTheDocument();
    expect(screen.getByAltText('公众号二维码')).toHaveAttribute('src', '/img/wechat-qrcode.jpg');
    expect(screen.getByText('扫码关注公众号，获取最新动态和专属福利')).toBeInTheDocument();
  });

  it('open=false 不渲染', () => {
    render(<WeChatFollowModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('modal-root')).toBeNull();
  });
});
```

- [ ] **Step 2: 实现 WeChatFollowModal**

```tsx
import { Modal } from 'antd';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WeChatFollowModal({ open, onClose }: Props) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={320}
      styles={{ content: { background: '#1e1e1e', borderRadius: 12, padding: '24px 16px' }, mask: { background: 'rgba(0,0,0,0.6)' } }}
    >
      <div className="flex flex-col items-center">
        <span className="text-base text-white">关注公众号</span>
        <img src="/img/wechat-qrcode.jpg" alt="公众号二维码" className="block w-[200px] h-[200px] rounded-lg mt-4" />
        <span className="text-xs text-[#707070] mt-4">扫码关注公众号，获取最新动态和专属福利</span>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: 写 Sidebar 失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Sidebar } from './Sidebar';

const mockInfo = vi.fn();
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return { ...actual, App: { ...actual.App, useApp: () => ({ message: { info: mockInfo } }) } };
});

describe('Sidebar', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  const renderSidebar = (initial = '/') =>
    render(
      <MemoryRouter initialEntries={[initial]}>
        <Sidebar topOffset={0} />
      </MemoryRouter>
    );

  it('渲染 Logo 与四项菜单', () => {
    renderSidebar();
    expect(screen.getByAltText('Flow123')).toHaveAttribute('src', '/img/LOGO.png');
    expect(screen.getByText('首页').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('模板广场').closest('a')).toHaveAttribute('href', '/templates');
    expect(screen.getByText('素材库').closest('a')).toHaveAttribute('href', '/materials');
    expect(screen.getByText('工作空间').closest('a')).toHaveAttribute('href', '/works');
  });

  it('当前页菜单高亮（/materials 下素材库激活）', () => {
    renderSidebar('/materials');
    const el = screen.getByText('素材库').closest('a');
    expect(el?.className).toContain('bg-[#262626]');
    const home = screen.getByText('首页').closest('a');
    expect(home?.className).not.toContain('bg-[#262626]');
  });

  it('新建项目：清 projectId（跳转由 startNewProject 单测覆盖）', () => {
    localStorage.setItem('flowweb_projectId', 'old');
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
  });

  it('公众号入口点击弹出二维码弹窗', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('wechat-follow-entry'));
    expect(screen.getByAltText('公众号二维码')).toBeInTheDocument();
  });

  it('文档中心点击 toast 敬请期待，不跳转', () => {
    renderSidebar();
    const doc = screen.getByRole('button', { name: /文档中心/ });
    expect(doc.closest('a')).toBeNull();
    fireEvent.click(doc);
    expect(mockInfo).toHaveBeenCalledWith('敬请期待');
  });
});
```

- [ ] **Step 4: 实现 Sidebar**

```tsx
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  AppstoreOutlined, FolderOutlined, HomeOutlined, PictureOutlined,
  PlusOutlined, QuestionCircleOutlined, WechatOutlined,
} from '@ant-design/icons';
import { App } from 'antd';
import { startNewProject } from '@/utils/startNewProject';
import { WeChatFollowModal } from './WeChatFollowModal';

const NAV_ITEMS = [
  { label: '首页', href: '/', icon: <HomeOutlined /> },
  { label: '模板广场', href: '/templates', icon: <AppstoreOutlined /> },
  { label: '素材库', href: '/materials', icon: <PictureOutlined /> },
  { label: '工作空间', href: '/works', icon: <FolderOutlined /> },
];

interface Props {
  /** 公告条区域总高：显示时 64，无公告时 0 */
  topOffset: number;
}

export function Sidebar({ topOffset }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [qrOpen, setQrOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside
      data-testid="sidebar"
      className="sticky left-0 self-start shrink-0 w-[240px] bg-[#141414] border-r border-[#262626] px-4 flex flex-col z-30"
      style={{ top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
    >
      <Link to="/" aria-label="首页" className="block pt-5 pb-4">
        <img src="/img/LOGO.png" alt="Flow123" className="block h-7 w-auto" />
      </Link>

      <button
        onClick={() => startNewProject(navigate)}
        className="h-9 w-full rounded-lg bg-[#00bfff] hover:brightness-110 text-black text-sm font-medium leading-5 flex items-center gap-2 px-2 border-none cursor-pointer transition-[filter] duration-150"
      >
        <span className="w-5 h-5 flex items-center justify-center">
          <PlusOutlined className="text-base" />
        </span>
        新建项目
      </button>

      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={`h-9 rounded-lg px-2 flex items-center gap-2 no-underline text-sm leading-5 transition-colors ${
              isActive(item.href)
                ? 'bg-[#262626] text-white font-medium'
                : 'text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white'
            }`}
          >
            <span className="w-5 h-5 flex items-center justify-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto pb-4 flex flex-col gap-1">
        <button
          data-testid="wechat-follow-entry"
          onClick={() => setQrOpen(true)}
          className="h-16 rounded-lg bg-[#1e1e1e] hover:bg-[#262626] flex items-center justify-between px-3 border-none cursor-pointer transition-colors"
        >
          <span className="flex flex-col items-start">
            <span className="text-xs font-medium text-white">关注公众号</span>
            <span className="text-[11px] text-[#707070] mt-0.5">获取最新动态和福利</span>
          </span>
          <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(7,193,96,0.1)' }}>
            <WechatOutlined className="text-lg" style={{ color: '#07c160' }} />
          </span>
        </button>
        <button
          onClick={() => message.info('敬请期待')}
          className="h-9 rounded-lg px-2 flex items-center gap-2 text-[13px] text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors"
        >
          <QuestionCircleOutlined className="text-base" />
          文档中心
        </button>
      </div>

      <WeChatFollowModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </aside>
  );
}
```

- [ ] **Step 5: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/components/layout/
```

Expected: PASS。

```bash
git add apps/web/src/components/layout
git commit -m "feat(web): 侧边栏+公众号弹窗——四菜单高亮/新建项目/敬请期待 toast"
```

---

## Task 13: TopActionBar（TDD）

**Files:**
- Create: `apps/web/src/components/layout/TopActionBar.tsx`
- Test: `apps/web/src/components/layout/TopActionBar.test.tsx`

- [ ] **Step 1: 写失败测试**

说明：AuthProvider 挂载时用**裸 fetch** 调 `/api/auth/me`（不走 apiFetch，已核实 AuthProvider.tsx:31），读 `data.user`。因此用 `vi.spyOn(globalThis, 'fetch')` 控制登录态：返回 `{ user: null }` = 未登录，返回用户对象 = 登录态。

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TopActionBar } from './TopActionBar';
import { AuthProvider } from '@/components/AuthProvider';
import { useCreditsStore } from '@/stores/creditsStore';

const mockOpen = vi.fn();
vi.mock('@/stores/vipModalStore', () => ({
  useVipModalStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { visible: false, open: mockOpen, close: vi.fn() };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/components/auth/LoginModal', () => ({
  LoginModal: () => <div data-testid="login-modal">LoginModal</div>,
}));
vi.mock('@/components/TeamSwitcher', () => ({
  TeamSwitcher: () => <div data-testid="team-switcher" />,
}));

const mockFetch = vi.spyOn(globalThis, 'fetch');
const asResponse = (body: unknown) => ({ json: async () => body }) as Response;

function renderBar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <TopActionBar />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('TopActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCreditsStore.setState({
      credits: 900,
      subscriptionCredits: 100,
      tier: 'pro',
      loading: false,
      error: null,
      scope: 'personal',
      teamId: null,
      subscriptionCreditsExpiry: null,
      fetchBalance: vi.fn().mockResolvedValue(undefined),
      fetchTeamBalance: vi.fn(),
      applyBalance: vi.fn(),
      isSubscriptionActive: () => true,
    });
  });

  it('未登录：赚积分链接/会员充值按钮/登录注册按钮', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('top-action-bar'));
    expect(screen.getByText('赚积分').closest('a')).toHaveAttribute('href', '/settings/credits');
    expect(screen.getByRole('button', { name: /会员充值/ })).toBeInTheDocument();
    expect(screen.getByTestId('login-register-btn')).toBeInTheDocument();
  });

  it('未登录点会员充值：直接 openVipModal（不拦登录）', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('login-register-btn'));
    fireEvent.click(screen.getByRole('button', { name: /会员充值/ }));
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('未登录点登录/注册：打开 LoginModal', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: null }));
    renderBar();
    await waitFor(() => screen.getByTestId('login-register-btn'));
    fireEvent.click(screen.getByTestId('login-register-btn'));
    expect(screen.getByTestId('login-modal')).toBeInTheDocument();
  });

  it('登录态：积分数字 toLocaleString+等级标签+头像+团队切换器，且触发 fetchBalance', async () => {
    mockFetch.mockResolvedValue(asResponse({ user: { id: 'u1', name: '张三', email: 'z@x.com' } }));
    renderBar();
    await waitFor(() => screen.getByTestId('user-avatar'));
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByTestId('team-switcher')).toBeInTheDocument();
    expect(useCreditsStore.getState().fetchBalance).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 实现 TopActionBar**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfigProvider, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { CrownOutlined, GiftOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '@/components/AuthProvider';
import { LoginModal } from '@/components/auth/LoginModal';
import { TeamSwitcher } from '@/components/TeamSwitcher';
import { useVipModalStore } from '@/stores/vipModalStore';
import { useCreditsStore } from '@/stores/creditsStore';

const TIER_LABEL: Record<string, string> = { basic: '普通', pro: 'Pro', max: 'Max', ultra: 'Ultra' };

const BTN = 'h-8 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] hover:bg-[#262626] hover:border-[#444] hover:text-white text-[13px] leading-5 text-[#d0d0d0] px-2.5 flex items-center gap-1 no-underline cursor-pointer transition-colors duration-150';

export function TopActionBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const openVipModal = useVipModalStore(s => s.open);
  const credits = useCreditsStore(s => s.credits);
  const subscriptionCredits = useCreditsStore(s => s.subscriptionCredits);
  const tier = useCreditsStore(s => s.tier);
  const fetchBalance = useCreditsStore(s => s.fetchBalance);

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  // 登录门控：fetchBalance 无 token 判断，公开组页面未登录不发请求（避免 401 噪音）
  useEffect(() => {
    if (user) void fetchBalance();
  }, [user, fetchBalance]);

  const totalCredits = credits + subscriptionCredits;
  const displayName = user?.name || user?.email || '?';
  const firstLetter = displayName.charAt(0).toUpperCase();
  const avatarUrl = user?.image;

  const avatarNode = (size: string) =>
    avatarUrl ? (
      <img src={avatarUrl} alt={displayName} className={`${size} rounded-full object-cover block`} />
    ) : (
      <span className={`${size} rounded-full bg-[#4ade80] text-black text-sm font-bold flex items-center justify-center`}>
        {firstLetter}
      </span>
    );

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'header',
      disabled: true,
      label: (
        <div className="flex items-center gap-3 px-2 py-1 min-w-[180px]">
          {avatarNode('w-10 h-10 text-sm')}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-[#e2e8f0] truncate">{displayName}</span>
            <span className="text-sm text-white">⚡ {totalCredits.toLocaleString()} 积分</span>
          </div>
        </div>
      ),
    },
    { type: 'divider' as const },
    { key: 'team', icon: <UserOutlined />, label: <Link to="/team" className="no-underline text-inherit">团队管理</Link> },
    { key: 'center', icon: <UserOutlined />, label: <Link to="/settings" className="no-underline text-inherit">用户中心</Link> },
    { key: 'settings', icon: <SettingOutlined />, label: <Link to="/settings/profile" className="no-underline text-inherit">个人设置</Link> },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: <span className="text-red-400">退出登录</span>,
      onClick: handleLogout,
    },
  ];

  return (
    <div data-testid="top-action-bar" className="h-14 flex items-center justify-end gap-2">
      <Link to="/settings/credits" className={BTN}>
        <GiftOutlined className="text-base text-[#a0a0a0]" /> 赚积分
      </Link>
      <button onClick={openVipModal} className={BTN}>
        <CrownOutlined className="text-base text-[#a0a0a0]" /> 会员充值
      </button>
      {user ? (
        <>
          <Link to="/settings/membership" className={BTN}>
            <span className="text-[13px] font-medium text-white">⚡ {totalCredits.toLocaleString()}</span>
            {tier && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                tier === 'ultra' ? 'bg-[#f59e0b] text-black'
                  : tier === 'max' ? 'bg-[#a855f7] text-white'
                  : tier === 'pro' ? 'bg-[#3b82f6] text-white'
                  : 'bg-[#9ca3af] text-black'
              }`}>
                {TIER_LABEL[tier] ?? tier}
              </span>
            )}
          </Link>
          <ConfigProvider
            theme={{
              components: {
                Dropdown: {
                  colorBgElevated: '#252525',
                  colorText: '#e2e8f0',
                  controlItemBgHover: '#3a3a3a',
                  borderRadiusLG: 12,
                  paddingXXS: 6,
                },
              },
            }}
          >
            <TeamSwitcher />
            <Dropdown
              menu={{ items: userMenuItems }}
              trigger={['hover']}
              placement="bottomRight"
              align={{ offset: [0, 6] }}
            >
              <span data-testid="user-avatar" className="cursor-pointer">{avatarNode('w-8 h-8')}</span>
            </Dropdown>
          </ConfigProvider>
        </>
      ) : (
        <button
          data-testid="login-register-btn"
          onClick={() => setShowLoginModal(true)}
          className="h-8 rounded-lg bg-white hover:bg-[#e8e8e8] text-black text-[13px] font-medium leading-5 px-4 border-none cursor-pointer transition-colors duration-150"
        >
          登录/注册
        </button>
      )}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/components/layout/TopActionBar.test.tsx
```

Expected: PASS（4 用例）。

```bash
git add apps/web/src/components/layout/TopActionBar.tsx apps/web/src/components/layout/TopActionBar.test.tsx
git commit -m "feat(web): 顶部操作栏——creditsStore 积分/未登录三按钮/VIP 全局触发"
```

---

## Task 14: AnnouncementBar（TDD）

**Files:**
- Create: `apps/web/src/components/layout/AnnouncementBar.tsx`
- Test: `apps/web/src/components/layout/AnnouncementBar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnouncementBar } from './AnnouncementBar';
import { useAnnouncementStore } from '@/stores/announcementStore';

const ANNOUNCEMENT = {
  id: 'a1',
  message: '平台公告：新功能上线',
  linkText: '了解更多',
  linkUrl: 'https://example.com',
  bgColor: '#0f2761',
  textColor: '#ffffff',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AnnouncementBar', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    useAnnouncementStore.setState({ announcement: ANNOUNCEMENT, loaded: true });
  });

  it('渲染公告文字与应用配色', () => {
    render(<AnnouncementBar />);
    const bar = screen.getByTestId('announcement-bar');
    expect(screen.getByText('平台公告：新功能上线')).toBeInTheDocument();
    expect(bar.style.backgroundColor).toBe('rgb(15, 39, 97)');
  });

  it('配置了链接时渲染链接按钮，点击只打开一次（不冒泡整栏）', () => {
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByTestId('announcement-link-btn'));
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('点内容区（无链接按钮处）也触发整栏跳转', () => {
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByText('平台公告：新功能上线'));
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener noreferrer');
  });

  it('关闭按钮：真实 dismiss 写 sessionStorage 并清空 store，不触发跳转', () => {
    // 不 mock dismiss——sessionStorage 写入逻辑在真实 action 内，mock 掉则断言其副作用必失败
    render(<AnnouncementBar />);
    fireEvent.click(screen.getByTestId('announcement-close-btn'));
    expect(openSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('announcement_dismissed_a1')).toBe('1');
    expect(useAnnouncementStore.getState().announcement).toBeNull();
  });

  it('无公告时不渲染', () => {
    useAnnouncementStore.setState({ announcement: null });
    const { container } = render(<AnnouncementBar />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 实现 AnnouncementBar**

```tsx
import { CloseOutlined } from '@ant-design/icons';
import { useAnnouncementStore } from '@/stores/announcementStore';

export function AnnouncementBar() {
  const announcement = useAnnouncementStore(s => s.announcement);
  const dismiss = useAnnouncementStore(s => s.dismiss);

  if (!announcement) return null;
  const { message, linkText, linkUrl, bgColor, textColor } = announcement;

  return (
    <div className="sticky top-0 z-40 p-2 bg-[#141414]">
      <div
        data-testid="announcement-bar"
        className="h-12 rounded-lg px-12 flex items-center justify-center gap-3 relative cursor-pointer"
        style={{ backgroundColor: bgColor, color: textColor }}
        onClick={() => { if (linkUrl) window.open(linkUrl, '_blank', 'noopener noreferrer'); }}
      >
        <span className="text-sm font-medium leading-[22px] truncate">{message}</span>
        {linkText && linkUrl && (
          <button
            data-testid="announcement-link-btn"
            onClick={(e) => {
              e.stopPropagation();
              window.open(linkUrl, '_blank', 'noopener noreferrer');
            }}
            className="shrink-0 rounded-full border bg-transparent hover:bg-white/10 text-[13px] leading-none px-3 py-1 cursor-pointer"
            style={{ color: textColor, borderColor: 'rgba(255,255,255,0.5)' }}
          >
            {linkText}
          </button>
        )}
        <button
          aria-label="关闭公告"
          data-testid="announcement-close-btn"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="absolute right-3 w-6 h-6 rounded-full hover:bg-white/10 flex items-center justify-center border-none cursor-pointer text-white/70 hover:text-white transition-colors"
        >
          <CloseOutlined className="text-sm" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/components/layout/AnnouncementBar.test.tsx
```

Expected: PASS（5 用例）。

```bash
git add apps/web/src/components/layout/AnnouncementBar.tsx apps/web/src/components/layout/AnnouncementBar.test.tsx
git commit -m "feat(web): 公告条——配色可配/链接与关闭双 stopPropagation"
```

---

## Task 15: AppLayout（TDD）

**Files:**
- Create: `apps/web/src/components/layout/AppLayout.tsx`
- Test: `apps/web/src/components/layout/AppLayout.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AppLayout } from './AppLayout';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { useVipModalStore } from '@/stores/vipModalStore';

vi.mock('./AnnouncementBar', () => ({
  AnnouncementBar: () => <div data-testid="announcement-bar-mock" />,
}));
vi.mock('./Sidebar', () => ({
  Sidebar: ({ topOffset }: { topOffset: number }) => <div data-testid="sidebar-mock" data-top={topOffset} />,
}));
vi.mock('./TopActionBar', () => ({
  TopActionBar: () => <div data-testid="top-action-bar-mock" />,
}));
vi.mock('@/components/VipSubscribeModal', () => ({
  VipSubscribeModal: () => <div data-testid="vip-modal-mock" />,
}));

function renderLayout(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<div>首页内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('AppLayout', () => {
  const fetchActive = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    useAnnouncementStore.setState({ announcement: null, loaded: false, fetchActive });
    useVipModalStore.setState({ visible: false });
  });

  it('挂载即调 fetchActive；渲染侧栏/操作栏/Outlet 内容', () => {
    renderLayout();
    expect(fetchActive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('top-action-bar-mock')).toBeInTheDocument();
    expect(screen.getByText('首页内容')).toBeInTheDocument();
  });

  it('无公告：侧栏 topOffset=0 且不渲染公告条', () => {
    renderLayout();
    expect(screen.getByTestId('sidebar-mock')).toHaveAttribute('data-top', '0');
    expect(screen.queryByTestId('announcement-bar-mock')).toBeNull();
  });

  it('有公告：渲染公告条且侧栏 topOffset=64', () => {
    useAnnouncementStore.setState({ announcement: { id: 'a1', message: 'm' } as never, loaded: true });
    renderLayout();
    expect(screen.getByTestId('announcement-bar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-mock')).toHaveAttribute('data-top', '64');
  });

  it('vipVisible 时渲染 VipSubscribeModal（全局挂载）', () => {
    useVipModalStore.setState({ visible: true });
    renderLayout();
    expect(screen.getByTestId('vip-modal-mock')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 实现 AppLayout**

```tsx
import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { useAnnouncementStore } from '@/stores/announcementStore';
import { useVipModalStore } from '@/stores/vipModalStore';
import { VipSubscribeModal } from '@/components/VipSubscribeModal';
import { AnnouncementBar } from './AnnouncementBar';
import { Sidebar } from './Sidebar';
import { TopActionBar } from './TopActionBar';

export function AppLayout() {
  const announcement = useAnnouncementStore(s => s.announcement);
  const fetchActive = useAnnouncementStore(s => s.fetchActive);
  const vipVisible = useVipModalStore(s => s.visible);

  useEffect(() => { void fetchActive(); }, [fetchActive]);

  const topOffset = announcement ? 64 : 0;

  return (
    <div className="min-w-[1200px] min-h-screen bg-[#141414] flex flex-col">
      <AnnouncementBar />
      <div className="flex flex-1 items-start">
        <Sidebar topOffset={topOffset} />
        <main className="flex-1 min-w-0 px-6">
          <div className="h-14 sticky z-20 bg-[#141414]" style={{ top: topOffset }}>
            <TopActionBar />
          </div>
          <Outlet />
        </main>
      </div>
      {vipVisible && <VipSubscribeModal />}
    </div>
  );
}
```

- [ ] **Step 3: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/components/layout/AppLayout.test.tsx
```

Expected: PASS（4 用例）。

```bash
git add apps/web/src/components/layout/AppLayout.tsx apps/web/src/components/layout/AppLayout.test.tsx
git commit -m "feat(web): AppLayout 布局骨架——公告条偏移联动/VIP 全局挂载"
```

---

## Task 16: HomePage 重写 + 首页死代码删除（TDD）

**Files:**
- Modify: `apps/web/src/pages/home/index.tsx`（整体替换）
- Modify: `apps/web/src/pages/home/page.test.tsx`（整体重写）
- Delete: `HeroSection.tsx/.test.tsx`、`ContentSection.tsx/.test.tsx`、`ContentCard.tsx/.test.tsx`
- Delete: `stores/contentStore.ts` + `stores/contentStore.test.ts`

- [ ] **Step 1: 重写 page.test.tsx（先失败）**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HomePage } from './index';
import { AuthProvider } from '@/components/AuthProvider';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({ apiFetch: vi.fn() }));
const mockApiFetch = vi.mocked(apiFetch);

describe('HomePage（新首页）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Banner 空态：轮播不渲染，聚焦创作卡与 Footer
    mockApiFetch.mockResolvedValue([]);
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <AuthProvider>
          <HomePage />
        </AuthProvider>
      </MemoryRouter>
    );

  it('渲染新建画布创作卡片', () => {
    renderPage();
    expect(screen.getByText('新建画布创作')).toBeInTheDocument();
  });

  it('渲染 Footer 备案信息', () => {
    renderPage();
    expect(screen.getByText('鲁ICP备2026030119号')).toBeInTheDocument();
  });

  it('渲染 AI 助手悬浮按钮', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /AI 助手/i })).toBeInTheDocument();
  });

  it('旧区块不复存在：无 Hero 标题/精选模板/Navbar', () => {
    renderPage();
    expect(screen.queryByText('开始创作')).toBeNull();
    expect(screen.queryByText('精选工作流模板')).toBeNull();
    expect(screen.queryByText(/Flow123/i)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd apps/web && npx vitest run src/pages/home/page.test.tsx
```

Expected: FAIL（无「新建画布创作」/仍有旧区块）。

- [ ] **Step 3: 重写 HomePage（index.tsx 整体替换）**

```tsx
import { AIAssistantFAB } from './components/AIAssistantFAB';
import { BannerCarousel } from './components/BannerCarousel';
import { CreateCanvasCard } from './components/CreateCanvasCard';
import { Footer } from './components/Footer';

export function HomePage() {
  return (
    <div>
      <BannerCarousel />
      <CreateCanvasCard />
      <Footer />
      <AIAssistantFAB />
    </div>
  );
}
```

- [ ] **Step 4: 删除死代码**

```bash
git rm apps/web/src/pages/home/components/HeroSection.tsx apps/web/src/pages/home/components/HeroSection.test.tsx
git rm apps/web/src/pages/home/components/ContentSection.tsx apps/web/src/pages/home/components/ContentSection.test.tsx
git rm apps/web/src/pages/home/components/ContentCard.tsx apps/web/src/pages/home/components/ContentCard.test.tsx
git rm apps/web/src/stores/contentStore.ts apps/web/src/stores/contentStore.test.ts
```

- [ ] **Step 5: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/pages/home/
```

Expected: PASS（page.test 新 4 用例 + AIAssistantFAB.test 绿；无文件再引用已删模块）。

```bash
git add -A apps/web/src
git commit -m "feat(web): 首页重写——Banner 轮播+创作卡+Footer，删除 Hero/精选模板/contentStore"
```

---

## Task 17: 路由重组 + 7 页清理 + Navbar 删除 + 旧测试清理

本任务是原子切换：路由接入 AppLayout、各页删 Navbar、删除 Navbar 模块、清理 mock 它的旧测试，必须同一提交完成，否则全库测试红。

**Files:**
- Modify: `apps/web/src/router.tsx`（整体替换）
- Modify: 7 个页面（删 Navbar 引用 + 外壳清理）
- Delete: `apps/web/src/pages/home/components/Navbar.tsx` + `Navbar.test.tsx`
- Modify: 6+1 个旧测试文件（删 Navbar mock）

- [ ] **Step 1: router.tsx 整体替换**

```tsx
import { createBrowserRouter, Navigate } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';
import { AdminPage } from '@/pages/admin';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { RequireAuth } from '@/components/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { SettingsLayout, ProfilePage, CreditsPage } from '@/pages/settings';
import { MembershipPage } from '@/pages/settings/MembershipPage';
import { TemplateMarketPage } from '@/pages/templates/TemplateMarketPage';
import { TemplatePreviewPage } from '@/pages/templates/TemplatePreviewPage';
import { WorkspacePage } from '@/pages/workspace/WorkspacePage';
import TeamPage from '@/pages/team/TeamPage';
import TeamBillingPage from '@/pages/team/TeamBillingPage';
import JoinPage from '@/pages/join/JoinPage';
import MaterialsPage from '@/pages/materials/MaterialsPage';

export const router = createBrowserRouter([
  {
    // 公开组：套 AppLayout
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/templates', element: <TemplateMarketPage /> },
      { path: '/templates/:id', element: <TemplatePreviewPage /> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> },   // 全屏编辑器，不套布局
      { path: '/admin', element: <AdminPage /> },     // 独立后台，不套布局
      {
        // 登录组：套 AppLayout
        element: <AppLayout />,
        children: [
          { path: '/team', element: <TeamPage /> },
          { path: '/team/:id/billing', element: <TeamBillingPage /> },
          { path: '/materials', element: <MaterialsPage /> },
          { path: '/works', element: <WorkspacePage /> },
          { path: '/works/:id', element: <TemplatePreviewPage /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/profile" replace /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'credits', element: <CreditsPage /> },
              { path: 'membership', element: <MembershipPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
```

- [ ] **Step 2: 逐页删 Navbar + 外壳清理（每页两处：import 行与 `<Navbar />` 行）**

| 文件 | 外壳替换（前 → 后） |
| --- | --- |
| `pages/workspace/WorkspacePage.tsx` | `<div className="min-h-screen bg-black text-white">` → `<div>`；内层 `className="mx-auto max-w-[1640px] pt-4"` → `className="pt-4"` |
| `pages/materials/MaterialsPage.tsx` | 同上模式：`min-h-screen bg-black text-white` 删；`mx-auto max-w-[1640px] pt-4` → `pt-4` |
| `pages/settings/SettingsLayout.tsx` | 外层 `min-h-screen bg-[#0f0f0f] flex flex-col overflow-x-hidden` → `flex flex-col`；内层 `flex-1 mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] w-full pt-6` → `flex-1 w-full pt-6`（内部三级 nav 保留不动） |
| `pages/team/TeamBillingPage.tsx` | 三处外壳：`<div className="min-h-screen bg-[#111]" />` → `<div />`；两处 `min-h-screen bg-[#111] text-white` → `text-white`（`max-w-4xl mx-auto p-8` 保留）。**两处 `<Navbar />`（54、98 行）均删** |
| `pages/templates/TemplateMarketPage.tsx` | `min-h-screen bg-[#0f0f0f]` 删（`<div>`）；`mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] py-8` → `py-8` |
| `pages/templates/TemplatePreviewPage.tsx` | `min-h-screen bg-[#0f0f0f]` 删（`<div>`）；内层约 46 行的 `max-w-[1640px] px-5 md:px-10 lg:px-[120px]` 宽度约束一并删（与其他页统一，全宽铺满主内容区） |
| `pages/team/TeamPage.tsx` | **四处**（145/150/162/223 行）：145 行 `min-h-screen bg-[#111] text-[#e2e8f0] p-10` → `text-[#e2e8f0] p-10`；150/162/223 行 `min-h-screen bg-[#111] text-[#e2e8f0]` → `text-[#e2e8f0]` |

每页同时删除 `import { Navbar } from '@/pages/home/components/Navbar';` 与 `<Navbar />` 行。

- [ ] **Step 3: 删除 Navbar**

```bash
git rm apps/web/src/pages/home/components/Navbar.tsx apps/web/src/pages/home/components/Navbar.test.tsx
```

- [ ] **Step 4: 清理旧测试中的 Navbar mock**

以下文件各删除 `vi.mock('@/pages/home/components/Navbar', () => {...});` 块（及若有对 Navbar 内容的断言）：

- `src/pages/materials/MaterialsPage.test.tsx`
- `src/pages/workspace/__tests__/WorkspacePage.test.tsx`
- `src/pages/workspace/__tests__/WorkspacePage.folder-create.test.tsx`
- `src/pages/team/TeamBillingPage.test.tsx`
- `src/pages/templates/TemplateMarketPage.test.tsx`
- `src/pages/templates/TemplatePreviewPage.test.tsx`
- `src/pages/settings/SettingsLayout.test.tsx`

mock 块形状示例（删除整段）：

```ts
vi.mock('@/pages/home/components/Navbar', () => ({
  Navbar: () => <div data-testid="navbar">Navbar</div>,
}));
```

- [ ] **Step 5: 全量测试 + 类型检查**

```bash
cd apps/web && pnpm test && npx tsc -b
```

Expected: 全绿 + 零类型错误。

- [ ] **Step 6: grep 验证零残留**

```bash
grep -rn "components/Navbar\|HeroSection\|ContentSection\|ContentCard\|contentStore\|AnnouncementBanner" apps/web/src --include="*.ts" --include="*.tsx"
```

Expected: 零输出。

套布局的 7 个页面外壳清零验证（防漏网）：

```bash
grep -n "min-h-screen" apps/web/src/pages/workspace/WorkspacePage.tsx apps/web/src/pages/materials/MaterialsPage.tsx apps/web/src/pages/settings/SettingsLayout.tsx apps/web/src/pages/team/TeamBillingPage.tsx apps/web/src/pages/team/TeamPage.tsx apps/web/src/pages/templates/TemplateMarketPage.tsx apps/web/src/pages/templates/TemplatePreviewPage.tsx
```

Expected: 零输出。

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): 路由接入 AppLayout 全站布局——7 页删 Navbar/外壳清理/旧测试摘除"
```

---

## Task 18: Admin 首页配置两子 tab（TDD）

**Files:**
- Modify: `apps/web/src/api/adminApi.ts`（追加方法）
- Create: `apps/web/src/pages/admin/components/AnnouncementManagementTab.tsx` + `.test.tsx`
- Create: `apps/web/src/pages/admin/components/HomeBannerManagementTab.tsx` + `.test.tsx`
- Modify: `apps/web/src/pages/admin/page.tsx`（新增 homepage section）

- [ ] **Step 1: adminApi.ts 追加（文件末尾）**

```ts
// ========== 首页配置 ==========

import type {
  AnnouncementInfo, HomeBannerInfo,
  CreateAnnouncementDto, UpdateAnnouncementDto,
  CreateHomeBannerDto, UpdateHomeBannerDto,
} from '@flowweb/shared';

export async function fetchAnnouncements(): Promise<AnnouncementInfo[]> {
  return apiFetch('/admin/announcements');
}

export async function createAnnouncement(data: CreateAnnouncementDto): Promise<AnnouncementInfo> {
  return apiFetch('/admin/announcements', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateAnnouncement(id: string, data: UpdateAnnouncementDto): Promise<AnnouncementInfo> {
  return apiFetch(`/admin/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteAnnouncement(id: string): Promise<void> {
  return apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' });
}

export async function fetchHomeBanners(): Promise<HomeBannerInfo[]> {
  return apiFetch('/admin/home-banners');
}

export async function createHomeBanner(data: CreateHomeBannerDto): Promise<HomeBannerInfo> {
  return apiFetch('/admin/home-banners', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateHomeBanner(id: string, data: UpdateHomeBannerDto): Promise<HomeBannerInfo> {
  return apiFetch(`/admin/home-banners/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteHomeBanner(id: string): Promise<void> {
  return apiFetch(`/admin/home-banners/${id}`, { method: 'DELETE' });
}

/** multipart 直传：不能走 apiFetch（硬编码 JSON Content-Type 会冲掉 boundary） */
export async function uploadHomeBannerImage(file: File): Promise<{ imageKey: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/admin/home-banners/upload', { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || '上传失败');
  }
  const body = await res.json();
  return body.data ?? body;
}
```

注意：`import type {...} from '@flowweb/shared'` 必须放在 adminApi.ts 文件顶部（与既有 import 合并），不要留在文件中部。

- [ ] **Step 2: 写 AnnouncementManagementTab 失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnouncementManagementTab } from './AnnouncementManagementTab';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/adminApi')>()),
  fetchAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
  deleteAnnouncement: vi.fn(),
}));
const mockFetch = vi.mocked(adminApi.fetchAnnouncements);
const mockUpdate = vi.mocked(adminApi.updateAnnouncement);

const confirmMock = { onOk: undefined as undefined | (() => void) };
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    App: { ...actual.App, useApp: () => ({ message: { success: vi.fn(), error: vi.fn() }, modal: { confirm: (o: { onOk: () => void }) => { confirmMock.onOk = o.onOk; } } }) },
  };
});

describe('AnnouncementManagementTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.onOk = undefined;
  });

  it('渲染公告列表', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0f2761', textColor: '#ffffff', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    render(<AnnouncementManagementTab />);
    expect(await screen.findByText('公告一')).toBeInTheDocument();
  });

  it('禁用开关：直接 PATCH active=false', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0', textColor: '#f', active: true, createdAt: '', updatedAt: '' },
    ]);
    mockUpdate.mockResolvedValue({} as never);
    render(<AnnouncementManagementTab />);
    await screen.findByText('公告一');
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a1', { active: false }));
  });

  it('启用开关：弹互斥确认，确认后才 PATCH active=true', async () => {
    mockFetch.mockResolvedValue([
      { id: 'a1', message: '公告一', linkText: null, linkUrl: null, bgColor: '#0', textColor: '#f', active: false, createdAt: '', updatedAt: '' },
    ]);
    mockUpdate.mockResolvedValue({} as never);
    render(<AnnouncementManagementTab />);
    await screen.findByText('公告一');
    fireEvent.click(screen.getByRole('switch'));
    expect(mockUpdate).not.toHaveBeenCalled();
    confirmMock.onOk?.();
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a1', { active: true }));
  });
});
```

- [ ] **Step 3: 实现 AnnouncementManagementTab**

```tsx
import { useEffect, useState } from 'react';
import { App, Button, Input, Modal, Switch } from 'antd';
import {
  createAnnouncement, deleteAnnouncement, fetchAnnouncements, updateAnnouncement,
} from '@/api/adminApi';
import type { AnnouncementInfo } from '@flowweb/shared';

const inputCls = 'bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full';

interface FormState {
  message: string;
  bgColor: string;
  textColor: string;
  linkText: string;
  linkUrl: string;
  active: boolean;
}

const EMPTY: FormState = { message: '', bgColor: '#0f2761', textColor: '#ffffff', linkText: '', linkUrl: '', active: false };

export function AnnouncementManagementTab() {
  const { message: messageApi, modal } = App.useApp();
  const [list, setList] = useState<AnnouncementInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AnnouncementInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList(await fetchAnnouncements()); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a: AnnouncementInfo) => {
    setEditing(a);
    setForm({
      message: a.message,
      bgColor: a.bgColor,
      textColor: a.textColor,
      linkText: a.linkText ?? '',
      linkUrl: a.linkUrl ?? '',
      active: a.active,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.message.trim()) { messageApi.error('公告内容不能为空'); return; }
    setSaving(true);
    try {
      const payload = {
        message: form.message,
        bgColor: form.bgColor,
        textColor: form.textColor,
        linkText: form.linkText || null,
        linkUrl: form.linkUrl || null,
        active: form.active,
      };
      if (editing) await updateAnnouncement(editing.id, payload);
      else await createAnnouncement(payload);
      messageApi.success('已保存');
      setOpen(false);
      void load();
    } catch (e) {
      messageApi.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (a: AnnouncementInfo, active: boolean) => {
    if (!active) {
      void updateAnnouncement(a.id, { active: false }).then(load);
      return;
    }
    modal.confirm({
      title: '启用该公告？',
      content: '启用后将自动禁用其他公告。',
      onOk: async () => {
        await updateAnnouncement(a.id, { active: true });
        messageApi.success('已启用，其他公告已自动禁用');
        void load();
      },
    });
  };

  const handleDelete = (a: AnnouncementInfo) => {
    modal.confirm({
      title: '删除该公告？',
      content: '删除后不可恢复。',
      onOk: async () => {
        await deleteAnnouncement(a.id);
        messageApi.success('已删除');
        void load();
      },
    });
  };

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button type="primary" onClick={openCreate} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}>
          新建公告
        </Button>
      </div>
      <div className="space-y-2">
        {list.map(a => (
          <div key={a.id} className="flex items-center gap-3 bg-[#1A1A1A] border border-[#333] rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#e2e8f0] truncate">{a.message}</div>
              <div className="text-xs text-[#666] mt-0.5">{new Date(a.createdAt).toLocaleString()}</div>
            </div>
            <Switch checked={a.active} checkedChildren="启用" unCheckedChildren="禁用" onChange={v => handleToggle(a, v)} />
            <Button size="small" onClick={() => openEdit(a)}>编辑</Button>
            <Button size="small" danger onClick={() => handleDelete(a)}>删除</Button>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[#666] text-sm py-12">暂无公告</div>}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑公告' : '新建公告'}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={480}
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs text-[#888] block mb-1">公告内容（≤200 字）</label>
            <Input.TextArea value={form.message} maxLength={200} rows={2}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">背景色</label>
              <input className={inputCls} value={form.bgColor} placeholder="#0f2761"
                onChange={e => setForm(f => ({ ...f, bgColor: e.target.value }))} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">文字色</label>
              <input className={inputCls} value={form.textColor} placeholder="#ffffff"
                onChange={e => setForm(f => ({ ...f, textColor: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">链接按钮文字（可选）</label>
              <input className={inputCls} value={form.linkText} maxLength={32}
                onChange={e => setForm(f => ({ ...f, linkText: e.target.value }))} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">链接地址（可选）</label>
              <input className={inputCls} value={form.linkUrl} maxLength={500} placeholder="https://..."
                onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
            <span className="text-xs text-[#ccc]">保存后立即启用（将自动禁用其他公告）</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: 写 HomeBannerManagementTab 失败测试**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeBannerManagementTab } from './HomeBannerManagementTab';
import * as adminApi from '@/api/adminApi';

vi.mock('@/api/adminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/adminApi')>()),
  fetchHomeBanners: vi.fn(),
  createHomeBanner: vi.fn(),
  updateHomeBanner: vi.fn(),
  deleteHomeBanner: vi.fn(),
  uploadHomeBannerImage: vi.fn(),
}));
const mockFetch = vi.mocked(adminApi.fetchHomeBanners);

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    App: { ...actual.App, useApp: () => ({ message: { success: vi.fn(), error: vi.fn() }, modal: { confirm: vi.fn() } }) },
  };
});

describe('HomeBannerManagementTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('渲染 Banner 列表（缩略图+标题+排序）', async () => {
    mockFetch.mockResolvedValue([
      {
        id: 'b1', title: '活动一', subtitle: null, linkUrl: null,
        imageKey: 'uploads/system/a.jpg', imageUrl: 'http://minio/a.jpg',
        sortOrder: 1, active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    render(<HomeBannerManagementTab />);
    expect(await screen.findByText('活动一')).toBeInTheDocument();
    expect(screen.getByAltText('活动一')).toHaveAttribute('src', 'http://minio/a.jpg');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('渲染新建 Banner 按钮', async () => {
    mockFetch.mockResolvedValue([]);
    render(<HomeBannerManagementTab />);
    await screen.findByText('暂无 Banner');
    expect(screen.getByRole('button', { name: '新建 Banner' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: 实现 HomeBannerManagementTab**

```tsx
import { useEffect, useRef, useState } from 'react';
import { App, Button, InputNumber, Modal, Switch } from 'antd';
import {
  createHomeBanner, deleteHomeBanner, fetchHomeBanners, updateHomeBanner, uploadHomeBannerImage,
} from '@/api/adminApi';
import type { HomeBannerInfo } from '@flowweb/shared';

const inputCls = 'bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full';

interface FormState {
  title: string;
  subtitle: string;
  linkUrl: string;
  imageKey: string;
  sortOrder: number;
  active: boolean;
}

const EMPTY: FormState = { title: '', subtitle: '', linkUrl: '', imageKey: '', sortOrder: 0, active: true };

export function HomeBannerManagementTab() {
  const { message: messageApi, modal } = App.useApp();
  const [list, setList] = useState<HomeBannerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HomeBannerInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { setList(await fetchHomeBanners()); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setFileName(''); setOpen(true); };
  const openEdit = (b: HomeBannerInfo) => {
    setEditing(b);
    setForm({
      title: b.title ?? '',
      subtitle: b.subtitle ?? '',
      linkUrl: b.linkUrl ?? '',
      imageKey: b.imageKey ?? '',
      sortOrder: b.sortOrder,
      active: b.active,
    });
    setFileName('');
    setOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { messageApi.error('仅支持 jpg/png/webp'); return; }
    if (file.size > 5 * 1024 * 1024) { messageApi.error('文件 ≤ 5MB'); return; }
    setUploading(true);
    try {
      const { imageKey } = await uploadHomeBannerImage(file);
      setForm(f => ({ ...f, imageKey }));
      setFileName(file.name);
      messageApi.success('上传成功');
    } catch (err) {
      messageApi.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.imageKey) { messageApi.error('请先上传图片'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title || null,
        subtitle: form.subtitle || null,
        linkUrl: form.linkUrl || null,
        imageKey: form.imageKey,
        sortOrder: form.sortOrder,
        active: form.active,
      };
      if (editing) await updateHomeBanner(editing.id, payload);
      else await createHomeBanner(payload);
      messageApi.success('已保存');
      setOpen(false);
      void load();
    } catch (e) {
      messageApi.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (b: HomeBannerInfo, active: boolean) => {
    void updateHomeBanner(b.id, { active }).then(() => {
      messageApi.success(active ? '已启用' : '已禁用');
      void load();
    });
  };

  const handleDelete = (b: HomeBannerInfo) => {
    modal.confirm({
      title: '删除该 Banner？',
      content: '服务器上的图片文件将一并删除。',
      onOk: async () => {
        await deleteHomeBanner(b.id);
        messageApi.success('已删除');
        void load();
      },
    });
  };

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button type="primary" onClick={openCreate} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}>
          新建 Banner
        </Button>
      </div>
      <div className="space-y-2">
        {list.map(b => (
          <div key={b.id} className="flex items-center gap-3 bg-[#1A1A1A] border border-[#333] rounded-lg px-4 py-3">
            {b.imageUrl ? (
              <img src={b.imageUrl} alt={b.title ?? 'Banner'} className="w-40 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-40 h-10 rounded bg-[#252525] shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#e2e8f0] truncate">{b.title || '（无标题）'}</div>
              <div className="text-xs text-[#666] mt-0.5 truncate">排序 {b.sortOrder} · {b.linkUrl || '无链接'}</div>
            </div>
            <Switch checked={b.active} onChange={v => handleToggle(b, v)} />
            <Button size="small" onClick={() => openEdit(b)}>编辑</Button>
            <Button size="small" danger onClick={() => handleDelete(b)}>删除</Button>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[#666] text-sm py-12">暂无 Banner</div>}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑 Banner' : '新建 Banner'}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={520}
      >
        <div className="space-y-3 pt-2">
          <div className="border-t border-[#333] pt-3">
            <label className="text-xs text-[#888] block mb-1">图片（建议 1920×240，8:1 比例，≤5MB）</label>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} />
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1.5 rounded text-xs bg-[#252525] border border-[#555] text-[#ccc] hover:border-[#4ade80] transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? '上传中...' : '选择文件'}
              </button>
              <span className="text-xs text-[#4ade80]">{fileName || (form.imageKey ? '已有图片（可替换）' : 'jpg/png/webp, ≤5MB')}</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-[#888] block mb-1">标题（可选）</label>
            <input className={inputCls} value={form.title} maxLength={128}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-[#888] block mb-1">副标题（可选）</label>
            <input className={inputCls} value={form.subtitle} maxLength={256}
              onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">跳转链接（可选）</label>
              <input className={inputCls} value={form.linkUrl} maxLength={500} placeholder="https://..."
                onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-[#888] block mb-1">排序</label>
              <InputNumber min={0} value={form.sortOrder}
                onChange={v => setForm(f => ({ ...f, sortOrder: v ?? 0 }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
            <span className="text-xs text-[#ccc]">启用（在首页轮播中显示）</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
```

实现备注：两个 tab 均用自定义卡片式列表（与现有 admin 组件风格一致），而非 spec 第 6 节初稿提到的 antd Table——功能等价，属有意偏离，PR 描述登记。

- [ ] **Step 6: admin/page.tsx 接入新 section**

1. `section` state 类型改为 `'models' | 'subscription' | 'settings' | 'homepage'`
2. 新增 `homeSubTab` state：`useState<'announcement' | 'banners'>('announcement')`
3. 顶级按钮数组改为 `(['models', 'subscription', 'homepage', 'settings'] as const)`，按钮文案映射加 `homepage ? '首页配置'`
4. 渲染块新增：

```tsx
{section === 'homepage' && (
  <div>
    <div className="flex gap-2 mb-6">
      {(['announcement', 'banners'] as const).map(t => (
        <button key={t} onClick={() => setHomeSubTab(t)}
          className={`px-3 py-1 rounded text-xs border border-[#444] cursor-pointer transition-colors ${
            homeSubTab === t ? 'bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]' : 'bg-[#1A1A1A] text-[#888] hover:text-white'
          }`}
        >
          {t === 'announcement' ? '公告条' : '首页 Banner'}
        </button>
      ))}
    </div>
    {homeSubTab === 'announcement' && <AnnouncementManagementTab />}
    {homeSubTab === 'banners' && <HomeBannerManagementTab />}
  </div>
)}
```

顶部 import：`import { AnnouncementManagementTab } from './components/AnnouncementManagementTab'; import { HomeBannerManagementTab } from './components/HomeBannerManagementTab';`

- [ ] **Step 7: 运行确认通过 + Commit**

```bash
cd apps/web && npx vitest run src/pages/admin/
```

Expected: PASS（新旧 admin 测试全绿）。

```bash
git add apps/web/src/api/adminApi.ts apps/web/src/pages/admin
git commit -m "feat(web): admin 首页配置——公告条/Banner 管理 tab+上传直传"
```

---

## Task 19: 终验（四硬门 + 浏览器验收）

- [ ] **Step 1: 后端全量**

```bash
cd apps/api && pnpm test
```

Expected: tsc 零错 + vitest 全绿。

- [ ] **Step 2: 前端全量 + 类型**

```bash
cd apps/web && pnpm test && npx tsc -b
```

Expected: vitest 全绿 + 零类型错误。

- [ ] **Step 3: 六死名 grep 清零**

```bash
grep -rn "components/Navbar\|HeroSection\|ContentSection\|ContentCard\|contentStore\|AnnouncementBanner" apps/web/src --include="*.ts" --include="*.tsx"
```

Expected: 零输出。

- [ ] **Step 4: 静态资源可访问**

```bash
ls apps/web/public/img
```

Expected: `LOGO.png` 与 `wechat-qrcode.jpg`；dev server 启动后 `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/img/LOGO.png` 返回 200。

- [ ] **Step 5: 浏览器可视化验收（与用户协作）**

启动前后端（按项目启动流程），在浏览器中验证：
1. 首页：侧边栏/操作栏/Banner 轮播/创作卡/Footer/公告条（admin 启用一条后显示）
2. 公告条：关闭后会话内不再显示；链接按钮单开一次
3. admin：首页配置两个子 tab 的 CRUD 全流程（含 Banner 上传与删除）
4. 7 个布局页导航一致、侧栏高亮正确；`/canvas` `/admin` 无布局
5. 未登录三按钮行为（赚积分→登录页、会员充值→VIP 弹窗、登录/注册→LoginModal）

- [ ] **Step 6: 最终提交（如有收尾修改）**

```bash
git add -A && git commit -m "chore(web): 首页重做收尾"
```
