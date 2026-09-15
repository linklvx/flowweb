# 视频作品展示页（Video Works）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公开免登录的视频作品展示页 `/videos`（列表 + 全屏播放 Modal + 创作过程快照 + 画布克隆）+ Admin 策展后台 + by-key 兑换口前置修复。

**Architecture:** 独立功能岛 `modules/video-work/`（公开+admin 双 controller 共用 service，样板参照 home-banner）；快照与克隆共用同一白名单纯函数；presign 3600s 直连 + /flowai 同源改写；单路由 `/videos/:id?` 驱动 Modal。

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL + Redis + MinIO；React 18 + antd 5.22.5 + @xyflow/react v12 + Tailwind；Vitest 全栈 strict TS。

**Spec:** `docs/superpowers/specs/2026-09-16-video-works-design.md`（449 行，六轮审核冻结）。执行本 plan 前须通读 spec 的 D1-D18 决策与 §4.6 白名单表、§4.7 克隆伪代码——本 plan 引用其结论不重复论证。

**TDD 铁律:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。每任务红-绿-提交。测试命令：api `pnpm --filter @flowweb/api test`；web `pnpm --filter @flowweb/web test`（tsc 检查含在各自 test/build 内）。纯文件操作类任务（migration/DB 核查）无测试对象，按步骤执行但验证不可省。

---

## 文件结构总览

```
apps/api/src/modules/video-work/
├── video-work.module.ts                  # Task 1.3
├── video-work.service.ts                 # CRUD+公开查询+计数+快照构造（Task 2.3/2.4/3.2/3.3/4.2/4.3/5.3）
├── video-work.controller.ts              # 公开 @Controller('api/video-works')（Task 3.x/4.x/5.3/6.2）
├── admin-video-work.controller.ts        # @Controller('api/admin/video-works')（Task 2.x）
├── video-work-clone.service.ts           # 克隆编排（Task 6.1）
├── snapshot-filter.util.ts               # 快照/克隆共用白名单纯函数（Task 5.1）
├── dto/create-video-work.dto.ts          # Task 2.3
├── dto/update-video-work.dto.ts          # Task 2.3
├── dto/video-category.dto.ts             # Task 2.1
├── dto/video-tag.dto.ts                  # Task 2.1
├── video-work.service.spec.ts
├── video-work.controller.spec.ts
├── admin-video-work.controller.spec.ts
├── video-work-clone.service.spec.ts
└── snapshot-filter.util.spec.ts

packages/shared/src/types/video-work.ts   # 前后端共享响应类型（Task 1.2）

apps/web/src/
├── api/videoWorkApi.ts                   # Task 7.1
├── pages/videos/
│   ├── VideosPage.tsx                    # 列表（Task 7.2）
│   ├── VideoCard.tsx                     # 卡片（Task 7.2）
│   ├── VideoPlayerModal.tsx              # 播放 Modal（Task 8.1/8.2）
│   ├── CarouselBar.tsx                   # 底部轮播（Task 8.3）
│   ├── ProcessSnapshot.tsx               # 只读画布（Task 9.1）
│   └── __tests__/*.test.tsx
├── pages/admin/pages/VideoWorksPage.tsx  # 后台管理（Task 10.1/10.2）
├── router.tsx / components/layout/Sidebar.tsx / index.css   # Task 7.3 修改

修改的既有文件（对账清单，与 spec §4.1 一致）：
- apps/api/src/modules/media/media.service.ts + media.controller.ts（批次 0）
- apps/api/src/common/services/rate-limiter.service.ts + .spec.ts（Task 4.1）
- apps/api/src/auth/auth.guard.ts（Task 3.1，+1 行）
- apps/api/src/app.module.ts（Task 1.3）
- apps/api/prisma/schema.prisma（Task 1.1）
- apps/web/src/router.tsx / Sidebar.tsx / index.css（Task 7.3）
```

---

## 批次 0：by-key 兑换口修复（D17，D10 前提）

### Task 0.1: 运行时数据核查（SubscriptionBanner.backgroundImageKey）

**Files:** 无代码改动；产出核查记录（写入本 plan 的执行记录或 PR 描述）。

- [ ] **Step 1: 查询存量 key**

```bash
psql "postgresql://flowweb:123456@localhost:5432/flowweb" -c 'SELECT id, "backgroundImageKey" FROM "SubscriptionBanner" WHERE "backgroundImageKey" IS NOT NULL;'
```

Expected: 列出所有非空 key。

- [ ] **Step 2: 逐个比对前缀**

规则：每个 key 必须 `startsWith('uploads/system/')`。全部符合 → 记录"核查通过"。
若有不符合（如 `uploads/banner-bg.png`）：在 admin 后台重新上传封面覆盖该值（走 admin-banner 上传端点会自动生成规范 key），或在本 plan 执行记录中登记"已知视觉回退"并知会用户。

- [ ] **Step 3: 无需提交（纯核查），记录结果供批次 0 验收引用**

### Task 0.2: MediaService.getPresignedUrlByKey（TDD）

**Files:**
- Modify: `apps/api/src/modules/media/media.service.ts`
- Test: `apps/api/src/modules/media/media.service.spec.ts`（已存在，追加用例）

- [ ] **Step 1: 写失败测试（追加到 media.service.spec.ts）**

```ts
describe('getPresignedUrlByKey', () => {
  it('uploads/system/ 前缀放行并 presign 同一个规范化值', async () => {
    const key = 'uploads/system/2026-01-01/abc.png';
    mediaService['minio'].generatePresignedGetUrl = vi.fn().mockResolvedValue('http://minio/url');
    const url = await mediaService.getPresignedUrlByKey(`  ${key}  `); // 带空白验证 trim
    expect(url).toBe('http://minio/url');
    expect(mediaService['minio'].generatePresignedGetUrl).toHaveBeenCalledWith(key, 900); // 签名用 trim 后的同一值
  });

  it('非 system 前缀一律 403（含登录场景语义，方法级不区分）', async () => {
    await expect(mediaService.getPresignedUrlByKey('uploads/user1/a.png')).rejects.toThrow(ForbiddenException);
    await expect(mediaService.getPresignedUrlByKey('results/user1/p/n/x.mp4')).rejects.toThrow(ForbiddenException);
  });

  it('尾斜杠边界：uploads/systematic-x 不放行', async () => {
    await expect(mediaService.getPresignedUrlByKey('uploads/systematic-x/evil.png')).rejects.toThrow(ForbiddenException);
  });

  it('空 key 拒绝', async () => {
    await expect(mediaService.getPresignedUrlByKey('   ')).rejects.toThrow(BadRequestException);
  });
});
```

注意：mock 装配沿用该 spec 文件既有的 Prisma/Minio/Redis 替身（文件顶部已有）；`ForbiddenException/BadRequestException` 从 `@nestjs/common` 导入。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- media.service.spec`
Expected: FAIL（getPresignedUrlByKey 不存在，TS 编译错误即红）

- [ ] **Step 3: 实现（media.service.ts 追加方法）**

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common'; // 顶部补导入

/** 公开 by-key 兑换（唯一合法域：运营公开素材 uploads/system/）。
 *  仅 trim 规范化（禁止二次解码——Express 已解码一次，再解 %2F..%2F 会绕过前缀），
 *  校验与签名必须用同一个 normalized 值。其余 key 一律 403（正路是 GET /api/media/:fileId/url）。 */
async getPresignedUrlByKey(rawKey: string): Promise<string> {
  const key = (rawKey ?? '').trim();
  if (!key) throw new BadRequestException('key is required');
  if (!key.startsWith('uploads/system/')) throw new ForbiddenException();
  return this.minio.generatePresignedGetUrl(key, 900);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api test -- media.service.spec`
Expected: PASS 全绿

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/media/media.service.ts apps/api/src/modules/media/media.service.spec.ts
git commit -m "feat(video-work): 批次0 MediaService.getPresignedUrlByKey——by-key 收窄为 uploads/system/ 前缀放行"
```

### Task 0.3: controller 改调 service（消除绕过 service 层）

**Files:**
- Modify: `apps/api/src/modules/media/media.controller.ts:23-28`（getUrlByKey 方法）

- [ ] **Step 1: 修改 controller（该文件无既有 controller spec，行为已由 Task 0.2 service 用例覆盖）**

```ts
@Get('by-key')
async getUrlByKey(@Query('key') key: string) {
  const url = await this.mediaService.getPresignedUrlByKey(key); // 校验下沉 service，controller 变薄
  return { url };
}
```

同时删除该方法内原有的 `if (!key) throw new BadRequestException(...)`（service 已做）与对 `this.minioService` 的直接调用；若 minioService 在该 controller 其他方法仍用则保留注入，否则删除注入。

- [ ] **Step 2: 全量 api 测试**

Run: `pnpm --filter @flowweb/api test`
Expected: PASS（含既有全部用例）

- [ ] **Step 3: 手工端到端验收（批次 0 验收项）**

本地起 api + web 后，浏览器**未登录**打开 `http://localhost:5173/` → 打开会员订阅弹窗 → banner 正常显示图片（非默认渐变）；DevTools Network 中 `/api/media/by-key` 请求返回 200。
再手工验证反例：`curl "http://localhost:3000/api/media/by-key?key=results/user1/a.mp4"` → 403。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/media/media.controller.ts
git commit -m "feat(video-work): 批次0 by-key controller 改调 service（校验下沉，D17）"
```

---

## 批次 1：Schema + Shared 类型 + 模块骨架

### Task 1.1: Prisma schema 四张表 + Media 候选索引 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（文件末尾追加模型；Media model 内追加索引）

- [ ] **Step 1: 追加 4 个 model（schema.prisma 末尾）**

```prisma
enum VideoWorkStatus {
  DRAFT
  PUBLISHED
}

model VideoWork {
  id               String          @id @default(cuid())
  title            String          @db.VarChar(200)
  description      String?         @db.Text
  authorName       String          @db.VarChar(64)
  categoryId       String?
  category         VideoCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  videoKey         String          @db.VarChar(512)
  videoMediaId     String?
  coverKey         String?         @db.VarChar(512)
  canvasProjectId  String?

  durationSec      Int?
  width            Int?
  height           Int?

  viewCount        Int             @default(0)
  likeCount        Int             @default(0)
  tags             String[]        @default([])
  sortOrder        Int             @default(0)
  status           VideoWorkStatus @default(DRAFT)
  allowViewProcess Boolean         @default(false)
  allowClone       Boolean         @default(false)
  publishedAt      DateTime?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([status, sortOrder, publishedAt(sort: Desc)])
  @@index([categoryId, status])
}

model VideoCategory {
  id        String      @id @default(cuid())
  name      String      @db.VarChar(64) @unique
  sortOrder Int         @default(0)
  active    Boolean     @default(true)
  works     VideoWork[]
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([active, sortOrder])
}

model VideoTag {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(32) @unique
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}

model VideoWorkSetting {
  id              String   @id @default("singleton")
  carouselEnabled Boolean  @default(true)
  carouselScope   String   @default("all")
  updatedAt       DateTime @updatedAt
}
```

- [ ] **Step 2: Media model 追加候选索引（声明式，保 migrate diff 零差异）**

在 `model Media` 的现有 `@@index` 行旁追加：

```prisma
  @@index([type, status, deletedAt])
```

- [ ] **Step 3: 生成 migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --name add_video_work
```

Expected: 生成新 migration 目录（本地时间戳前缀，含 5 张表 DDL + Media 索引）；`prisma generate` 自动执行。

- [ ] **Step 4: 验证 diff 零差异**

```bash
cd apps/api && pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$(grep DATABASE_URL .env | cut -d= -f2 | sed 's/flowweb$/flowweb_shadow/')" 2>/dev/null || echo "shadow db 不存在时用 migrate status 代替"
pnpm exec prisma migrate status
```

Expected: `migrate status` 显示全部 migration applied（含新的 add_video_work），无 pending。

- [ ] **Step 5: 全量测试 + Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(video-work): 批次1 schema——VideoWork/VideoCategory/VideoTag/VideoWorkSetting 四表 + Media 候选索引"
```

### Task 1.2: Shared 响应类型

**Files:**
- Create: `packages/shared/src/types/video-work.ts`
- Modify: `packages/shared/src/index.ts`（barrel 追加 1 行）

- [ ] **Step 1: 写类型文件（纯类型无测试对象，编译即验证）**

```ts
/** 视频作品展示（spec 2026-09-16 §4.2 契约） */

export interface VideoWorkListItem {
  id: string;
  title: string;
  coverUrl: string | null;
  durationSec: number | null;
  tags: string[];
}

export interface VideoWorkDetail extends VideoWorkListItem {
  videoUrl: string;
  categoryId: string | null;
  viewCount: number;
  likeCount: number;
  liked: boolean;
  description: string | null;
  authorName: string;
  publishedAt: string | null; // PUBLISHED 恒非空；UI 依赖服务端保证，勿用 ! 断言
  width: number | null;
  height: number | null;
  canViewProcess: boolean;
  canClone: boolean;
}

export interface VideoWorkListResult {
  items: VideoWorkListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VideoCategoryItem {
  id: string;
  name: string;
  sortOrder: number;
}

export type CarouselScope = 'all' | 'category';

export interface VideoWorkSettings {
  carouselEnabled: boolean;
  carouselScope: CarouselScope;
}

/** 创作过程快照（§4.6）——data 为白名单后字段，未知类型仅结构字段 */
export interface SnapshotNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
}

export interface ProcessSnapshotData {
  workId: string;
  title: string;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export interface CandidateMedia {
  id: string;
  key: string;
  projectId: string | null;
  canvasExists: boolean;
  thumbnailKey: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  previewUrl: string | null;
}
```

- [ ] **Step 2: barrel 追加导出（packages/shared/src/index.ts）**

```ts
export * from './types/video-work';
```

- [ ] **Step 3: 验证编译并提交**

```bash
pnpm --filter @flowweb/shared build 2>/dev/null || cd packages/shared && pnpm exec tsc --noEmit
git add packages/shared/src/types/video-work.ts packages/shared/src/index.ts
git commit -m "feat(video-work): 批次1 shared 响应类型"
```

### Task 1.3: 模块骨架 + app.module 注册

**Files:**
- Create: `apps/api/src/modules/video-work/video-work.module.ts`
- Create: `apps/api/src/modules/video-work/video-work.service.ts`（空壳）
- Create: `apps/api/src/modules/video-work/video-work.controller.ts`（空壳）
- Create: `apps/api/src/modules/video-work/admin-video-work.controller.ts`（空壳）
- Modify: `apps/api/src/app.module.ts`（imports 数组 + VideoWorkModule）

- [ ] **Step 1: 创建空壳文件**

```ts
// video-work.module.ts
import { Module } from '@nestjs/common';
import { VideoWorkController } from './video-work.controller';
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { ProjectModule } from '../project/project.module';
import { CollabModule } from '../collab/collab.module';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT'; // 模块自备（spec §4.9，先例 media.module.ts）

@Module({
  imports: [ProjectModule, CollabModule],
  controllers: [VideoWorkController, AdminVideoWorkController],
  providers: [
    VideoWorkService,
    { provide: REDIS_CLIENT, useFactory: () => new Redis(process.env.REDIS_URL), inject: [] },
    { provide: RateLimiterService, useFactory: (redis) => new RateLimiterService(redis), inject: [REDIS_CLIENT] },
  ],
})
export class VideoWorkModule {}
```

注意：`VideoWorkCloneService` 在 Task 6.1 才创建——本步骤先不 import 它，Task 6.1 再加入 providers。看 media.module.ts 的 REDIS_CLIENT 提供方式并保持一致（若 app 级已有全局 REDIS_CLIENT provider 直接 `@Inject('REDIS_CLIENT')` 即可，以实际代码为准——**实施时先 `grep -n "REDIS_CLIENT" apps/api/src/app.module.ts apps/api/src/modules/media/media.module.ts` 确认提供模式**，择既有模式复制）。

```ts
// video-work.service.ts（空壳，后续任务填充）
import { Injectable } from '@nestjs/common';

@Injectable()
export class VideoWorkService {
  // Task 2.x/3.x/4.x/5.3 逐步填充
}
```

```ts
// video-work.controller.ts（空壳）
import { Controller } from '@nestjs/common';

@Controller('api/video-works')
export class VideoWorkController {
  // Task 3.x/4.x/5.3/6.2 逐步填充
}
```

```ts
// admin-video-work.controller.ts（空壳）
import { Controller } from '@nestjs/common';

@Controller('api/admin/video-works')
export class AdminVideoWorkController {
  // Task 2.x 逐步填充
}
```

- [ ] **Step 2: app.module.ts imports 数组追加 `VideoWorkModule`**（找到既有 modules import 列表，按字母序或文件尾惯例插入 + 顶部 import）

- [ ] **Step 3: 验证 api 可启动 + 全量测试**

```bash
pnpm --filter @flowweb/api test
```

Expected: 编译通过、全部既有用例 PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/video-work/ apps/api/src/app.module.ts
git commit -m "feat(video-work): 批次1 模块骨架（双 controller 空壳 + module 注册）"
```

---

## 批次 2：Admin API（类型/标签/候选/作品 CRUD/封面上传/设置）

### Task 2.1: VideoCategory + VideoTag CRUD（TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/dto/video-category.dto.ts`、`dto/video-tag.dto.ts`
- Modify: `video-work.service.ts`（追加 category/tag CRUD 方法）
- Modify: `admin-video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/admin-video-work.controller.spec.ts`

- [ ] **Step 1: 写失败测试（admin-video-work.controller.spec.ts 新建）**

```ts
import { Test } from '@nestjs/testing';
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';

describe('AdminVideoWorkController categories/tags', () => {
  let controller: AdminVideoWorkController;
  let service: { listCategories: jest.Mock; createCategory: jest.Mock; updateCategory: jest.Mock; deleteCategory: jest.Mock;
                 listTags: jest.Mock; createTag: jest.Mock; updateTag: jest.Mock; deleteTag: jest.Mock; };

  beforeEach(async () => {
    service = {
      listCategories: jest.fn().mockResolvedValue([]),
      createCategory: jest.fn().mockResolvedValue({ id: 'c1' }),
      updateCategory: jest.fn().mockResolvedValue({ id: 'c1' }),
      deleteCategory: jest.fn().mockResolvedValue(undefined),
      listTags: jest.fn().mockResolvedValue([]),
      createTag: jest.fn().mockResolvedValue({ id: 't1' }),
      updateTag: jest.fn().mockResolvedValue({ id: 't1' }),
      deleteTag: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVideoWorkController],
      providers: [{ provide: VideoWorkService, useValue: service }],
    }).compile();
    controller = moduleRef.get(AdminVideoWorkController);
  });

  it('GET categories 调 service.listCategories', async () => {
    await controller.listCategories();
    expect(service.listCategories).toHaveBeenCalled();
  });

  it('POST categories 传 DTO 给 service', async () => {
    await controller.createCategory({ name: 'AI真人影视', sortOrder: 0, active: true });
    expect(service.createCategory).toHaveBeenCalledWith({ name: 'AI真人影视', sortOrder: 0, active: true });
  });

  it('PUT categories/:id 与 DELETE categories/:id 透传', async () => {
    await controller.updateCategory('c1', { name: 'MV' });
    await controller.deleteCategory('c1');
    expect(service.updateCategory).toHaveBeenCalledWith('c1', { name: 'MV' });
    expect(service.deleteCategory).toHaveBeenCalledWith('c1');
  });

  it('tags 同构透传', async () => {
    await controller.listTags();
    await controller.createTag({ name: '悬疑', sortOrder: 0, active: true });
    await controller.updateTag('t1', { active: false });
    await controller.deleteTag('t1');
    expect(service.listTags).toHaveBeenCalled();
    expect(service.createTag).toHaveBeenCalledWith({ name: '悬疑', sortOrder: 0, active: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- admin-video-work.controller.spec`
Expected: FAIL（controller 方法不存在）

- [ ] **Step 3: 写 DTO + service 方法 + controller**

```ts
// dto/video-category.dto.ts
import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoCategoryDto {
  @IsString() @MaxLength(64) name: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoCategoryDto {
  @IsOptional() @IsString() @MaxLength(64) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

```ts
// dto/video-tag.dto.ts（同构，name MaxLength(32)）
import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoTagDto {
  @IsString() @MaxLength(32) name: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoTagDto {
  @IsOptional() @IsString() @MaxLength(32) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

video-work.service.ts 追加（注入 PrismaService——module providers 补 `PrismaService` 或用既有全局注入模式，与 home-banner.service 一致）：

```ts
// —— 类型（改类型/标签后删缓存，spec §4.2 categories 缓存失效） ——
private static readonly CATEGORY_CACHE_KEY = 'videoWork:categories';

async listCategories() {
  return this.prisma.videoCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}
async listAllCategories() {
  return this.prisma.videoCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}
async createCategory(dto: { name: string; sortOrder?: number; active?: boolean }) {
  const row = await this.prisma.videoCategory.create({ data: dto });
  await this.invalidateCategoryCache();
  return row;
}
async updateCategory(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
  const row = await this.prisma.videoCategory.update({ where: { id }, data: dto });
  await this.invalidateCategoryCache();
  return row;
}
async deleteCategory(id: string) {
  await this.prisma.videoCategory.delete({ where: { id } }); // 作品侧 categoryId onDelete: SetNull
  await this.invalidateCategoryCache();
}

// —— 标签池（仅录入建议，删池不清洗作品 tags，spec §3.2） ——
async listAllTags() {
  return this.prisma.videoTag.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}
async createTag(dto: { name: string; sortOrder?: number; active?: boolean }) {
  return this.prisma.videoTag.create({ data: dto });
}
async updateTag(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
  return this.prisma.videoTag.update({ where: { id }, data: dto });
}
async deleteTag(id: string) {
  await this.prisma.videoTag.delete({ where: { id } });
}

private async invalidateCategoryCache() {
  await this.redis.del(VideoWorkService.CATEGORY_CACHE_KEY);
}
```

admin-video-work.controller.ts（**静态段路由必须在 `:id` 之前声明**——spec 红线；本 controller 的参数路由只有作品 `:id`，categories/tags 全静态段无冲突，但作品路由声明在文件末尾）：

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, Inject } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { CreateVideoCategoryDto, UpdateVideoCategoryDto } from './dto/video-category.dto';
import { CreateVideoTagDto, UpdateVideoTagDto } from './dto/video-tag.dto';

@Controller('api/admin/video-works')
export class AdminVideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}

  // ==== 静态段子资源（声明在作品 :id 路由之前） ====
  @Get('categories') listCategories() { return this.service.listAllCategories(); }
  @Post('categories') createCategory(@Body() dto: CreateVideoCategoryDto) { return this.service.createCategory(dto); }
  @Put('categories/:id') updateCategory(@Param('id') id: string, @Body() dto: UpdateVideoCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete('categories/:id') deleteCategory(@Param('id') id: string) { return this.service.deleteCategory(id); }

  @Get('tags') listTags() { return this.service.listAllTags(); }
  @Post('tags') createTag(@Body() dto: CreateVideoTagDto) { return this.service.createTag(dto); }
  @Put('tags/:id') updateTag(@Param('id') id: string, @Body() dto: UpdateVideoTagDto) { return this.service.updateTag(id, dto); }
  @Delete('tags/:id') deleteTag(@Param('id') id: string) { return this.service.deleteTag(id); }

  // Task 2.2+ 追加：candidates / upload-cover / settings / 作品 :id CRUD（声明在全部静态段之后）
}
```

注意：admin 端 listCategories 返回**全部**（含 inactive，管理用）；公开端（Task 3.2）才过滤 active + 走缓存。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api test -- admin-video-work.controller.spec`
Expected: PASS

- [ ] **Step 5: 路由声明序断言（spec §7.3，防静态段被 :id 吞——本 controller 加作品 :id 后生效，现在先写好）**

在 spec 文件追加：

```ts
it('静态段路由声明在参数路由 :id 之前', () => {
  const names = Object.getOwnPropertyNames(AdminVideoWorkController.prototype).filter(n => n !== 'constructor');
  const firstParamRouteIdx = names.findIndex(n => controller[n].length > 0 && ['updateWork','deleteWork','getWork'].includes(n));
  // 实现后改为真实方法名；断言 candidates/settings/uploadCover 的声明位置索引 < firstParamRouteIdx
  expect(firstParamRouteIdx).toBeGreaterThan(-1);
});
```

（Task 2.4 加完作品 :id 路由后完善为精确断言：`listCandidates`/`getSettings`/`uploadCover` 的索引均小于 `getWork`/`updateWork`/`deleteWork` 的最小索引。）

- [ ] **Step 6: Commit**

```bash
```bash
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 类型/标签池 CRUD + 改动删缓存"
```

---

### Task 2.2: candidates 候选视频池（TDD）

**Files:**
- Modify: `video-work.service.ts`（追加 listCandidates）
- Modify: `admin-video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/video-work.service.spec.ts`

- [ ] **Step 1: 写失败测试（video-work.service.spec.ts 新建）**

```ts
import { Test } from '@nestjs/testing';
import { VideoWorkService } from './video-work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import Redis from 'ioredis';

describe('VideoWorkService.listCandidates', () => {
  let service: VideoWorkService;
  let prisma: { media: { findMany: jest.Mock; count: jest.Mock }; canvasProject: { findMany: jest.Mock } };
  let minio: { generatePresignedGetUrl: jest.Mock };

  beforeEach(async () => {
    prisma = {
      media: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'm1', key: 'results/u1/p1/n1/d/v.mp4', projectId: 'p1', thumbnailKey: 'thumbnails/m1.webp',
          metadata: { durationSec: 12.6, width: 1280, height: 720 }, createdAt: new Date('2026-09-01'),
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
      canvasProject: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
    };
    minio = { generatePresignedGetUrl: jest.fn().mockResolvedValue('http://minio/presigned') };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        { provide: 'REDIS_CLIENT', useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(VideoWorkService);
  });

  it('口径：type=generated + video/mp4 + completed + 未删除 + metadata.origin=video-project', async () => {
    await service.listCandidates(1, 20);
    const where = prisma.media.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('generated');
    expect(where.mimeType).toBe('video/mp4');
    expect(where.status).toBe('completed');
    expect(where.deletedAt).toBeNull();
    expect(where.metadata).toEqual({ path: ['origin'], equals: 'video-project' });
  });

  it('canvasExists 批量单查（findMany in，非逐条 findUnique）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, select: { id: true } });
    expect(res.items[0].canvasExists).toBe(true);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledTimes(1);
  });

  it('projectId 为空 → canvasExists=false', async () => {
    prisma.media.findMany.mockResolvedValue([{ id: 'm2', key: 'k', projectId: null, thumbnailKey: null, metadata: {}, createdAt: new Date() }]);
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].canvasExists).toBe(false);
  });

  it('durationSec 取整入库口径（12.6 → 13）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].durationSec).toBe(13);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- video-work.service.spec`
Expected: FAIL（listCandidates 不存在）

- [ ] **Step 3: 实现（service 追加）**

```ts
import type { CandidateMedia } from '@flowweb/shared/types/video-work'; // 以 shared 包实际导入路径为准（参照其他模块 import shared 的写法）

/** 候选视频池（spec §4.4 口径，admin 策展全站——跨团队有意设计 D16/R10） */
async listCandidates(page: number, pageSize: number): Promise<{ items: CandidateMedia[]; total: number }> {
  const skip = (page - 1) * pageSize;
  const where = {
    status: 'completed' as const,
    deletedAt: null,
    type: 'generated' as const,
    mimeType: 'video/mp4',
    metadata: { path: ['origin'], equals: 'video-project' },
  };
  const [rows, total] = await Promise.all([
    this.prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    this.prisma.media.count({ where }),
  ]);
  const projectIds = [...new Set(rows.map(r => r.projectId).filter((p): p is string => !!p))];
  const existing = projectIds.length
    ? new Set((await this.prisma.canvasProject.findMany({ where: { id: { in: projectIds } }, select: { id: true } })).map(p => p.id))
    : new Set<string>();
  const items: CandidateMedia[] = await Promise.all(rows.map(async r => ({
    id: r.id,
    key: r.key,
    projectId: r.projectId,
    canvasExists: !!r.projectId && existing.has(r.projectId),
    thumbnailKey: r.thumbnailKey,
    durationSec: r.metadata && typeof (r.metadata as any).durationSec === 'number' ? Math.round((r.metadata as any).durationSec) : null,
    width: (r.metadata as any)?.width ?? null,
    height: (r.metadata as any)?.height ?? null,
    createdAt: r.createdAt.toISOString(),
    previewUrl: await this.minio.generatePresignedGetUrl(r.key, 900).catch(() => null),
  })));
  return { items, total };
}
```

controller 追加（在 categories/tags 之后、作品 :id 之前）：

```ts
@Get('candidates')
listCandidates(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
  return this.service.listCandidates(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20));
}
```

- [ ] **Step 4: 跑测试确认通过 + Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 candidates 候选池（口径+分页+canvasExists 批量+取整）"
```

### Task 2.3: 作品 CRUD service（TDD：保存校验/publishedAt/durationSec）

**Files:**
- Create: `dto/create-video-work.dto.ts`、`dto/update-video-work.dto.ts`
- Modify: `video-work.service.ts`

- [ ] **Step 1: 写失败测试（video-work.service.spec.ts 追加 describe）**

```ts
describe('createWork/updateWork 保存校验与发布语义', () => {
  it('(allowViewProcess||allowClone)=true 且无 canvasProjectId → 400', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: true, allowClone: false, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: false, allowClone: true, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
  });

  it('发布动作：status 转 PUBLISHED 且 publishedAt 为空 → 服务端设 now；请求体带 publishedAt 被忽略', async () => {
    prisma.videoWork.create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', status: 'PUBLISHED', publishedAt: new Date('2000-01-01') } as any);
    const data = (prisma.videoWork.create as jest.Mock).mock.calls[0][0].data;
    expect(data.publishedAt.getFullYear()).toBeGreaterThan(2025); // now，非请求体的 2000
  });

  it('再次下架上架不重置 publishedAt（update 分支 publishedAt 已有则不动）', async () => {
    prisma.videoWork.update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.updateWork('w1', { status: 'PUBLISHED' } as any, { publishedAt: new Date('2026-01-01') } as any);
    const data = (prisma.videoWork.update as jest.Mock).mock.calls[0][0].data;
    expect(data.publishedAt?.getFullYear()).toBe(2026); // 保留原值
  });

  it('durationSec 小数取整（12.6 → 13）', async () => {
    prisma.videoWork.create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', durationSec: 12.6 } as any);
    expect((prisma.videoWork.create as jest.Mock).mock.calls[0][0].data.durationSec).toBe(13);
  });
});
```

（updateWork 第二参数为 dto、第三参数为现有行——service 内先查现有行再合并判断，测试 mock prisma.videoWork.findUnique。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// dto/create-video-work.dto.ts
import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsEnum, MaxLength, ArrayMaxSize } from 'class-validator';

export class CreateVideoWorkDto {
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MaxLength(64) authorName: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsString() @MaxLength(512) videoKey: string;          // 取自 candidate.key
  @IsOptional() @IsString() videoMediaId?: string;        // 取自 candidate.id
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;
  @IsOptional() @IsString() canvasProjectId?: string;     // 取自 candidate.projectId（D16）

  @IsOptional() @IsInt() durationSec?: number;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;

  @IsOptional() @IsInt() viewCount?: number;              // 后台可调（覆盖式）
  @IsOptional() @IsInt() likeCount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsEnum(['DRAFT', 'PUBLISHED']) status?: 'DRAFT' | 'PUBLISHED';
  @IsOptional() @IsBoolean() allowViewProcess?: boolean;
  @IsOptional() @IsBoolean() allowClone?: boolean;
  // 注意：无 publishedAt 字段——服务端专用（spec §4.3）
}
```

`update-video-work.dto.ts` 同构但**除 videoKey/videoMediaId 外全部可选**（换源视频=重建作品更清晰，v1 不支持 update 换源；title/authorName 也变可选）。

service 实现：

```ts
async createWork(dto: CreateVideoWorkDto) {
  this.assertProcessFlags(dto as any);
  const published = dto.status === 'PUBLISHED';
  return this.prisma.videoWork.create({ data: {
    ...dto,
    durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined,
    publishedAt: published ? new Date() : null,   // 请求体无此字段，服务端设
  } });
}

async updateWork(id: string, dto: UpdateVideoWorkDto) {
  const existing = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!existing) throw new NotFoundException('作品不存在');
  const merged = {
    allowViewProcess: dto.allowViewProcess ?? existing.allowViewProcess,
    allowClone: dto.allowClone ?? existing.allowClone,
    canvasProjectId: dto.canvasProjectId !== undefined ? dto.canvasProjectId : existing.canvasProjectId,
    status: dto.status ?? existing.status,
  } as any;
  this.assertProcessFlags(merged);
  const data: any = { ...dto, durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined };
  // 发布语义：转 PUBLISHED 且原 publishedAt 为空 → 设 now；已有则不动
  if (merged.status === 'PUBLISHED' && !existing.publishedAt) data.publishedAt = new Date();
  const row = await this.prisma.videoWork.update({ where: { id }, data });
  await this.invalidateWorkCaches(id); // 详情/快照缓存（Task 5.3 定义）
  return row;
}

private assertProcessFlags(w: { allowViewProcess?: boolean; allowClone?: boolean; canvasProjectId?: string | null }) {
  if ((w.allowViewProcess || w.allowClone) && !w.canvasProjectId) {
    throw new BadRequestException('开启创作过程/克隆需要画布来源（canvasProjectId）');
  }
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 作品 CRUD service（保存校验/发布自动 publishedAt/取整）"
```

### Task 2.4: 作品 admin controller + 删除红线（TDD）

**Files:**
- Modify: `admin-video-work.controller.ts`（作品路由，声明在全部静态段之后）

- [ ] **Step 1: 写失败测试（admin-video-work.controller.spec.ts 追加）**

```ts
it('GET / 作品列表分页透传', async () => {
  service.listAllWorks = jest.fn().mockResolvedValue({ items: [], total: 0 });
  await controller.listWorks('1', '20');
  expect(service.listAllWorks).toHaveBeenCalledWith(1, 20);
});

it('DELETE 只调 removeWork（service 内不调 minio.delete——红线在 service 测试断言）', async () => {
  service.removeWork = jest.fn().mockResolvedValue(undefined);
  await controller.deleteWork('w1');
  expect(service.removeWork).toHaveBeenCalledWith('w1');
});

it('路由声明序：静态段（categories/tags/candidates/settings/uploadCover）先于作品 :id', () => {
  const proto = AdminVideoWorkController.prototype;
  const names = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
  const idRoutes = ['getWork', 'updateWork', 'deleteWork'].map(n => names.indexOf(n)).filter(i => i >= 0);
  const staticRoutes = ['listCategories', 'listTags', 'listCandidates', 'getSettings', 'uploadCover'];
  for (const s of staticRoutes) {
    expect(names.indexOf(s)).toBeGreaterThan(-1);
    expect(Math.min(...idRoutes)).toBeGreaterThan(names.indexOf(s)); // spec §4.2 红线
  }
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service 追加：

```ts
async listAllWorks(page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    this.prisma.videoWork.findMany({ orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
    this.prisma.videoWork.count(),
  ]);
  return { items, total };
}
async getWorkById(id: string) { return this.prisma.videoWork.findUnique({ where: { id } }); }

/** 删除红线（spec §4.3）：只删 DB 行，禁止 minio.delete——videoKey 与源 Media 指向同一对象。
 *  HomeBanner "先删对象再删行"先例不可照抄；coverKey 自有上传对象 v1 也统一不删。 */
async removeWork(id: string) {
  await this.prisma.videoWork.delete({ where: { id } });
  await this.invalidateWorkCaches(id);
}
```

controller 追加（文件末尾，静态段全部之后）：

```ts
@Get() listWorks(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
  return this.service.listAllWorks(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
}
@Post() createWork(@Body() dto: CreateVideoWorkDto) { return this.service.createWork(dto); }
@Get(':id') getWork(@Param('id') id: string) { return this.service.getWorkById(id); }
@Put(':id') updateWork(@Param('id') id: string, @Body() dto: UpdateVideoWorkDto) { return this.service.updateWork(id, dto); }
@Delete(':id') deleteWork(@Param('id') id: string) { return this.service.removeWork(id); }
```

service 测试追加红线断言：

```ts
it('removeWork 不触碰 MinIO（删除红线）', async () => {
  prisma.videoWork.delete = jest.fn().mockResolvedValue({});
  await service.removeWork('w1');
  expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  expect((service as any).minio?.removeObject).toBeUndefined(); // service 不注入删除能力
});
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- admin-video-work.controller.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 作品 admin CRUD（删除红线：只删行禁删对象）"
```

### Task 2.5: upload-cover 封面上传（magic-number 校验）

**Files:**
- Modify: `admin-video-work.controller.ts` + `video-work.service.ts`

- [ ] **Step 1: 写失败测试（controller spec 追加）**

```ts
it('uploadCover 校验 magic-number 非图片 → 400', async () => {
  const fakeFile = { buffer: Buffer.from('not an image'), mimetype: 'image/png', originalname: 'x.png' } as any;
  await expect(controller.uploadCover(fakeFile)).rejects.toThrow(BadRequestException);
});
it('合法 PNG 通过并返回 key', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG 魔数头
  service.uploadCover = jest.fn().mockResolvedValue({ key: 'uploads/system/xxx.webp' });
  const res = await controller.uploadCover({ buffer: png, mimetype: 'image/png' } as any);
  expect(res.key).toContain('uploads/system/');
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// service
async uploadCover(buffer: Buffer): Promise<{ key: string }> {
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isJpg && !isWebp) throw new BadRequestException('仅支持 png/jpg/webp');
  // 复用 buildKey 的 system 分区（与 banner 封面同一公开域，by-key 已放行）
  const { v4: uuid } = await import('uuid');
  const key = `uploads/system/${new Date().toISOString().slice(0, 10)}/${uuid()}.img`;
  await this.minio.putObject?.(key, buffer) ?? await this.minio.uploadBuffer(key, buffer); // 以 MinioService 实际方法为准（先 grep 确认；若无 buffer 上传方法，参照 admin-banner.controller 的 presign 流程改为返回 presigned POST 由前端直传）
  return { key };
}

// controller（静态段区）
@Post('upload-cover')
@UseInterceptors(FileInterceptor('file'))
uploadCover(@UploadedFile() file: Express.Multer.File) {
  if (!file) throw new BadRequestException('file is required');
  return this.service.uploadCover(file.buffer);
}
```

**实施注意**：先 `grep -n "putObject\|uploadBuffer\|presignedPut" apps/api/src/modules/minio/minio.service.ts` 确认 MinioService 的对象写入方法与 admin-banner 上传先例（`admin-banner.controller.ts:53` 附近），按既有模式实现——若仓库上传走 presigned POST，则本端点返回 presigned 字段而非直接写对象，service 测试相应调整。magic-number 校验逻辑不变。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- admin-video-work.controller.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 封面上传（magic-number + system 公开域）"
```

### Task 2.6: settings 轮播设置端点（默认值兜底）

**Files:**
- Modify: `admin-video-work.controller.ts` + `video-work.service.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
it('无行返回默认值（不依赖 DB 有行）', async () => {
  prisma.videoWorkSetting.findUnique = jest.fn().mockResolvedValue(null);
  const s = await service.getSettings();
  expect(s).toEqual({ carouselEnabled: true, carouselScope: 'all' });
});
it('PUT 走 upsert singleton 行', async () => {
  prisma.videoWorkSetting.upsert = jest.fn().mockResolvedValue({});
  await service.updateSettings({ carouselEnabled: false, carouselScope: 'category' });
  expect(prisma.videoWorkSetting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'singleton' } }),
  );
});
it('carouselScope 非法值 → 400', async () => {
  await expect(service.updateSettings({ carouselEnabled: true, carouselScope: 'xx' as any })).rejects.toThrow(BadRequestException);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// service
async getSettings(): Promise<{ carouselEnabled: boolean; carouselScope: 'all' | 'category' }> {
  const row = await this.prisma.videoWorkSetting.findUnique({ where: { id: 'singleton' } });
  return { carouselEnabled: row?.carouselEnabled ?? true, carouselScope: (row?.carouselScope as 'all' | 'category') ?? 'all' };
}
async updateSettings(dto: { carouselEnabled: boolean; carouselScope: 'all' | 'category' }) {
  if (dto.carouselScope !== 'all' && dto.carouselScope !== 'category') throw new BadRequestException('carouselScope 仅 all|category');
  await this.prisma.videoWorkSetting.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
    update: { carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
  });
  return this.getSettings();
}
```

controller（静态段区）：

```ts
@Get('settings') getSettings() { return this.service.getSettings(); }
@Put('settings') updateSettings(@Body() dto: { carouselEnabled: boolean; carouselScope: string }) {
  return this.service.updateSettings(dto as any);
}
```

- [ ] **Step 4: 跑绿 + 批次 2 全量回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 settings 端点（singleton upsert + 默认值兜底）"
```

---

## 批次 3：公开列表/详情/categories

### Task 3.1: PUBLIC_PREFIXES 放行（+auth.guard.spec）

**Files:**
- Modify: `apps/api/src/auth/auth.guard.ts:3-15`（PUBLIC_PREFIXES 数组 +1 行）
- Modify: `apps/api/src/auth/auth.guard.spec.ts`（新增一条用例，既有 7 条断言不动）

- [ ] **Step 1: 写失败测试（auth.guard.spec.ts 追加）**

```ts
it('/api/video-works 前缀公开放行', async () => {
  // 沿用该文件既有测试的 guard 实例化与 mock request 构造方式
  const req = { path: '/api/video-works', headers: {} };
  await expect(guard.canActivate({ switchToHttp: { getRequest: () => req } } as any)).resolves.toBe(true);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（数组加一行）**

```ts
const PUBLIC_PREFIXES = [
  // ...既有项不动...
  '/api/media/by-key',
  '/api/video-works',   // ← 新增（D4：前缀放行 + handler 自守，clone/like 在 handler 内验 req.user）
  // ...
];
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- auth.guard.spec
git add apps/api/src/auth/
git commit -m "feat(video-work): 批次3 PUBLIC_PREFIXES 放行 /api/video-works"
```

### Task 3.2: 公开列表 + categories 缓存（TDD）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/video-work.controller.spec.ts`

- [ ] **Step 1: 写失败测试（controller spec 新建；service 查询逻辑在 service spec 追加）**

```ts
// video-work.controller.spec.ts
import { Test } from '@nestjs/testing';
import { VideoWorkController } from './video-work.controller';
import { VideoWorkService } from './video-work.service';

describe('VideoWorkController（公开）', () => {
  let controller: VideoWorkController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      listPublished: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      listCategoriesPublic: jest.fn().mockResolvedValue([]),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [VideoWorkController],
      providers: [{ provide: VideoWorkService, useValue: service }],
    }).compile();
    controller = moduleRef.get(VideoWorkController);
  });

  it('GET / 分页参数 clamp（pageSize=9999 → 50；page=0 → 1）', async () => {
    await controller.list(undefined, '0', '9999');
    expect(service.listPublished).toHaveBeenCalledWith(undefined, 1, 50);
  });

  it('GET /categories 声明顺序在 :id 之前', () => {
    const names = Object.getOwnPropertyNames(VideoWorkController.prototype).filter(n => n !== 'constructor');
    expect(names.indexOf('listCategories')).toBeGreaterThan(-1);
    expect(names.indexOf('listCategories')).toBeLessThan(names.indexOf('getDetail')); // :id 路由
  });
});
```

service spec 追加：

```ts
describe('listPublished', () => {
  it('orderBy 含 id tiebreaker（spec §4.2）', async () => {
    prisma.videoWork.findMany = jest.fn().mockResolvedValue([]);
    prisma.videoWork.count = jest.fn().mockResolvedValue(0);
    await service.listPublished(undefined, 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' },
    ]);
  });

  it('categoryId 为 plain filter（不校验 active）', async () => {
    prisma.videoWork.findMany = jest.fn().mockResolvedValue([]);
    prisma.videoWork.count = jest.fn().mockResolvedValue(0);
    await service.listPublished('any-cat', 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].where.categoryId).toBe('any-cat');
  });

  it('listCategoriesPublic 命中缓存第二次不查 DB', async () => {
    prisma.videoCategory.findMany = jest.fn().mockResolvedValue([]);
    const redisGet = (service as any).redis.get.mockResolvedValue('[]');
    await service.listCategoriesPublic();
    await service.listCategoriesPublic();
    expect(prisma.videoCategory.findMany).toHaveBeenCalledTimes(0); // 全部命中缓存
    redisGet.mockReset();
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service：

```ts
/** 公开列表（spec §4.2：item 只含 5 字段，无 videoUrl） */
async listPublished(categoryId: string | undefined, page: number, pageSize: number) {
  const where: any = { status: 'PUBLISHED' };
  if (categoryId) where.categoryId = categoryId; // plain filter
  const [rows, total] = await Promise.all([
    this.prisma.videoWork.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }], // id tiebreaker
      select: { id: true, title: true, coverKey: true, durationSec: true, tags: true },
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    this.prisma.videoWork.count({ where }),
  ]);
  const items = await Promise.all(rows.map(async r => ({
    id: r.id, title: r.title, durationSec: r.durationSec, tags: r.tags,
    coverUrl: r.coverKey ? await this.presignWork(r.coverKey) : null,
  })));
  return { items, total, page, pageSize };
}

private async presignWork(key: string): Promise<string> {
  // presign+短缓存纪律参照 media.service（TTL < URL TTL）——轮播/列表高频
  const cacheKey = `videoWork:url:${key}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return cached;
  const url = await this.minio.generatePresignedGetUrl(key, 3600);
  await this.redis.set(cacheKey, url, 'EX', 3500);
  return url;
}

/** 公开类型列表（active + 30-60s 缓存；admin 改动时 Task 2.1 已删缓存） */
async listCategoriesPublic() {
  const cached = await this.redis.get(VideoWorkService.CATEGORY_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = await this.prisma.videoCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, sortOrder: true },
  });
  await this.redis.set(VideoWorkService.CATEGORY_CACHE_KEY, JSON.stringify(rows), 'EX', 60);
  return rows;
}
```

controller：

```ts
// video-work.controller.ts（categories 静态段在最前）
import { Controller, Get, Query, Param, Post, Req, Inject, NotFoundException } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';

@Controller('api/video-works')
export class VideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}

  @Get('categories')
  listCategories() { return this.service.listCategoriesPublic(); }

  @Get()
  list(@Query('categoryId') categoryId: string | undefined,
       @Query('page') page = '1',
       @Query('pageSize') pageSize = '20') {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(50, Math.max(1, Number(pageSize) || 20)); // 手写 clamp（X12）
    return this.service.listPublished(categoryId, p, ps);
  }

  // Task 3.3 getDetail / Task 4.x view/like / Task 5.3 process / Task 6.2 clone 追加
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次3 公开列表（tiebreaker/clamp/字段裁剪/URL 缓存）+ categories 缓存"
```

### Task 3.3: 详情端点（liked/canViewProcess/canClone/禁 readCanvas）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('getDetail', () => {
  const work = {
    id: 'w1', title: 't', description: 'd', authorName: 'a', categoryId: 'c1',
    videoKey: 'vk', coverKey: 'ck', canvasProjectId: 'p1',
    viewCount: 10, likeCount: 5, tags: ['x'], publishedAt: new Date(), durationSec: 100, width: 16, height: 9,
    allowViewProcess: true, allowClone: true, status: 'PUBLISHED',
  };

  it('DRAFT → 404', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ ...work, status: 'DRAFT' });
    await expect(service.getDetail('w1', null)).rejects.toThrow(NotFoundException);
  });

  it('画布不存在（findUnique null）→ canViewProcess/canClone=false 且不抛', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue(null);
    const d = await service.getDetail('w1', null);
    expect(d.canViewProcess).toBe(false);
    expect(d.canClone).toBe(false);
  });

  it('liked 初始态：匿名 false 且零 Redis 调用（匿名短路）', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1' });
    const redisGet = (service as any).redis.get;
    const d = await service.getDetail('w1', null);
    expect(d.liked).toBe(false);
    expect(redisGet).not.toHaveBeenCalled();
  });

  it('liked 初始态：已登录读同一 like key（videoWork:like:{workId}:{userId}）', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1' });
    (service as any).redis.get.mockResolvedValue('1');
    const d = await service.getDetail('w1', 'user9');
    expect(d.liked).toBe(true);
    expect((service as any).redis.get).toHaveBeenCalledWith('videoWork:like:w1:user9');
  });

  it('详情端点不触发 readCanvas（canvasProject 校验只 findUnique）', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1' });
    await service.getDetail('w1', null);
    // service 不注入 CollabDocumentService 的 readCanvas 到详情路径——用 spy 验证（若注入了 collabDoc）
    const collabDoc = (service as any).collabDoc;
    if (collabDoc) expect(collabDoc.readCanvas).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// service
async getDetail(id: string, userId: string | null) {
  const w = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const canvasExists = w.canvasProjectId
    ? !!(await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } }))
    : false;
  const [videoUrl, coverUrl] = await Promise.all([
    this.presignWork(w.videoKey),
    w.coverKey ? this.presignWork(w.coverKey) : Promise.resolve(null),
  ]);
  const liked = userId ? await this.redis.get(`videoWork:like:${id}:${userId}`).then(v => v === '1') : false; // 匿名短路，同 key（§4.2 约束）
  return {
    id: w.id, title: w.title, description: w.description, authorName: w.authorName,
    categoryId: w.categoryId, videoUrl, coverUrl,
    viewCount: w.viewCount, likeCount: w.likeCount, liked, tags: w.tags,
    publishedAt: w.publishedAt?.toISOString() ?? null,
    durationSec: w.durationSec, width: w.width, height: w.height,
    canViewProcess: w.allowViewProcess && canvasExists,  // 详情禁 readCanvas（§4.2）
    canClone: w.allowClone && canvasExists,               // 原始开关值 + 画布存在
  };
}
```

controller：

```ts
@Get(':id')
getDetail(@Param('id') id: string, @Req() req: any) {
  return this.service.getDetail(id, req.user?.id ?? null);
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次3 详情端点（liked 初始态/两开关/禁 readCanvas）"
```

---

## 批次 4：计数（view/like + checkUserRateLimit）

### Task 4.1: RateLimiterService.checkUserRateLimit（TDD）

**Files:**
- Modify: `apps/api/src/common/services/rate-limiter.service.ts`
- Modify: `apps/api/src/common/services/rate-limiter.service.spec.ts`（已存在，追加）

- [ ] **Step 1: 写失败测试**

```ts
describe('checkUserRateLimit', () => {
  it('用户维度固定窗口：window 内超 max → false', async () => {
    redis.incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(11);
    redis.expire = vi.fn();
    expect(await limiter.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(true);
    expect(await limiter.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(false);
  });
  it('key 形如 ratelimit:user:{action}:{userId}', async () => {
    redis.incr = vi.fn().mockResolvedValue(1); redis.expire = vi.fn();
    await limiter.checkUserRateLimit('u1', 'act', 60, 5);
    expect(redis.incr).toHaveBeenCalledWith('ratelimit:user:act:u1');
  });
  it('不走 IP_WHITELIST（用户维度与 IP 无关）', async () => {
    redis.incr = vi.fn().mockResolvedValue(1); redis.expire = vi.fn();
    expect(await limiter.checkUserRateLimit('u1', 'act', 60, 5)).toBe(true); // 本地 127.0.0.1 请求也照常计数
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（service 追加方法）**

```ts
/** 用户维度固定窗口限流（不走 IP 白名单——与来源 IP 无关，spec §4.5） */
async checkUserRateLimit(userId: string, action: string, windowSec: number, max: number): Promise<boolean> {
  const key = `ratelimit:user:${action}:${userId}`;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, windowSec);
  return count <= max;
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- rate-limiter
git add apps/api/src/common/services/
git commit -m "feat(video-work): 批次4 checkUserRateLimit（用户维度限流）"
```

### Task 4.2: view 计数端点（IP 去重 + 限流 + StrictMode）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('recordView', () => {
  it('同 IP 1h 内重复请求只 +1（Redis 去重）', async () => {
    prisma.videoWork.update = jest.fn().mockResolvedValue({});
    (service as any).redis.set = jest.fn().mockResolvedValue('OK');      // 第一次 NX 成功
    await service.recordView('w1', '1.2.3.4');
    (service as any).redis.set = jest.fn().mockResolvedValue(null);      // 第二次 NX 失败
    await service.recordView('w1', '1.2.3.4');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
    expect(prisma.videoWork.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { viewCount: { increment: 1 } } });
  });

  it('StrictMode 双发（同 IP 连续两次）计数仍 1 —— spec §7.4', async () => {
    let call = 0;
    (service as any).redis.set = jest.fn().mockImplementation(() => Promise.resolve(call++ === 0 ? 'OK' : null));
    prisma.videoWork.update = jest.fn().mockResolvedValue({});
    await service.recordView('w9', '5.5.5.5');
    await service.recordView('w9', '5.5.5.5');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
  });

  it('限流超限 → 429（ThrottlerException 语义）', async () => {
    (service as any).rateLimiter.checkIpRateLimit = jest.fn().mockResolvedValue(false);
    await expect(service.recordView('w1', '9.9.9.9')).rejects.toThrow(ThrottlerException);
  });

  it('DRAFT 作品 → 404', async () => {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT' });
    await expect(service.recordView('w1', '1.1.1.1')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service（注入 RateLimiterService——module 已 provide）：

```ts
import { ThrottlerException } from '@nestjs/throttler';

async recordView(id: string, ip: string) {
  const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const allowed = await this.rateLimiter.checkIpRateLimit(ip, 'video-work:view', 60, 30);
  if (!allowed) throw new ThrottlerException();
  // SET NX 原子去重（1h）
  const ok = await this.redis.set(`videoWork:view:${id}:${ip}`, '1', 'EX', 3600, 'NX');
  if (ok !== 'OK') return { counted: false };
  await this.prisma.videoWork.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  return { counted: true };
}
```

controller：

```ts
@Post(':id/view')
recordView(@Param('id') id: string, @Req() req: any) {
  return this.service.recordView(id, this.rateLimiter.getClientIp(req));
}
```

（controller 需注入 RateLimiterService 仅供 getClientIp——或 service 内传 req，保持 controller 薄：在 controller 注入并只取 IP。）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次4 view 计数（IP 去重 NX + 限流 + StrictMode 兜底）"
```

### Task 4.3: like 端点（登录 + SET NX + GREATEST 下界）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('toggleLike', () => {
  it('未登录 → 401（controller 层自守，service 断言 userId 必填由类型保证——controller 测试补）', () => { /* 见 controller 测试 */ });

  it('首次点赞：NX 成功 → +1 且返回 liked:true', async () => {
    (service as any).redis.set = jest.fn().mockResolvedValue('OK');
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', likeCount: 4 });
    const res = await service.toggleLike('w1', 'u1');
    expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.stringContaining('GREATEST'), 'w1', 1);
    expect(res).toEqual({ liked: true, likeCount: 5 });
  });

  it('再点取消：NX 失败 → -1 删键', async () => {
    (service as any).redis.set = jest.fn().mockResolvedValue(null); // NX 失败=已赞
    (service as any).redis.del = jest.fn();
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', likeCount: 5 });
    const res = await service.toggleLike('w1', 'u1');
    expect(prisma.$executeRaw).toHaveBeenCalledWith(expect.stringContaining('GREATEST'), 'w1', -1);
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:like:w1:u1');
    expect(res).toEqual({ liked: false, likeCount: 4 });
  });

  it('GREATEST 下界：likeCount=0 时取消不再减（SQL 层保护）', async () => {
    (service as any).redis.set = jest.fn().mockResolvedValue(null);
    prisma.$executeRaw = jest.fn().mockResolvedValue(1);
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', likeCount: 0 });
    const res = await service.toggleLike('w1', 'u1');
    expect(prisma.$executeRaw).toHaveBeenCalledWith(
      expect.stringContaining('GREATEST("likeCount" + $1, 0)'), 'w1', -1);
  });
});
```

controller spec 追加：

```ts
it('POST like 未登录 req.user 为空 → 401', async () => {
  await expect(controller.toggleLike('w1', { /* req 无 user */ } as any)).rejects.toThrow(UnauthorizedException);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service：

```ts
async toggleLike(id: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
  const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const key = `videoWork:like:${id}:${userId}`;
  const nx = await this.redis.set(key, '1', 'EX', 7776000, 'NX'); // 90 天（§4.5）
  let delta: number;
  if (nx === 'OK') delta = 1;
  else { await this.redis.del(key); delta = -1; } // NX 原子判断，勿 GET-再-SET（并发双击 +2）
  await this.prisma.$executeRaw`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`;
  const row = await this.prisma.videoWork.findUnique({ where: { id }, select: { likeCount: true } });
  return { liked: delta === 1, likeCount: row?.likeCount ?? 0 };
}
```

controller：

```ts
@Post(':id/like')
toggleLike(@Param('id') id: string, @Req() req: any) {
  if (!req.user?.id) throw new UnauthorizedException(); // D15：登录才能点赞
  return this.service.toggleLike(id, req.user.id);
}
```

- [ ] **Step 4: 跑绿 + 批次 3-4 回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次4 like 端点（登录 userId 去重/SET NX 原子/GREATEST 下界/返回 liked）"
```

---

## 批次 5：创作过程快照（白名单纯函数 + 缩略图 + 端点）

### Task 5.1: snapshot-filter.util 纯函数（核心安全件，多步 TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/snapshot-filter.util.ts`
- Create: `apps/api/src/modules/video-work/snapshot-filter.util.spec.ts`

纯函数、零依赖（Prisma/Minio 均不注入）——快照与克隆共用（D9），选项参数区分差异。

- [ ] **Step 1: 写失败测试（骨架 + 白名单键级行为）**

```ts
import {
  buildFilteredSnapshot, WHITELIST, stripHtmlToText, ensureParentFirst,
  type RawCanvasData, type FilterOptions,
} from './snapshot-filter.util';

const rawNode = (id: string, type: string, data: Record<string, unknown>, extra: any = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data, ...extra });

describe('snapshot-filter 白名单（spec §4.6 表，键以 NODE_TYPES 真值为准）', () => {
  const base: FilterOptions = { dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'], resetStatusIdle: false, injectThumbnails: false };

  it('textInput：content HTML→纯文本、prompt（string）直保留', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'textInput', { content: '<p>一只猫在窗台上</p>', prompt: '副提示词' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('一只猫在窗台上');
    expect(out.nodes[0].data.prompt).toBe('副提示词');
  });

  it('imageGen：prompt.text 保留；html/fileId/mediaUrl/allImages/referenceImage/mediaName/generationBatchId/extConfig 全剥', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'imageGen', {
        prompt: { text: '一只猫', html: '<p>一只猫</p>', referencedImageIds: ['r1'] },
        style: 's', model: 'm', quality: 'q', ratio: '1:1', resolution: '2k', aspectRatio: 1, aiTool: 'grid_25',
        fileId: 'f1', mediaUrl: 'http://x', referenceImage: 'ri', mediaName: 'cat.png',
        allImages: [{ id: 'i1', url: 'http://y', name: 'a.png', status: 'success' }],
        generationBatchId: 'g1', extConfig: { model: 'm2', prompt: { text: 't', html: '<p>x</p>' } }, status: 'done',
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.prompt).toBe('一只猫');           // PromptValue → .text 字符串化
    expect(d.style).toBe('s'); expect(d.model).toBe('m'); expect(d.aiTool).toBe('grid_25');
    const keys = Object.keys(d);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'allImages', 'referenceImage', 'mediaName', 'generationBatchId', 'extConfig', 'referencedImageIds', 'status']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('videoGen：label/model/ratio/prompt.text/trim 保留；origin/videoProjectId/fileId 剥离', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'videoGen', { origin: 'video-edit', videoProjectId: 'vp1', fileId: 'f1', label: '末班地铁 · 导出 1', model: 'video-01', ratio: '16:9', prompt: { text: 'p', html: 'h' }, trimStart: 0, trimEnd: 5, status: 'done' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.label).toBe('末班地铁 · 导出 1');
    expect(d.origin).toBeUndefined(); expect(d.videoProjectId).toBeUndefined(); expect(d.fileId).toBeUndefined();
  });

  it('audioGen：model/content 保留（类型键是 audioGen 非 audio）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'audioGen', { model: 'tts', content: '旁白文字', fileId: 'f', status: 'done' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('旁白文字');
    expect(out.nodes[0].data.fileId).toBeUndefined();
  });

  it('multiImageGen：prompt（string）/label 保留；images/generationBatchId/nodeStatus 剥离', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'multiImageGen', { prompt: '分镜提示', label: 'L', images: [{ url: 'u' }], generationBatchId: 'g', nodeStatus: 'done', mainImageIndex: 0, expanded: false })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.prompt).toBe('分镜提示');
    expect(out.nodes[0].data.images).toBeUndefined();
  });

  it('group：groupType/cells/name 保留；collapsed/storyboard 剥离；cells 悬空 id 原样返回', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'group', { groupType: 'storyboard', cells: ['ghost-id', null], name: '分镜1', collapsed: false, storyboard: { x: 1 } })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.groupType).toBe('storyboard');
    expect(d.cells).toEqual(['ghost-id', null]); // 原样返回（§7.6 断言口径）
    expect(d.name).toBe('分镜1');
    expect(d.collapsed).toBeUndefined(); expect(d.storyboard).toBeUndefined();
  });

  it('videoEdit 节点与 shadow- 前缀节点及相连边剥除', () => {
    const input: RawCanvasData = {
      nodes: [
        rawNode('n1', 'videoGen', { model: 'm' }),
        rawNode('n2', 'videoEdit', { timeline: [1] }),
        rawNode('shadow-tmp', 'imageGen', { prompt: { text: 'x', html: 'y' } }),
      ],
      edges: [
        { id: 'e1', sourceId: 'n1', targetId: 'n2' },
        { id: 'e2', sourceId: 'n1', targetId: 'shadow-tmp' },
      ],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes.map(n => n.id)).toEqual(['n1']);
    expect(out.edges).toEqual([]);
  });

  it('未知类型默认全剥 data（仅结构字段）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'futureType', { secret: 'x', nice: 'y' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data).toEqual({});
  });

  it('nodeTypes 注册表全覆盖：白名单表 keys ⊇ [imageGen,imageExtGen,textInput,videoGen,audioGen,multiImageGen,videoEdit,group]', () => {
    const registered = ['imageGen', 'imageExtGen', 'textInput', 'videoGen', 'audioGen', 'multiImageGen', 'videoEdit', 'group'];
    for (const t of registered) expect(Object.keys(WHITELIST)).toContain(t);
  });
});
```

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/api test -- snapshot-filter`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 snapshot-filter.util.ts**

```ts
/** 快照/克隆共用白名单纯函数（spec §4.6/§4.7，D9）。
 *  type 键真值来源 = apps/web/src/stores/nodeStore.ts NODE_TYPES（API 无法 import，静态照抄；
 *  全覆盖测试是唯一防线——新增节点类型时必须同步本表）。
 *  isTextNode 用 'text' 判断是既有不一致，勿参照。 */

export interface RawNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}
export interface RawEdge { id: string; sourceId: string; targetId: string }
export interface RawCanvasData { nodes: RawNode[]; edges: RawEdge[] }

export interface FilterOptions {
  dropTypes: string[];        // 快照与克隆同用：videoEdit；克隆另含 shadow-（经 dropIdPrefixes）
  dropIdPrefixes: string[];
  resetStatusIdle: boolean;   // 克隆 true（防"已完成却无产物"）
  injectThumbnails: boolean;  // 快照 true（由调用方在过滤前注入 data.thumbnailUrl，见 Task 5.2）
}

export interface FilteredNode extends RawNode {}
export interface FilteredEdge { id: string; source: string; target: string }

/** data 白名单表：值=null 表示该字段值经转换写入（见 applySpecial） */
export const WHITELIST: Record<string, string[]> = {
  textInput: ['content', 'prompt'],
  imageGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio', 'aiTool'],
  imageExtGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio', 'aiTool'], // extConfig 整体剥离（内嵌 prompt.html）
  videoGen: ['model', 'ratio', 'prompt', 'trimStart', 'trimEnd', 'label'],
  audioGen: ['model', 'content'],
  multiImageGen: ['prompt', 'label'],
  videoEdit: [],   // 仅结构字段
  group: ['groupType', 'cells', 'name'],
};

/** HTML → 纯文本（红线 2 的服务端半边）：剥全部标签，解码基础实体 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

export function ensureParentFirst(nodes: RawNode[]): RawNode[] {
  // 依赖序输出（spec §4.6：RF v12 要求父先子后；"先有子后建组"的 Y.Map 插入序不保证）
  const byId = new Map(nodes.map(n => [n.id, n]));
  const emitted = new Set<string>();
  const out: RawNode[] = [];
  const visit = (n: RawNode) => {
    if (emitted.has(n.id)) return;
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) visit(p);           // 父先
    if (!emitted.has(n.id)) { emitted.add(n.id); out.push(n); }
  };
  // 拓扑安全：parentId 环/悬空时 visit 递归保护——先标自身再递归会破序，故用 emitted 判重 + 悬空父直接跳过
  for (const n of nodes) visit(n);
  return out;
}

function applyWhitelist(node: RawNode, opts: FilterOptions): FilteredNode {
  const allowed = WHITELIST[node.type] ?? []; // 未知类型默认全剥
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!(field in node.data)) continue;
    const v = node.data[field];
    if (field === 'content' && typeof v === 'string') {
      data.content = stripHtmlToText(v);           // textInput.content 是 tiptap HTML
    } else if (field === 'prompt') {
      data.prompt = (v && typeof v === 'object')
        ? stripHtmlToText(String((v as any).text ?? ''))  // PromptValue → 只取 .text（红线 1：永不返回 .html）
        : v;                                               // textInput/multiImageGen 的 string prompt
    } else {
      data[field] = v;
    }
  }
  if (opts.injectThumbnails && typeof node.data.thumbnailUrl === 'string') {
    data.thumbnailUrl = node.data.thumbnailUrl;   // Task 5.2 注入字段（快照侧）
  }
  if (opts.resetStatusIdle) data.status = 'idle'; // 克隆：白名单外强制重置（§4.7）
  return { ...node, data };
}

export function buildFilteredSnapshot(raw: RawCanvasData, opts: FilterOptions): { nodes: FilteredNode[]; edges: FilteredEdge[] } {
  const dropped = new Set<string>();
  const kept = raw.nodes.filter(n => {
    if (opts.dropTypes.includes(n.type)) { dropped.add(n.id); return false; }
    if (opts.dropIdPrefixes.some(p => n.id.startsWith(p))) { dropped.add(n.id); return false; }
    return true;
  });
  const edges = raw.edges
    .filter(e => !dropped.has(e.sourceId) && !dropped.has(e.targetId))
    .map(e => ({ id: e.id, source: e.sourceId, target: e.targetId })); // readCanvas sourceId/targetId → source/target 显式映射
  const nodes = ensureParentFirst(kept).map(n => applyWhitelist(n, opts));
  return { nodes, edges };
}
```

注意 `ensureParentFirst` 对悬空 parentId（指向已删节点）天然安全：`byId.get` 未命中 → 跳过父，自身正常输出。

- [ ] **Step 4: 跑绿（补父先子后与悬空 parentId 专项用例）**

spec 文件追加：

```ts
describe('ensureParentFirst（spec §4.6 排序）', () => {
  it('子先父后的输入 → 输出父在前（index(parent) < index(child)）', () => {
    const child = rawNode('c1', 'videoGen', {}, { parentId: 'g1' });
    const parent = rawNode('g1', 'group', { groupType: 'normal', cells: ['c1'] });
    const out = buildFilteredSnapshot({ nodes: [child, parent], edges: [] }, base);
    expect(out.nodes.findIndex(n => n.id === 'g1')).toBeLessThan(out.nodes.findIndex(n => n.id === 'c1'));
  });
  it('悬空 parentId 不死循环不报错', () => {
    const out = buildFilteredSnapshot({ nodes: [rawNode('c1', 'videoGen', {}, { parentId: 'ghost' })], edges: [] }, base);
    expect(out.nodes).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @flowweb/api test -- snapshot-filter`
Expected: PASS 全绿

- [ ] **Step 5: 危险夹具用例（XSS 红线终验）**

```ts
it('危险夹具：content 嵌 <img onerror> → 输出纯文本无标签残留', () => {
  const input: RawCanvasData = { nodes: [rawNode('n1', 'textInput', { content: '<p>ok</p><img src=x onerror=alert(1)>' })], edges: [] };
  const out = buildFilteredSnapshot(input, base);
  expect(out.nodes[0].data.content).not.toContain('<');
  expect(out.nodes[0].data.content).toBe('ok');
});
```

Run 确认 PASS → **Step 6: Commit**

```bash
git add apps/api/src/modules/video-work/snapshot-filter.util.ts apps/api/src/modules/video-work/snapshot-filter.util.spec.ts
git commit -m "feat(video-work): 批次5 快照/克隆共用白名单纯函数（NODE_TYPES 键/HTML→纯文本/父先子后/edges 映射/未知全剥）"
```

### Task 5.2: 缩略图注入（fileId 批量查 → presign → 注入后剥 fileId）

**Files:**
- Modify: `video-work.service.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('injectThumbnails', () => {
  it('收集 fileId 批量查 Media.thumbnailKey → presign 注入 data.thumbnailUrl，响应不含 fileId', async () => {
    prisma.media.findMany = jest.fn().mockResolvedValue([
      { id: 'f1', thumbnailKey: 'thumbnails/f1.webp' },
      { id: 'f2', thumbnailKey: null },
    ]);
    minio.generatePresignedGetUrl = jest.fn().mockResolvedValue('http://minio/thumbs');
    const raw = {
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'a', html: 'b' }, fileId: 'f1' } },
        { id: 'n2', type: 'videoGen', position: { x: 0, y: 0 }, data: { model: 'm', fileId: 'f2' } },
      ],
      edges: [],
    };
    const out = await service.injectThumbnails(raw as any);
    expect(prisma.media.findMany).toHaveBeenCalledWith({ where: { id: { in: ['f1', 'f2'] } }, select: { id: true, thumbnailKey: true } });
    expect(out.nodes[0].data.thumbnailUrl).toBe('http://minio/thumbs'); // 有 thumbnail 的注入
    expect(out.nodes[1].data.thumbnailUrl).toBeUndefined();             // 无 thumbnail 不注入（前端占位）
    expect(out.nodes[0].data.fileId).toBe('f1');                        // 注入阶段保留 fileId，过滤阶段剥（管线顺序）
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
/** 产物缩略图注入（spec §4.6）：收集 fileId → 批量查 thumbnailKey → presign 注入 → 下游白名单剥 fileId */
async injectThumbnails(raw: RawCanvasData): Promise<RawCanvasData> {
  const fileIds = [...new Set(raw.nodes.map(n => (n.data as any)?.fileId).filter((f): f is string => !!f))];
  if (fileIds.length === 0) return raw;
  const medias = await this.prisma.media.findMany({ where: { id: { in: fileIds } }, select: { id: true, thumbnailKey: true } });
  const urlById = new Map<string, string>();
  await Promise.all(medias.filter(m => m.thumbnailKey).map(async m => {
    urlById.set(m.id, await this.presignWork(m.thumbnailKey!)); // presign 3600s + 短缓存复用
  }));
  for (const n of raw.nodes) {
    const fid = (n.data as any)?.fileId;
    if (typeof fid === 'string' && urlById.has(fid)) (n.data as any).thumbnailUrl = urlById.get(fid)!;
  }
  return raw;
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次5 缩略图注入（批量单查/presign/无 thumbnail 占位）"
```

### Task 5.3: GET /:id/process 端点（404/503 超时/缓存/键级安全验收）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加，含安全验收键级+正向）**

```ts
describe('getProcessSnapshot（安全验收）', () => {
  const work = { id: 'w1', title: 't', canvasProjectId: 'p1', allowViewProcess: true, status: 'PUBLISHED' };
  const rawCanvas = {
    nodes: [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '<p>一只猫在窗台上</p>', prompt: 'p' } },
      { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'cat', html: '<p>evil</p>' }, fileId: 'f1', mediaUrl: 'http://secret', mediaName: 'a.png' } },
    ],
    edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2' }],
  };

  function setup(over: any = {}) {
    prisma.videoWork.findUnique = jest.fn().mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue({ id: 'p1' });
    prisma.media.findMany = jest.fn().mockResolvedValue([]);
    (service as any).collabDoc = { readCanvas: jest.fn().mockResolvedValue(rawCanvas) };
    (service as any).redis.get = jest.fn().mockResolvedValue(null); // 无缓存
    (service as any).redis.set = jest.fn();
  }

  it('键级断言：响应全 key 不含敏感字段（递归收集）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const collectKeys = (o: any): string[] =>
      Array.isArray(o) ? o.flatMap(collectKeys) :
      o && typeof o === 'object' ? [...Object.keys(o), ...Object.values(o).flatMap(collectKeys)] : [];
    const keys = collectKeys(out);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'referencedImageIds', 'allImages', 'referenceImage', 'referenceVideo', 'referenceAudio', 'trimmedFileId', 'generationBatchId', 'mediaName', 'videoProjectId', 'origin', 'sourceId']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('正向断言：textInput 纯文本与 imageGen prompt.text 在（防 key 写错全绿）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const n1 = out.nodes.find((n: any) => n.id === 'n1')!;
    const n2 = out.nodes.find((n: any) => n.id === 'n2')!;
    expect(n1.data.content).toBe('一只猫在窗台上');
    expect(n2.data.prompt).toBe('cat');
  });

  it('edges 有 source/target 无 sourceId；缓存命中第二次不触 readCanvas', async () => {
    setup();
    await service.getProcessSnapshot('w1');
    await service.getProcessSnapshot('w1');
    const readCanvas = (service as any).collabDoc.readCanvas;
    expect(readCanvas).toHaveBeenCalledTimes(1);
  });

  it('DRAFT 或 allowViewProcess=false 或画布不存在 → 404', async () => {
    setup({ status: 'DRAFT' });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    setup({ allowViewProcess: false });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    prisma.canvasProject.findUnique = jest.fn().mockResolvedValue(null);
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
  });

  it('readCanvas 挂起 → 有界超时 503', async () => {
    setup();
    (service as any).collabDoc.readCanvas = jest.fn().mockImplementation(() => new Promise(() => {})); // 永不 resolve
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(ServiceUnavailableException);
  }, 10000);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service（注入 CollabDocumentService——module 已 import CollabModule）：

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { buildFilteredSnapshot, type RawCanvasData } from './snapshot-filter.util';

private static readonly PROCESS_CACHE = (id: string) => `videoWork:process:${id}`;

async getProcessSnapshot(id: string) {
  const w = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!w || w.status !== 'PUBLISHED' || !w.allowViewProcess || !w.canvasProjectId) throw new NotFoundException();
  const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
  if (!canvas) throw new NotFoundException(); // gateway 空 doc 坑前置校验（§4.6）

  const cacheKey = VideoWorkService.PROCESS_CACHE(id);
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const raw = await this.withTimeout(this.collabDoc.readCanvas(w.canvasProjectId), 5000) as RawCanvasData;
  const withThumbs = await this.injectThumbnails(raw);
  const filtered = buildFilteredSnapshot(withThumbs, {
    dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'],
    resetStatusIdle: false, injectThumbnails: true,
  });
  const result = { workId: id, title: w.title, ...filtered };
  await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // TTL 300s（§4.6）
  return result;
}

/** 有界等待（readCanvas 无读取超时——内部只有 SV 等待 3s；Promise.race 外套） */
private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new ServiceUnavailableException('画布读取超时')), ms))]);
}

/** 作品编辑/上下架/删除时清缓存（§4.6；updateWork/removeWork 已调用） */
async invalidateWorkCaches(id: string) {
  await this.redis.del(VideoWorkService.PROCESS_CACHE(id));
}
```

（若 Task 2.3/2.4 的 `invalidateWorkCaches` 当时是空实现/不存在，本步补齐并被既有调用引用。）

controller：

```ts
@Get(':id/process')
getProcess(@Param('id') id: string) {
  return this.service.getProcessSnapshot(id);
}
```

注意声明位置：`process` 也是静态段风格但带 `:id` 前缀（`/:id/process` 与 `/:id` 不冲突——参数+静态混合段，NestJS 不会吞），仍建议声明在 `getDetail` 之后无碍；`categories` 已在文件最前。

- [ ] **Step 4: 跑绿 + 批次 5 回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次5 process 端点（404 前置/5s 超时 503/300s 缓存/安全验收全绿）"
```

---

## 批次 6：克隆（四元重映射 + 整体超时 + 限流）

### Task 6.1: VideoWorkCloneService（核心编排，多步 TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/video-work-clone.service.ts`
- Create: `apps/api/src/modules/video-work/video-work-clone.service.spec.ts`
- Modify: `video-work.module.ts`（providers + VideoWorkCloneService）

- [ ] **Step 1: 写失败测试（四元重映射 fixture——spec §7.7 核心）**

```ts
import { Test } from '@nestjs/testing';
import { VideoWorkCloneService } from './video-work-clone.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

describe('VideoWorkCloneService.clone', () => {
  let svc: VideoWorkCloneService;
  let prisma: any; let collabDoc: any; let projectService: any; let rateLimiter: any;

  const work = { id: 'w1', title: '春天的背面', canvasProjectId: 'p1', allowClone: true, status: 'PUBLISHED' };

  /** fixture：分镜组（cells 含 存活子/被剥槽位/null/悬空 id）+ 组外节点 + videoEdit + shadow- */
  const rawCanvas = () => ({
    nodes: [
      { id: 'child1', type: 'videoGen', parentId: 'grp', position: { x: 1, y: 1 }, data: { model: 'm', fileId: 'f1', status: 'done', label: 'L' } },
      { id: 'grp', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['child1', 'edit1', null, 'ghost'] } },
      { id: 'child2', type: 'imageGen', parentId: 'grp', position: { x: 2, y: 2 }, data: { prompt: { text: 'p', html: 'h' }, allImages: [{ url: 'u' }] } },
      { id: 'edit1', type: 'videoEdit', parentId: 'grp', position: { x: 3, y: 3 }, data: { timeline: [] } },
      { id: 'shadow-x', type: 'imageGen', position: { x: 4, y: 4 }, data: {} },
    ],
    edges: [
      { id: 'e1', sourceId: 'child1', targetId: 'child2' },
      { id: 'e2', sourceId: 'child1', targetId: 'edit1' },   // 连向被剥节点 → 边剥除
      { id: 'e3', sourceId: 'shadow-x', targetId: 'child2' }, // 同上
    ],
  });

  beforeEach(async () => {
    prisma = { videoWork: { findUnique: jest.fn() }, canvasProject: { findUnique: jest.fn() } };
    collabDoc = { readCanvas: jest.fn() };
    projectService = { create: jest.fn() };
    rateLimiter = { checkUserRateLimit: jest.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkCloneService,
        { provide: PrismaService, useValue: prisma },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: ProjectService, useValue: projectService },
        { provide: RateLimiterService, useValue: rateLimiter },
      ],
    }).compile();
    svc = moduleRef.get(VideoWorkCloneService);
  });

  function setup(over: any = {}) {
    prisma.videoWork.findUnique.mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    collabDoc.readCanvas.mockResolvedValue(rawCanvas());
    projectService.create.mockImplementation((_n: string, _u: string, nodes: any[], edges: any[]) =>
      Promise.resolve({ id: 'new-p', nodes, edges }));
  }

  it('校验：未发布/不允许克隆/画布不存在 → 404/403', async () => {
    setup({ status: 'DRAFT' });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
    setup({ allowClone: false });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ForbiddenException);
    prisma.canvasProject.findUnique.mockResolvedValue(null);
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('克隆限流：每用户 10 次/h 超限 → 429', async () => {
    setup();
    rateLimiter.checkUserRateLimit.mockResolvedValue(false);
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ThrottlerException);
    expect(rateLimiter.checkUserRateLimit).toHaveBeenCalledWith('u1', 'video-work:clone', 3600, 10);
  });

  it('四元重映射：videoEdit/shadow- 剥除；parentId/cells 换新 id；悬空与被剥槽位 → null 且长度不变', async () => {
    setup();
    const { nodes: passedNodes } = await svc.clone('w1', 'u1');
    // projectService.create 收到的 nodes
    const grp = passedNodes.find((n: any) => n.type === 'group');
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(passedNodes.map((n: any) => n.type)).not.toContain('videoEdit');
    expect(passedNodes.map((n: any) => n.id)).not.toContain('shadow-x');
    expect(grp.data.cells).toHaveLength(4);                       // 长度不变
    expect(grp.data.cells[0]).toBe(child1.id);                    // 存活子 → 新 id
    expect(grp.data.cells[1]).toBeNull();                          // edit1 被剥 → null
    expect(grp.data.cells[2]).toBeNull();                          // 原 null 保持
    expect(grp.data.cells[3]).toBeNull();                          // 悬空 ghost → null
    expect(child1.parentId).toBe(grp.id);                          // parentId → 新组 id
    // 测试不变量：所有存活子节点新 id 均出现在新 cells 中
    const aliveChildren = passedNodes.filter((n: any) => n.parentId === grp.id);
    for (const c of aliveChildren) expect(grp.data.cells).toContain(c.id);
  });

  it('白名单共用：克隆体 data 不含 fileId/allImages/html/status(done)——status 重置 idle；不注入 thumbnailUrl', async () => {
    setup();
    const { nodes: passedNodes } = await svc.clone('w1', 'u1');
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(child1.data.fileId).toBeUndefined();
    expect(child1.data.status).toBe('idle');
    const child2 = passedNodes.find((n: any) => n.type === 'imageGen' && n.id !== 'shadow-x');
    expect(JSON.stringify(passedNodes)).not.toContain('allImages');
    expect(JSON.stringify(passedNodes)).not.toContain('thumbnailUrl');
  });

  it('边：相连被剥节点的边一并剥除；存活边 source/target 已重映射', async () => {
    setup();
    const { edges: passedEdges } = await svc.clone('w1', 'u1');
    expect(passedEdges).toHaveLength(1);
    const ids = new Set((await projectService.create.mock.calls[0][2] as any[]).map(n => n.id));
    expect(ids.has(passedEdges[0].source)).toBe(true);
    expect(ids.has(passedEdges[0].target)).toBe(true);
  });

  it('无旧 id 残留：新 nodes/edges 不含任何源 id', async () => {
    setup();
    const { nodes, edges } = await svc.clone('w1', 'u1');
    const oldIds = ['child1', 'grp', 'child2', 'edit1', 'shadow-x'];
    const serialized = JSON.stringify({ nodes, edges });
    for (const oid of oldIds) expect(serialized).not.toContain(`"${oid}"`);
  });

  it('create 阶段挂起 → 整体有界超时 503（read+create 同一等待）', async () => {
    setup();
    projectService.create.mockImplementation(() => new Promise(() => {}));
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ServiceUnavailableException);
  }, 10000);

  it('标题加 (副本) 后缀；归属 ProjectService.create（不传 teamId）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    expect(projectService.create.mock.calls[0][0]).toBe('春天的背面 (副本)');
    expect(projectService.create.mock.calls[0][1]).toBe('u1');
  });
});
```

（svc.clone 返回 `{ projectId, nodes, edges }` 形状仅为测试可断言——实际返回 `{ projectId }`，测试通过 projectService.create 的 mock calls 断言传入参。调整：让 clone 返回 `{ projectId }`，四元断言全部走 `projectService.create.mock.calls[0]`。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// video-work-clone.service.ts
import { Injectable, Inject, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { buildFilteredSnapshot, type RawCanvasData, type FilteredNode, type FilteredEdge } from './snapshot-filter.util';

const CLONE_TIMEOUT_MS = 10_000; // read + create 同一有界等待（create 内部 withDoc 同样会挂起）

@Injectable()
export class VideoWorkCloneService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
  ) {}

  async clone(workId: string, userId: string): Promise<{ projectId: string }> {
    const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:clone', 3600, 10);
    if (!allowed) throw new ThrottlerException();
    const w = await this.prisma.videoWork.findUnique({ where: { id: workId } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    if (!w.allowClone) throw new ForbiddenException();
    if (!w.canvasProjectId) throw new NotFoundException();
    const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
    if (!canvas) throw new NotFoundException();

    const run = async () => {
      const raw = await this.collabDoc.readCanvas(w.canvasProjectId!) as RawCanvasData;
      // 与快照共用白名单（D9）：克隆分支 resetStatusIdle + 不注入缩略图 + 额外剥 shadow-（快照也剥，口径一致）
      const filtered = buildFilteredSnapshot(raw, {
        dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'],
        resetStatusIdle: true, injectThumbnails: false,
      });
      const { nodes, edges } = this.remapIds(filtered.nodes, filtered.edges, raw.nodes);
      const project = await this.projectService.create(`${w.title} (副本)`, userId, nodes, edges);
      return { projectId: project.id };
    };
    return Promise.race([
      run(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new ServiceUnavailableException('克隆超时')), CLONE_TIMEOUT_MS)),
    ]);
  }

  /** 四元重映射（spec §4.7 红线）：id / parentId / edges source+target / group.data.cells。
   *  cells 三分支一律不抛（悬空 id 是可达真实状态）；禁止 idMap.get(id) || id 兜底。 */
  private remapIds(nodes: FilteredNode[], edges: FilteredEdge[], rawNodes: RawNode[]): { nodes: any[]; edges: FilteredEdge[] } {
    const droppedIds = new Set(
      rawNodes
        .filter(n => n.type === 'videoEdit' || n.id.startsWith('shadow-'))
        .map(n => n.id),
    );
    const idMap = new Map<string, string>();
    let seq = 0;
    const newId = () => `vw${Date.now().toString(36)}_${seq++}`;
    for (const n of nodes) idMap.set(n.id, newId());

    const remapped = nodes.map(n => ({ ...n, id: idMap.get(n.id)!, parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : n.parentId }));
    // parentId 指向被剥/悬空 → null（与 cells 同语义降级，勿一条抛一条兜）
    const remappedEdges = edges
      .filter(e => idMap.has(e.source) && idMap.has(e.target))
      .map(e => ({ ...e, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));

    for (const n of remapped) {
      if (n.type !== 'group' || !Array.isArray(n.data.cells)) continue;
      n.data.cells = (n.data.cells as (string | null)[]).map(c => {
        if (c === null || c === undefined) return null;      // 空宫格占位保持 null
        if (droppedIds.has(c)) return null;                   // 被剥槽位 → null
        const mapped = idMap.get(c);
        return mapped ?? null;                                // 悬空 id → null（禁 || c 兜底）；数组长度不变
      });
    }
    return { nodes: remapped, edges: remappedEdges };
  }
}
```

（`RawNode` 类型从 snapshot-filter.util 导入；module providers 追加 VideoWorkCloneService。）

- [ ] **Step 4: 跑绿（全部四元/白名单/超时/限流断言通过）**

Run: `pnpm --filter @flowweb/api test -- video-work-clone`
Expected: PASS

- [ ] **Step 5: Clone 端点 + 未登录 401**

controller（video-work.controller.ts）：

```ts
@Post(':id/clone')
clone(@Param('id') id: string, @Req() req: any) {
  if (!req.user?.id) throw new UnauthorizedException(); // 公开前缀下 optional auth（D4）
  return this.cloneService.clone(id, req.user.id);
}
```

controller spec 追加：未登录 req 无 user → 401；Template 不参与（无 templateService 调用——断言 service 不依赖 TemplateService，静态检查 import 即可）。

- [ ] **Step 6: 批次 5-6 全量回归 + Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次6 克隆（共用白名单/四元重映射禁兜底/status idle/整体超时/每用户限流）"
```

---

## 批次 7：前端列表页（/videos）

### Task 7.1: videoWorkApi.ts（含 /flowai 改写）

**Files:**
- Create: `apps/web/src/api/videoWorkApi.ts`

- [ ] **Step 1: 实现（api 封装无独立测试对象——由页面测试覆盖；/flowai 改写函数从 mediaApi 提取共用或复制同款）**

先看 `apps/web/src/api/mediaApi.ts:6` 的改写实现，将改写逻辑提为可复用函数（若 mediaApi 内是内联 replace，导出同名函数或在本文件复制同一行——**优先提取共用**，精准修改）：

```ts
import { apiFetch } from './client';
import type {
  VideoWorkListResult, VideoWorkDetail, VideoCategoryItem, ProcessSnapshotData,
} from '@flowweb/shared'; // 以 web 侧 shared 导入别名为准（grep 既有 import 方式）

/** /flowai 同源改写（视频 seek 依赖同源拿 Content-Range、img 避 CORS——mediaApi.ts:6 同款） */
export const toFlowaiUrl = (url: string) => url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

export async function fetchVideoWorks(params: { categoryId?: string; page?: number; pageSize?: number } = {}): Promise<VideoWorkListResult> {
  const q = new URLSearchParams();
  if (params.categoryId) q.set('categoryId', params.categoryId);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 20));
  return apiFetch(`/api/video-works?${q.toString()}`);
}

export async function fetchVideoCategories(): Promise<VideoCategoryItem[]> {
  return apiFetch('/api/video-works/categories');
}

export async function fetchVideoWorkDetail(id: string): Promise<VideoWorkDetail> {
  const d = await apiFetch(`/api/video-works/${id}`);
  return { ...d, videoUrl: toFlowaiUrl(d.videoUrl), coverUrl: d.coverUrl ? toFlowaiUrl(d.coverUrl) : null };
}

export async function recordView(id: string): Promise<void> {
  apiFetch(`/api/video-works/${id}/view`, { method: 'POST' }).catch(() => {}); // 计数失败静默
}

export async function toggleLike(id: string): Promise<{ liked: boolean; likeCount: number }> {
  return apiFetch(`/api/video-works/${id}/like`, { method: 'POST' });
}

export async function fetchProcessSnapshot(id: string): Promise<ProcessSnapshotData> {
  const snap = await apiFetch(`/api/video-works/${id}/process`);
  for (const n of snap.nodes) {
    if (typeof n.data.thumbnailUrl === 'string') n.data.thumbnailUrl = toFlowaiUrl(n.data.thumbnailUrl);
  }
  return snap;
}

export async function cloneWork(id: string): Promise<{ projectId: string }> {
  return apiFetch(`/api/video-works/${id}/clone`, { method: 'POST' });
}
```

- [ ] **Step 2: 编译验证 + Commit**

```bash
pnpm --filter @flowweb/web exec tsc -b --dry 2>/dev/null || pnpm --filter @flowweb/web build
git add apps/web/src/api/videoWorkApi.ts
git commit -m "feat(video-work): 批次7 videoWorkApi（/flowai 改写共用）"
```

### Task 7.2: VideoCard + VideosPage 列表（TDD）

**Files:**
- Create: `apps/web/src/pages/videos/VideoCard.tsx`、`VideosPage.tsx`
- Test: `apps/web/src/pages/videos/__tests__/VideosPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideosPage } from '../VideosPage';
import * as api from '@/api/videoWorkApi';
import type { VideoWorkListResult } from '@flowweb/shared';

vi.mock('@/api/videoWorkApi');

const listResult: VideoWorkListResult = {
  items: [
    { id: 'w1', title: '末班地铁', coverUrl: '/flowai/c.webp', durationSec: 204, tags: ['悬疑', 'AI真人'] },
    { id: 'w2', title: 'THE TURN', coverUrl: null, durationSec: null, tags: [] },
  ],
  total: 2, page: 1, pageSize: 20,
};

describe('VideosPage（D13 卡片裁剪）', () => {
  beforeEach(() => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue(listResult);
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0 }]);
  });

  it('卡片只含 封面/时长/标题/标签——不含作者/日期/计数', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('末班地铁'));
    const card = screen.getByText('末班地铁').closest('a, [data-card]');
    expect(screen.getByText('03:24')).toBeInTheDocument();      // 204s → mm:ss 角标
    expect(screen.getByText('悬疑')).toBeInTheDocument();
    // D13：不渲染作者/日期/观看/喜欢
    expect(screen.queryByText(/404_STUDIO/)).toBeNull();
    expect(screen.queryByText(/\d+月\d+/)).toBeNull();
    expect(screen.queryByText(/观看/)).toBeNull();
    expect(screen.queryByText(/♥/)).toBeNull();
  });

  it('无封面占位、null 时长无角标', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('THE TURN'));
    expect(screen.queryByText('00:00')).toBeNull();
  });

  it('类型 tab 含"全部"+数据项', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole('tab', { name: 'AI真人影视' }));
    expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web test -- VideosPage`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

```tsx
// VideoCard.tsx（D13：只有封面+时长+标题+标签）
import { Link } from 'react-router-dom';
import type { VideoWorkListItem } from '@flowweb/shared';

const fmtDuration = (sec: number | null) => {
  if (sec == null) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export function VideoCard({ work }: { work: VideoWorkListItem }) {
  const duration = fmtDuration(work.durationSec);
  return (
    <Link to={`/videos/${work.id}`} data-card className="block rounded-lg overflow-hidden border border-white/10 hover:border-white/25 transition-colors bg-[#1e1e1e] box-border">
      <div className="relative aspect-video bg-[#262626]">
        {work.coverUrl
          ? <img src={work.coverUrl} alt={work.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-white/30 text-sm">暂无封面</div>}
        {duration && (
          <span className="absolute right-1.5 bottom-1.5 bg-black/70 text-white text-[11px] rounded px-1 py-px" data-testid="duration">
            {duration}
          </span>
        )}
      </div>
      <div className="p-2.5 box-border">
        <div className="text-[13px] font-medium text-white truncate">{work.title}</div>
        {work.tags.length > 0 && (
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            {work.tags.map(t => (
              <span key={t} className="text-[11px] px-1.5 py-px rounded bg-white/10 text-white/70">{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
```

```tsx
// VideosPage.tsx（列表 + 类型 tab + 分页 + :id? 驱动 Modal——Modal 在批次 8 挂载）
import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Pagination, Tabs, Spin } from 'antd';
import { fetchVideoWorks, fetchVideoCategories } from '@/api/videoWorkApi';
import type { VideoWorkListItem, VideoCategoryItem } from '@flowweb/shared';
import { VideoCard } from './VideoCard';
import { CardGridSkeleton } from '@/components/CardGridSkeleton'; // 路径以实际组件位置为准
import { EmptyState } from '@/components/EmptyState';

export function VideosPage() {
  const { id: activeWorkId } = useParams();           // 单路由 /videos/:id? 驱动 Modal
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('categoryId') ?? undefined;
  const page = Number(searchParams.get('page') ?? 1);

  const [items, setItems] = useState<VideoWorkListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<VideoCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchVideoCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    fetchVideoWorks({ categoryId, page, pageSize: 20 })
      .then(r => { setItems(r.items); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [categoryId, page]);

  const onTabChange = useCallback((key: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (key === 'all') next.delete('categoryId'); else next.set('categoryId', key);
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto box-border">
      <Tabs
        activeKey={categoryId ?? 'all'}
        onChange={onTabChange}
        items={[{ key: 'all', label: '全部' }, ...categories.map(c => ({ key: c.id, label: c.name }))]}
      />
      {loading ? <CardGridSkeleton /> : items.length === 0 ? <EmptyState /> : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {items.map(w => <VideoCard key={w.id} work={w} />)}
        </div>
      )}
      {!loading && total > 20 && (
        <div className="flex justify-center mt-6">
          <Pagination current={page} total={total} pageSize={20}
            onChange={p => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; })} />
        </div>
      )}
      {/* 批次 8：<VideoPlayerModal workId={activeWorkId} /> 在此挂载 */}
    </div>
  );
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideosPage
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次7 列表页（D13 卡片裁剪/tab/分页/骨架屏）"
```

### Task 7.3: 路由 + Sidebar + token + 不重挂用例

**Files:**
- Modify: `apps/web/src/router.tsx`（公开组 + lazy）、`apps/web/src/components/layout/Sidebar.tsx:12-17`、`apps/web/src/index.css`（新 token）
- Test: `apps/web/src/pages/videos/__tests__/route.integration.test.tsx`

- [ ] **Step 1: 写失败测试（单路由不重挂——D5 承重墙 + admin 路由存在性）**

```tsx
import { render, screen, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import * as api from '@/api/videoWorkApi';

vi.mock('@/api/videoWorkApi');

// 路由不重挂：Modal 开关前后列表 API 只调 1 次
it('Modal 开关前后 fetchVideoWorks 仅调用 1 次（断言点在动画后）', async () => {
  vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [{ id: 'w1', title: 'T', coverUrl: null, durationSec: 1, tags: [] }], total: 1, page: 1, pageSize: 20 });
  vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue({ id: 'w1', title: 'T', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null, viewCount: 0, likeCount: 0, liked: false, description: null, authorName: 'a', publishedAt: '2026-09-01', width: null, height: null, canViewProcess: false, canClone: false, durationSec: 1, tags: [] });

  const router = createMemoryRouter([
    { path: '/videos/:id?', element: <VideosPageStub /> },
  ], { initialEntries: ['/videos'] });
  render(<RouterProvider router={router} />);

  await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1));
  await act(async () => { router.navigate('/videos/w1'); });
  await act(async () => { router.navigate('/videos'); });
  await act(async () => { vi.runAllTimers?.(); }); // 动画期后再断言
  expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1); // 不重挂 → 不重取
});
```

（VideosPageStub 引入真实 VideosPage + 已挂载的 Modal 组件——本任务先以无 Modal 版本通过，批次 8 后补充完整断言并保持绿。admin 路由存在性断言放在 Task 10.2。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

router.tsx 公开组追加（**lazy**，spec §5.1；与既有 lazy 页面写法一致——grep `lazy(` 参照）：

```tsx
const VideosPage = lazy(() => import('./pages/videos/VideosPage').then(m => ({ default: m.VideosPage })));
// 公开组 children 追加：
{ path: '/videos/:id?', element: <VideosPage /> },   // 可选参数单路由（防两条平级路由整页重挂）
```

Sidebar.tsx NAV_ITEMS 在「模板广场」后插入（D14）：

```tsx
{ label: '视频作品', href: '/videos', icon: <VideoCameraOutlined /> }, // icon 从 @ant-design/icons 导入
```

index.css 追加本功能 token（§6：显式定义并登记）：

```css
:root {
  --vw-card-bg: #1e1e1e;        /* 作品卡面 */
  --vw-card-border: rgba(255,255,255,0.10);
  --vw-card-border-hover: rgba(255,255,255,0.25);
}
```

- [ ] **Step 4: 跑绿 + 既有路由/Sidebar 测试回归（Sidebar.test 无计数断言应全绿）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
git add apps/web/src/router.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/index.css apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次7 路由 /videos/:id?（lazy）+ Sidebar 第5项 + token + 不重挂用例"
```

---

## 批次 8：播放 Modal（外壳/播放视图/轮播/页内登录）

### Task 8.1: VideoPlayerModal 外壳（关闭算法 模式 A，TDD 四场景）

**Files:**
- Create: `apps/web/src/pages/videos/VideoPlayerModal.tsx`
- Test: `apps/web/src/pages/videos/__tests__/VideoPlayerModal.test.tsx`

- [ ] **Step 1: 写失败测试（关闭算法四场景——spec §7 前端 2）**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/api/videoWorkApi';

vi.mock('@/api/videoWorkApi');
vi.mock('@/components/BaseFullscreenModal', () => ({
  BaseFullscreenModal: ({ open, children }: any) => open ? <div data-testid="modal">{children}</div> : null,
}));

const detail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };

function renderAt(initial: string, state?: any) {
  const router = createMemoryRouter([{ path: '/videos/:id?', element: <div>VLIST<button onClick={() => router.navigate('/videos/w1', { state })>open</button></div> }],
    { initialEntries: initial === '/videos/w1' ? [{ pathname: '/videos/w1', state }] : [initial] });
  // VideosPage 含 Modal 挂载（简化：直接渲染 modal 组件由路由驱动）
  render(<RouterProvider router={router} />);
  return router;
}

describe('关闭算法（模式 A：state.fromList）', () => {
  beforeEach(() => {
    vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detail as any);
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  });

  it('场景1 列表进入 → 关闭 navigate(-1) 回列表', async () => {
    const router = renderAt('/videos');
    fireEvent.click(screen.getByText('open')); // state:{fromList:true}
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景2 直链进入（无 state）→ 关闭 replace 到 /videos', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景3 直链→轮播(继承 null state)→关闭 → 落 /videos 不退出站点', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('carousel-item-w2')); // 轮播切换 replace+location.state 继承
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景4 列表→轮播(继承 fromList)→关闭 → 回列表而非上一作品', async () => {
    const router = renderAt('/videos');
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('carousel-item-w2'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });
});
```

（轮播 mock 需要 fetchVideoWorks 返回 w2；fixture 按需补第二条 items。）

- [ ] **Step 2: 跑红 → Step 3: 实现外壳**

```tsx
// VideoPlayerModal.tsx（外壳：路由驱动开关 + 关闭算法 + 视图切换）
import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { fetchVideoWorkDetail, recordView } from '@/api/videoWorkApi';
import type { VideoWorkDetail } from '@flowweb/shared';
import { PlayView } from './PlayView';          // Task 8.2
import { ProcessView } from './ProcessView';    // Task 9.2
import { CarouselBar } from './CarouselBar';    // Task 8.3

export function VideoPlayerModal() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<VideoWorkDetail | null>(null);
  const [view, setView] = useState<'play' | 'process'>('play');

  useEffect(() => {
    if (!id) { setDetail(null); setView('play'); return; }   // id 消失 → 关闭并复位
    setDetail(null); setView('play');
    fetchVideoWorkDetail(id).then(setDetail).catch(() => navigate('/videos', { replace: true })); // 404 → 回列表
    recordView(id);                                          // view 单点埋点（打开时，D15）
  }, [id]);

  /** 关闭算法（模式 A）：fromList → navigate(-1)；否则 replace /videos */
  const close = useCallback(() => {
    if ((location.state as any)?.fromList) navigate(-1);
    else navigate('/videos', { replace: true });
  }, [location.state, navigate]);

  if (!id || !detail) return null;

  return (
    <BaseFullscreenModal open onClose={close} label="视频作品预览" closeOnBackdrop={false}>
      <div className="relative h-full w-full bg-black text-white">
        {view === 'play'
          ? <PlayView detail={detail} onViewProcess={() => setView('process')} onNeedLogin={() => { /* Task 8.4 LoginModal */ }} />
          : <ProcessView workId={detail.id} title={detail.title} canClone={detail.canClone} onBack={() => setView('play')} />}
        <CarouselBar currentId={detail.id} categoryId={detail.categoryId} onSwitch={(wid) =>
          navigate(`/videos/${wid}`, { replace: true, state: location.state })} />  {/* 继承 state 原值透传（§5.1） */}
        <button data-testid="close-btn" onClick={close} className="absolute top-3 right-3 z-10 rounded-lg bg-[rgba(50,50,50,0.45)] px-3 py-1.5 text-sm backdrop-blur-[6px]">✕ 关闭</button>
      </div>
    </BaseFullscreenModal>
  );
}
```

- [ ] **Step 4: 跑绿（本任务先以 PlayView/ProcessView/CarouselBar 为最简占位组件通过外壳测试——注意：占位仅限外壳联动所需 data-testid，Task 8.2/8.3/9.2 替换为真实实现并保持全绿）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideoPlayerModal
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 Modal 外壳（模式A关闭算法四场景/state 原值透传）"
```

### Task 8.2: PlayView 播放视图（播放器/顶栏/喜欢/分享/onError 自愈）

**Files:**
- Create: `apps/web/src/pages/videos/PlayView.tsx`
- Test: `apps/web/src/pages/videos/__tests__/PlayView.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
describe('PlayView', () => {
  it('顶栏：作者名 + 发布于 {publishedAt}（D13 日期定案）', async () => {
    renderPlay(detail);
    expect(screen.getByText('作者')).toBeInTheDocument();
    expect(screen.getByText(/发布于/)).toBeInTheDocument();
  });

  it('canViewProcess=false → 无「查看制作过程」按钮', () => {
    renderPlay(detail); // detail.canViewProcess=false
    expect(screen.queryByRole('button', { name: /制作过程/ })).toBeNull();
  });

  it('喜欢：liked=true 初始高亮；点击 toggle 调 API 且以响应为准', async () => {
    vi.mocked(api.toggleLike).mockResolvedValue({ liked: false, likeCount: 4 });
    renderPlay({ ...detail, liked: true });
    const btn = screen.getByRole('button', { name: /喜欢/ });
    expect(btn).toHaveAttribute('data-liked', 'true');
    fireEvent.click(btn);
    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith('w1'));
    await waitFor(() => expect(btn).toHaveAttribute('data-liked', 'false')); // 响应为准
  });

  it('分享：clipboard 写入当前 URL + message', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } };
    renderPlay(detail);
    fireEvent.click(screen.getByRole('button', { name: /分享/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it('视频 onError → 重拉详情刷新 URL（TTL 自愈）', async () => {
    const { rerender } = renderPlay(detail);
    fireEvent.error(screen.getByTestId('video'));
    await waitFor(() => expect(api.fetchVideoWorkDetail).toHaveBeenCalledTimes(2));
  });

  it('viewCount/likeCount 展示：简介浮层显示观看数、喜欢钮带计数（§6）', () => {
    renderPlay(detail); // viewCount:10 likeCount:5
    expect(screen.getByText(/10/)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// PlayView.tsx
import { useState, useCallback } from 'react';
import { message } from 'antd';
import { fetchVideoWorkDetail, toggleLike } from '@/api/videoWorkApi';
import type { VideoWorkDetail } from '@flowweb/shared';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function PlayView({ detail, onViewProcess, onNeedLogin, onDetailRefresh }: {
  detail: VideoWorkDetail;
  onViewProcess: () => void;
  onNeedLogin: () => void;
  onDetailRefresh: () => void; // onError 自愈回调
}) {
  const [liked, setLiked] = useState(detail.liked);
  const [likeCount, setLikeCount] = useState(detail.likeCount);
  const [playing, setPlaying] = useState(false);

  const onLike = useCallback(async () => {
    if (!isLoggedIn()) { onNeedLogin(); return; }   // D15/D18：未登录 → 页内 LoginModal（Task 8.4 接入）
    try {
      const res = await toggleLike(detail.id);      // 以响应为准
      setLiked(res.liked); setLikeCount(res.likeCount);
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else message.error('操作失败');
    }
  }, [detail.id]);

  const onShare = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    message.success('链接已复制');
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* 顶栏：作者 | 标题 …… 发布于（D13）+含 AI 生成内容 */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-6 bg-gradient-to-b from-black/60 to-transparent">
        <span className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
        <span className="text-sm md:text-base">{detail.authorName}</span>
        <span className="w-px h-4 bg-white/20" />
        <span className="flex-1 truncate text-sm md:text-base">{detail.title}</span>
        <span className="hidden sm:block text-sm text-white/90">发布于 {fmtDate(detail.publishedAt)}</span>
        <span className="text-xs text-white/60">含 AI 生成内容</span>
      </div>

      {/* 视频区 */}
      <div className="flex-1 relative flex items-center justify-center">
        {playing ? (
          <video data-testid="video" src={detail.videoUrl} controls autoPlay playsInline
            className="h-full w-full object-contain"
            onError={() => onDetailRefresh()} />
        ) : (
          <div className="flex items-center gap-3">
            <button onClick={() => setPlaying(true)} aria-label="立即观看"
              className="h-9 md:h-10 rounded-full bg-white text-[#171717] px-5 text-sm font-semibold hover:bg-white/90">▶ 立即观看</button>
            {detail.canViewProcess && (
              <button onClick={onViewProcess} aria-label="查看制作过程"
                className="h-9 md:h-10 rounded-full bg-[rgba(50,50,50,0.45)] px-4 text-sm backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)]">⌗ 查看制作过程</button>
            )}
            <button onClick={onLike} aria-label="喜欢" data-liked={liked}
              className={`h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)] ${liked ? 'text-[#4ade80]' : ''}`}>
              ♥<span className="ml-1 text-xs">{likeCount}</span>
            </button>
            <button onClick={onShare} aria-label="分享"
              className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px]">⇪</button>
          </div>
        )}
      </div>

      {/* 简介浮层（常显，§6）：简介 + 标签 + 观看数 */}
      <div className="px-4 md:px-8 pb-2 max-w-[420px] text-xs text-white/75 leading-relaxed">
        {detail.description}
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {detail.tags.map(t => <span key={t} className="px-1.5 py-px rounded bg-white/15 text-[11px]">{t}</span>)}
          <span className="text-white/50">观看 {detail.viewCount}</span>
        </div>
      </div>
    </div>
  );
}
```

（`isLoggedIn()` 从 AuthProvider 的 useAuth 取——以项目实际 hook 名为准；Modal 外壳的 onDetailRefresh 重新 fetch 详情并 setDetail。）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- PlayView
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 播放视图（发布于 publishedAt/喜欢响应为准/分享/onError 自愈）"
```

### Task 8.3: CarouselBar（设置驱动 + replace 切换）

**Files:**
- Create: `apps/web/src/pages/videos/CarouselBar.tsx`
- Test: `apps/web/src/pages/videos/__tests__/CarouselBar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
describe('CarouselBar', () => {
  it('carouselEnabled=false → 不渲染', async () => {
    renderBar({ carouselEnabled: false });
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
  });
  it('scope=all：请求不带 categoryId；过滤当前作品；最多 10 条', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, title: `t${i}`, coverUrl: null, durationSec: 1, tags: [] })), total: 11, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    await waitFor(() => screen.getByTestId('carousel'));
    expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 11 })); // 11 条再过滤（§4.2）
    expect(screen.getAllByTestId(/^carousel-item-/)).toHaveLength(10);
  });
  it('scope=category：带当前作品 categoryId；categoryId null → 降级 all', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'category' }, 'w1', 'cat9');
    await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat9' })));
  });
  it('点击切换调 onSwitch', async () => {
    /* fixture 2 条，点击 w2 → onSwitch('w2') */
  });
});
```

（设置来自 admin settings 的公开读取——**公开端点需返回轮播设置**：在 GET /api/video-works/categories 同域追加或在列表响应附 settings。**实施决定**：公开端点 `GET /api/video-works/settings`（无需鉴权的两个运营开关，非敏感）——service 复用 getSettings()，controller 静态段追加一行，测试一条。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// CarouselBar.tsx
import { useEffect, useState } from 'react';
import { fetchVideoWorks } from '@/api/videoWorkApi';
import { getPublicSettings } from '@/api/videoWorkApi'; // 新增：GET /api/video-works/settings
import type { VideoWorkListItem, VideoWorkSettings } from '@flowweb/shared';

export function CarouselBar({ currentId, categoryId, onSwitch }: {
  currentId: string; categoryId: string | null; onSwitch: (workId: string) => void;
}) {
  const [settings, setSettings] = useState<VideoWorkSettings | null>(null);
  const [items, setItems] = useState<VideoWorkListItem[]>([]);

  useEffect(() => { getPublicSettings().then(setSettings).catch(() => setSettings({ carouselEnabled: true, carouselScope: 'all' })); }, []);
  useEffect(() => {
    if (!settings?.carouselEnabled) return;
    fetchVideoWorks({
      categoryId: settings.carouselScope === 'category' ? (categoryId ?? undefined) : undefined, // null → 降级 all
      page: 1, pageSize: 11,
    }).then(r => setItems(r.items.filter(w => w.id !== currentId).slice(0, 10))); // 过滤当前 + 最多10
  }, [settings, categoryId, currentId]);

  if (!settings?.carouselEnabled || items.length === 0) return null;
  return (
    <div data-testid="carousel" className="absolute bottom-0 inset-x-0 flex gap-2 px-4 py-3 overflow-x-auto z-10">
      {items.map(w => (
        <button key={w.id} data-testid={`carousel-item-${w.id}`} onClick={() => onSwitch(w.id)}
          className="relative shrink-0 w-[110px] aspect-video rounded-md overflow-hidden ring-1 ring-white/20 hover:ring-white/60 transition-all">
          {w.coverUrl ? <img src={w.coverUrl} alt={w.title} className="w-full h-full object-cover" loading="lazy" />
                       : <div className="w-full h-full bg-white/10" />}
        </button>
      ))}
    </div>
  );
}
```

api 补充：`export async function getPublicSettings(): Promise<VideoWorkSettings> { return apiFetch('/api/video-works/settings'); }`；后端 controller 静态段追加 `@Get('settings') getSettings() { return this.service.getSettings(); }`（settings 静态段已在 admin 侧验证声明序，公开侧同规则）+ 一条 controller 测试。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- CarouselBar
git add apps/web/src/
git commit -m "feat(video-work): 批次8 底部轮播（设置驱动/11取10/replace 切换/降级 all）"
```

### Task 8.4: 页内 LoginModal 集成（嵌套 ConfigProvider 抬 z）

**Files:**
- Modify: `apps/web/src/pages/videos/VideoPlayerModal.tsx`（onNeedLogin 落地）
- Test: `apps/web/src/pages/videos/__tests__/LoginInModal.test.tsx`

- [ ] **Step 1: 写失败测试（jsdom 结构断言——z-index 层叠效果走浏览器手工验收，§7.5）**

```tsx
describe('播放 Modal 内页内登录', () => {
  it('onNeedLogin → 渲染 LoginModal 且被 ConfigProvider(token.zIndexPopupBase=100000) 包裹', async () => {
    renderModalWithNeedLogin();
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ })); // 未登录触发
    await waitFor(() => screen.getByTestId('login-modal-root'));
    // 结构断言：Provider 包裹（通过 ConfigProvider 注入的 token 传递到 antd Modal 的 style 上限不了 jsdom——
    // 断言包裹组件存在：查找包含 zIndexPopupBase 的 Provider 上下文包装节点
    expect(screen.getByTestId('login-modal-root').closest('[data-zprovider="true"]')).toBeTruthy();
  });
});
```

（实现时在包裹层加 `data-zprovider="true"` 供结构断言——这是**测试锚点**而非业务属性。）

- [ ] **Step 2: 跑红 → Step 3: 实现（Modal 内登录层）**

```tsx
// VideoPlayerModal.tsx 内新增组件与状态
import { ConfigProvider } from 'antd';
import { LoginModal } from '@/components/auth/LoginModal';

function LoginInModalLayer({ onClose }: { onClose: () => void }) {
  return (
    <div data-zprovider="true">
      <ConfigProvider theme={{ token: { zIndexPopupBase: 100000 } }}>  {/* D18：Modal z=100100>100000，内层弹层全抬高，AuthModal 分支天然覆盖 */}
        <LoginModal onClose={onClose} />
      </ConfigProvider>
    </div>
  );
}

// VideoPlayerModal 内：
const [showLogin, setShowLogin] = useState(false);
// PlayView 的 onNeedLogin={() => setShowLogin(true)}
{showLogin && <LoginInModalLayer onClose={() => setShowLogin(false)} />}
```

- [ ] **Step 4: 跑绿；浏览器手工验收登记（批次 11 清单项）：未登录 → 播放 Modal 内点喜欢 → 登录框可见可点、Esc 先关登录框不误关播放 Modal → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- LoginInModal
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 页内登录（嵌套 ConfigProvider 抬 z，D18）"
```

---

## 批次 9：创作过程视图（ProcessSnapshot 只读渲染）

### Task 9.1: ProcessSnapshot 组件（Handle 红线/组框/纯文本，TDD）

**Files:**
- Create: `apps/web/src/pages/videos/ProcessSnapshot.tsx`
- Test: `apps/web/src/pages/videos/__tests__/ProcessSnapshot.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProcessSnapshot } from '../ProcessSnapshot';
import type { ProcessSnapshotData } from '@flowweb/shared';

const snap: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'n2', type: 'imageGen', position: { x: 300, y: 0 }, data: { prompt: 'cat', thumbnailUrl: '/flowai/th.webp' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n3'] } },
    { id: 'n3', type: 'videoGen', position: { x: 520, y: 20 }, parentId: 'g1', data: { label: '导出 1' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

describe('ProcessSnapshot（spec §5.3 红线）', () => {
  it('每个节点渲染默认 Handle×2：.react-flow__handle 数 === nodes×2', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(snap.nodes.length * 2);   // 缺 Handle → 边全丢（error008）
  });

  it('纯文本渲染：无 dangerouslySetInnerHTML（文本节点直出）', () => {
    const { container, getByText } = render(<ProcessSnapshot snapshot={snap} />);
    expect(getByText('一只猫在窗台上')).toBeInTheDocument();
    expect(container.querySelector('[dangerouslysetinnerhtml]')).toBeNull();
  });

  it('缩略图展示：thumbnailUrl 渲染为 img', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('img[src="/flowai/th.webp"]')).toBeTruthy();
  });

  it('组框：groupType=storyboard 渲染分镜样式（data-group-type 标记）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('[data-group-type="storyboard"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// ProcessSnapshot.tsx —— 零 store 依赖（§5.3 禁复用 CanvasView），只依赖 @xyflow/react + 静态数据
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProcessSnapshotData, SnapshotNode } from '@flowweb/shared';

const TYPE_LABEL: Record<string, string> = {
  textInput: '剧本文本', imageGen: '图片生成', imageExtGen: '图片生成', videoGen: '视频生成',
  audioGen: '语音合成', multiImageGen: '分镜宫格', group: '分组', videoEdit: '视频剪辑',
};

/** 简版节点：类型图标+类型名+序号+白名单文本；Handle 红线——每节点默认 target 左 / source 右（无 id） */
function SimpleNode({ data, selected }: any) {
  const d = data as { __type: string; __label: string; content?: string; prompt?: string; thumbnailUrl?: string };
  return (
    <div className="w-[160px] rounded-lg border border-white/15 bg-[#1e1e1e] px-2.5 py-2 box-border" data-node-type={d.__type}>
      <div className="text-[11px] font-semibold text-white/80">{d.__label}</div>
      {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" className="mt-1 w-full aspect-video object-cover rounded" loading="lazy" />}
      {typeof d.content === 'string' && d.content && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.content}</div>}
      {typeof d.prompt === 'string' && d.prompt && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.prompt}</div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { simple: SimpleNode };

export function ProcessSnapshot({ snapshot }: { snapshot: ProcessSnapshotData }) {
  const { nodes, edges } = useMemo(() => {
    const seqByType: Record<string, number> = {};
    const ns: Node[] = snapshot.nodes.map((n: SnapshotNode) => {
      const seq = (seqByType[n.type] = (seqByType[n.type] ?? 0) + 1);
      return {
        id: n.id,
        type: n.type === 'group' ? 'group' : 'simple',
        position: n.position,
        width: n.width, height: n.height,
        parentId: n.parentId ?? undefined,
        data: { ...n.data, __type: n.type, __label: `${TYPE_LABEL[n.type] ?? n.type} ${seq}` },
      } as Node;
    });
    const es: Edge[] = snapshot.edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
    return { nodes: ns, edges: es };
  }, [snapshot]);

  return (
    <div className="h-full w-full" data-testid="process-snapshot">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnDrag zoomOnScroll fitView fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#3a3a3a" />
      </ReactFlow>
    </div>
  );
}
```

（组框：React Flow 内置 `type: 'group'` 节点即容器框；storyboard 样式区分通过 SimpleNode 不适用于 group——group 用默认框 + 外层 `data-group-type` 标记由样式钩子输出。实施时若内置 group 节点无法带自定义标记，用自定义 GroupFrame 组件（同样渲染 Handle）替代，测试断言不变。）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- ProcessSnapshot
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次9 只读快照渲染（Handle 红线×2/组框/纯文本/缩略图）"
```

### Task 9.2: ProcessView 集成（顶栏/复制项目/打开画布）

**Files:**
- Create: `apps/web/src/pages/videos/ProcessView.tsx`
- Test: `apps/web/src/pages/videos/__tests__/ProcessView.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
describe('ProcessView', () => {
  it('顶栏：作品标题 + 返回 + 复制项目按钮（canClone=false 不渲染）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    render(<ProcessView workId="w1" title="t" canClone={false} onBack={() => {}} />);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    expect(screen.queryByRole('button', { name: /复制项目/ })).toBeNull();
  });

  it('克隆成功 → toast + 「打开画布」跳 /canvas?projectId=（先例 WorkspaceDimension.tsx:93）', async () => {
    vi.mocked(api.cloneWork).mockResolvedValue({ projectId: 'new-p' });
    render(<ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} />);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ }));
    await waitFor(() => screen.getByRole('button', { name: /打开画布/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开画布/ }));
    // 断言 navigate('/canvas?projectId=new-p')——用 router spy 或 location 断言
  });

  it('未登录克隆 → onNeedLogin（页内 LoginModal，不跳转）', async () => {
    /* isAuth=false fixture → 点击复制项目 → onNeedLogin 被调 */
  });

  it('快照 503/404 → 错误态 + 返回按钮（不白屏）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockRejectedValue(new Error('x'));
    render(<ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} />);
    await waitFor(() => screen.getByText(/暂时无法加载/));
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// ProcessView.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { fetchProcessSnapshot, cloneWork } from '@/api/videoWorkApi';
import type { ProcessSnapshotData } from '@flowweb/shared';
import { ProcessSnapshot } from './ProcessSnapshot';

export function ProcessView({ workId, title, canClone, onBack, onNeedLogin }: {
  workId: string; title: string; canClone: boolean; onBack: () => void; onNeedLogin: () => void;
}) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ProcessSnapshotData | null>(null);
  const [error, setError] = useState(false);
  const [cloned, setCloned] = useState<{ projectId: string } | null>(null);

  useEffect(() => {
    fetchProcessSnapshot(workId).then(setSnap).catch(() => setError(true));
  }, [workId]);

  const onClone = async () => {
    if (!isLoggedIn()) { onNeedLogin(); return; }   // D18
    try {
      const res = await cloneWork(workId);
      setCloned(res);
      message.success('已克隆工作流（产物需重新生成）');
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else if (e.status === 429) message.warning('克隆太频繁，请稍后再试');
      else message.error('克隆失败');
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[#141414]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#1e1e1e] border-b border-white/10 shrink-0">
        <button onClick={onBack} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">‹ 返回</button>
        <span className="flex-1 truncate text-sm">{title} · 创作过程</span>
        {canClone && !cloned && (
          <button onClick={onClone} className="rounded-lg bg-[#4ade80] text-[#111] px-3.5 py-1.5 text-sm font-semibold hover:opacity-90">复制项目</button>
        )}
        {cloned && (
          <button onClick={() => navigate(`/canvas?projectId=${cloned.projectId}`)}
            className="rounded-lg bg-[#4ade80] text-[#111] px-3.5 py-1.5 text-sm font-semibold">打开画布</button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white/60">
            <span>暂时无法加载创作过程</span>
            <button onClick={onBack} className="rounded-lg bg-white/10 px-4 py-1.5 text-sm">返回</button>
          </div>
        ) : snap ? <ProcessSnapshot snapshot={snap} /> : <div className="h-full flex items-center justify-center text-white/40">加载中…</div>}
      </div>
    </div>
  );
}
```

（VideoPlayerModal 外壳的 ProcessView 调用补上 onNeedLogin；isLoggedIn 与 PlayView 同源。）

- [ ] **Step 4: 跑绿（批次 7-9 联动：外壳测试中的 ProcessView 占位换真实实现后全绿）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次9 创作过程视图（复制项目/打开画布/503 容错）"
```

---

## 批次 10：Admin 前端

### Task 10.1: VideoWorksPage 作品管理（ProTable + ModalForm）

**Files:**
- Create: `apps/web/src/pages/admin/pages/VideoWorksPage.tsx`
- Modify: `apps/web/src/pages/admin/AdminLayout.tsx`（菜单项——先 grep 菜单注册结构，插入「视频作品」到内容管理区）
- Modify: `apps/web/src/api/adminApi.ts`（追加 videoWork 系列）
- Test: `apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`

- [ ] **Step 1: 写失败测试（含 admin 路由存在性——router.admin.test 覆盖缺口的自我补偿，spec §7 触点）**

```tsx
import { router } from '@/router'; // 以实际导出为准

it('/admin/content/video-works 路由存在（router.admin.test 过滤器不覆盖 content/，自建断言）', () => {
  const flat = JSON.stringify(router.routes);
  expect(flat).toContain('video-works');
});

it('作品表格列：标题/类型/状态/观看/喜欢/排序', async () => {
  /* mock adminApi.listVideoWorks 返回 1 条 → 断言列头与数据渲染（antd 两字按钮空格查询坑：查询「上 架」类文案注意） */
});

it('ModalForm 含候选下拉（candidates）/两开关/标签 tags 模式/封面控件', async () => {
  /* mock fetchCandidates → 打开新增 → 断言控件存在 */
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（adminApi + 页面）**

adminApi.ts 追加（沿用该文件既有 fetch 封装风格）：

```ts
export const adminVideoWorkApi = {
  listWorks: (page = 1, pageSize = 20) => adminFetch(`/api/admin/video-works?page=${page}&pageSize=${pageSize}`),
  createWork: (data: unknown) => adminFetch('/api/admin/video-works', { method: 'POST', body: JSON.stringify(data) }),
  updateWork: (id: string, data: unknown) => adminFetch(`/api/admin/video-works/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWork: (id: string) => adminFetch(`/api/admin/video-works/${id}`, { method: 'DELETE' }),
  listCandidates: (page = 1) => adminFetch(`/api/admin/video-works/candidates?page=${page}&pageSize=20`),
  uploadCover: (file: File) => { const fd = new FormData(); fd.append('file', file); return adminFetch('/api/admin/video-works/upload-cover', { method: 'POST', body: fd }); },
  listCategories: () => adminFetch('/api/admin/video-works/categories'),
  createCategory: (d: unknown) => adminFetch('/api/admin/video-works/categories', { method: 'POST', body: JSON.stringify(d) }),
  updateCategory: (id: string, d: unknown) => adminFetch(`/api/admin/video-works/categories/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteCategory: (id: string) => adminFetch(`/api/admin/video-works/categories/${id}`, { method: 'DELETE' }),
  listTags: () => adminFetch('/api/admin/video-works/tags'),
  createTag: (d: unknown) => adminFetch('/api/admin/video-works/tags', { method: 'POST', body: JSON.stringify(d) }),
  updateTag: (id: string, d: unknown) => adminFetch(`/api/admin/video-works/tags/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteTag: (id: string) => adminFetch(`/api/admin/video-works/tags/${id}`, { method: 'DELETE' }),
  getSettings: () => adminFetch('/api/admin/video-works/settings'),
  updateSettings: (d: unknown) => adminFetch('/api/admin/video-works/settings', { method: 'PUT', body: JSON.stringify(d) }),
};
```

（`adminFetch` 名以文件内既有封装为准。）

VideoWorksPage.tsx 骨架（ProTable + ModalForm，完整字段清单，模式参照 HomeBannersPage.tsx）：

```tsx
// 核心结构（完整页面按 HomeBannersPage 模式补齐布局与上传内联逻辑）
<ProTable
  columns={[
    { title: '标题', dataIndex: 'title' },
    { title: '类型', dataIndex: 'categoryId', render: v => categoryName(v) },
    { title: '状态', dataIndex: 'status', valueEnum: { DRAFT: { text: '草稿' }, PUBLISHED: { text: '已发布' } } },
    { title: '观看', dataIndex: 'viewCount', editable: true },
    { title: '喜欢', dataIndex: 'likeCount', editable: true },
    { title: '排序', dataIndex: 'sortOrder' },
    { title: '更新时间', dataIndex: 'updatedAt', render: v => new Date(v).toLocaleString() },
    // 操作：编辑/发布/下架/删除（Popconfirm）
  ]}
  request={async (params) => { const r = await adminVideoWorkApi.listWorks(params.current, params.pageSize); return { data: r.items, total: r.total, success: true }; }}
/>
```

ModalForm 字段（完整清单，spec §5.6）：
1. **候选视频**（ProFormSelect，request=listCandidates，fieldProps.showSearch + optionRender 缩略图预览；**canvasExists=false 项 disabled + 标注「画布已删除」**；选中后回填 videoKey/videoMediaId/canvasProjectId/durationSec/width/height/coverKey 兜底）
2. 标题（ProFormText，必填 max 200）
3. 简介（ProFormTextArea，max 2000）
4. 作者名（ProFormText，必填 max 64）
5. 类型（ProFormSelect，request=listCategories）
6. 标签（**ProFormSelect mode="tags"**，options=listTags→name，maxCount 10——标签池+自由输入 D7）
7. 封面（Upload，customRequest→uploadCover→写 coverKey；提示"留空使用视频缩略图"）
8. 排序（ProFormDigit）
9. 状态（Radio DRAFT/PUBLISHED）
10. allowViewProcess / allowClone（ProFormSwitch；**无 canvasProjectId（未选候选或候选无画布）时两开关 disabled + tooltip 提示**——保存校验的前端半边）
11. viewCount / likeCount（ProFormDigit，后台可调）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideoWorksPage
git add apps/web/src/pages/admin/ apps/web/src/api/adminApi.ts
git commit -m "feat(video-work): 批次10 admin 作品管理（候选选片/两开关联动/计数可调/封面）"
```

### Task 10.2: 类型/标签管理 + 轮播设置卡片

**Files:**
- Modify: `VideoWorksPage.tsx`（页内 Tabs 第二/三个 tab）

- [ ] **Step 1: 写失败测试**

```tsx
it('类型管理 tab：ProTable 列 name/sortOrder/active + 新增', async () => { /* mock listCategories */ });
it('标签管理 tab：同构', async () => { /* mock listTags */ });
it('轮播设置卡片：开关 + 范围单选，保存调 updateSettings', async () => {
  /* mock getSettings {enabled:true, scope:'all'} → 切换 scope='category' → 保存断言 payload */
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（两个轻量 ProTable + 设置卡片 Form）**

```tsx
<Tabs items={[
  { key: 'works', label: '作品', children: <WorksTable /> },
  { key: 'categories', label: '视频类型', children: <CategoryTable /> },   // ProTable name/sortOrder/active + ModalForm CRUD
  { key: 'tags', label: '标签池', children: <TagTable /> },               // 同构
  { key: 'settings', label: '播放页设置', children: <CarouselSettingsCard /> },
]} />

// CarouselSettingsCard：Form initialValue=getSettings；Switch carouselEnabled + Radio.Group carouselScope(all|category)；保存→updateSettings→message.success
```

- [ ] **Step 4: 跑绿 + web 全量回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
git add apps/web/src/pages/admin/
git commit -m "feat(video-work): 批次10 类型/标签管理 + 轮播设置卡片"
```

---

## 批次 11：端到端验收与部署

### Task 11.1: 全量验证 + 浏览器手工验收清单

- [ ] **Step 1: 全栈测试与构建**

```bash
pnpm --filter @flowweb/api test          # tsc + vitest（api）
pnpm --filter @flowweb/web test          # vitest（web）
pnpm --filter @flowweb/web build         # web 类型检查含在 build（X15：无独立 typecheck 脚本）
```

Expected: 全绿、零 TS 错误。

- [ ] **Step 2: 本地起服务，执行浏览器手工验收清单（逐项打勾）**

| # | 场景 | 预期 |
|---|---|---|
| 1 | 未登录打开 `/` → 打开会员弹窗 | banner 正常显示（批次 0 端到端，非默认渐变） |
| 2 | 未登录打开 `/videos` | 列表渲染：卡片仅封面/时长/标题/标签；类型 tab 切换正常 |
| 3 | 点卡片 → 全屏 Modal | Modal 弹出、URL 变 `/videos/:id`、Esc/返回钮/浏览器返回键均可关闭且回列表 |
| 4 | 直链打开 `/videos/:id` | Modal 自动弹出；关闭后落列表不退出站点 |
| 5 | 播放视频 | 进度条可拖（Range 生效）；暂停/续播正常 |
| 6 | 播放 Modal 内点喜欢（未登录） | **登录框可见可点**（z 层级正确）；Esc 先关登录框不误关播放 Modal |
| 7 | 登录后点赞/取消 | 数字 ±1；刷新后 liked 状态正确 |
| 8 | 「查看制作过程」（开关开） | 快照渲染：节点+连线齐全、组框、缩略图、纯文本（无 HTML 标签） |
| 9 | 创作过程 → 复制项目 | 克隆成功 toast + 打开画布进入新工程；画布无剪辑节点、节点 id 已换 |
| 10 | 轮播（默认设置） | 底部最多 10 条、当前作品不在其中；点击无刷新切换；切换后关闭回列表 |
| 11 | admin 后台 | 选片（缩略图预览/无画布标注）/两开关联动/标签 tags 输入/封面传/计数改/轮播设置生效 |
| 12 | 下架作品 | 列表/详情立即 404 |

- [ ] **Step 3: 记录验收结果（本 plan 勾选框 + PR 描述）→ Commit（若有验收中修复）**

### Task 11.2: 部署清单（上线顺序红线，spec §8）

- [ ] **Step 1: 确认迁移文件就绪**

```bash
ls apps/api/prisma/migrations/ | tail -3   # 含 add_video_work 与 by-key 无关（无 schema 变更）
```

- [ ] **Step 2: 部署顺序执行（deploy.sh api 模式不含 prisma/——schema 与 migrations 必须先到位）**

```bash
# 1) 全量部署（或手动上传 apps/api/prisma/schema.prisma + apps/api/prisma/migrations/ 两者）
# 2) 服务器执行迁移
npx prisma migrate deploy
# 3) 重启 api（新代码 + 新 prisma client 生效——先 generate 再启动，deploy.sh 只跑 generate 不跑 migrate）
```

- [ ] **Step 3: 上线后冒烟：R12 Nginx /flowai Range 透传双验（curl -I -H "Range: bytes=0-1" 视频 URL → 206；DevTools 播放多次 206 无 range 警告）+ 会员 banner + /videos 列表**

---

## Plan 自审记录（writing-plans Self-Review）

1. **Spec 覆盖对照**：批次 0=D17/§4.3 by-key；批次 1=§3 schema/shared；批次 2=§4.3 后台 API 全量；批次 3=§4.2 公开列表/详情/categories；批次 4=§4.5 计数；批次 5=§4.6 快照（白名单/排序/Handle 依赖在 9.1/缩略图/端点）；批次 6=§4.7 克隆；批次 7=§5.1/5.2/5.5/D13/D14；批次 8=§5.4/D5/D15/D18/D11；批次 9=§5.3/D8/D9 前端半边；批次 10=§5.6；批次 11=§8 上线顺序+R12。**发现并补齐**：spec §4.2 未明确"公开读取轮播设置"的端点——Task 8.3 落为 `GET /api/video-works/settings`（非敏感运营开关，公开），实施决定已在文中标注。
2. **占位符扫描**：Task 8.1 的 PlayView/ProcessView/CarouselBar 有"最简占位"阶段（仅外壳联动 data-testid），后续任务替换为真实实现——这是分批 TDD 的灰度策略而非未完成项，替换任务明确（8.2/8.3/9.2）。upload-cover 的 MinIO 写入方法标注"以 grep 实际方法为准"——因 MinioService 方法名未在六轮审核中锁定，实施第一步先探明再落（避免 plan 写死错误 API）。
3. **类型一致性**：shared `VideoWorkDetail/ProcessSnapshotData/CandidateMedia` 在 Task 1.2 定义，Task 3.3/5.2/5.3/7.1/8.2/9.1 引用一致；`buildFilteredSnapshot(raw, opts)` 签名在 5.1 定义、5.3/6.1 复用一致；`toggleLike` 返回 `{liked,likeCount}` 在 4.3/7.1/8.2 一致；Redis key `videoWork:like:{workId}:{userId}` 在 3.3/4.3 同键（§4.2 约束落实）。


