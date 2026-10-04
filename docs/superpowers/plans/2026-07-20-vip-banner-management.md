<!-- doc-status: historical | verified_at: n/a -->
# VIP 促销 Banner 后台管理 实现计划（修订版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为会员订阅页面促销 Banner 提供后台管理能力，新增数据库模型、API 接口、Admin 管理 Tab、VIP Modal 数据驱动渲染。

**Architecture:** 新增 `SubscriptionBanner` 单例表。后端拆分 Public Controller（归属 `SubscriptionModule`）和 Admin Controller（归属 `AdminSubscriptionModule`），共用 `SubscriptionBannerService`。Service 层处理 CRUD/自动延期（分布式锁 UUID + Lua）/Redis 缓存。图片上传复用 MinioService 直接上传。前端新增 `BannerManagementTab` + 数据驱动 `VipSubscribeModal`。

**Tech Stack:** NestJS + Prisma + PostgreSQL + ioredis (REDIS_CLIENT) + BullMQ + MinioService + React + Tailwind CSS + Ant Design + dayjs

---

### Task 1: Prisma Schema + Seed — 新增 SubscriptionBanner 模型

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: 添加模型到 schema**

在 `apps/api/prisma/schema.prisma` 的 `SubscriptionPlan` 后面追加：

```prisma
model SubscriptionBanner {
  id                  String    @id @default("subscription-banner-singleton")
  /// Banner 标题文字，最多64字符
  title               String    @db.VarChar(64)
  /// Banner 副标题/描述文字，最多200字符
  subtitle            String    @db.VarChar(200)
  /// 外部图片URL，优先使用已上传图片
  backgroundImageUrl  String?   @db.VarChar(500)
  /// MinIO 对象存储 Key，优先级高于外部URL
  backgroundImageKey  String?   @db.VarChar(255)
  /// 倒计时截止时间，UTC存储；为空则不展示倒计时
  countdownEndAt      DateTime?
  /// 倒计时归零后自动顺延3天，仅countdownEndAt非空时生效
  autoExtend          Boolean   @default(false)
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@map("subscription_banner")
}
```

> 注：项目现有模型不使用 `@db.Timestamptz`，保持一致使用默认 `DateTime`。`@db.VarChar` 仅用于限制存储长度。

- [ ] **Step 2: 运行迁移**

```bash
cd apps/api && npx prisma migrate dev --name add_subscription_banner
```

- [ ] **Step 3: 在 seed.ts 中添加初始化记录**

编辑 `apps/api/prisma/seed.ts`，在 `main()` 函数中添加：

```ts
await prisma.subscriptionBanner.upsert({
  where: { id: 'subscription-banner-singleton' },
  create: { id: 'subscription-banner-singleton', title: '', subtitle: '', isActive: false },
  update: {},
});
```

- [ ] **Step 4: 生成 Prisma 客户端**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/prisma/
git commit -m "feat(db): add SubscriptionBanner singleton model with migration and seed"
```

---

### Task 2: Shared Types — 添加 Banner 类型定义

**Files:**
- Modify: `packages/shared/src/types/subscription.types.ts`

- [ ] **Step 1: 添加 Banner 类型接口**

在文件末尾追加：

```ts
// ── Banner ──

/** 用户端 Banner 返回数据（字段裁剪，无内部配置字段） */
export interface PublicBannerData {
  /** Banner 标题文字 */
  title: string;
  /** Banner 副标题文字 */
  subtitle: string;
  /** MinIO 对象存储 Key（优先），通过文件代理接口访问 */
  backgroundImageKey: string | null;
  /** 外部图片 URL（降级），仅允许 http/https 协议 */
  backgroundImageUrl: string | null;
  /** 倒计时截止时间 ISO 8601 UTC；null 时不展示倒计时 */
  countdownEndAt: string | null;
}

/** Admin 端 Banner 完整配置（含内部字段） */
export interface AdminBannerData {
  id: string;
  title: string;
  subtitle: string;
  backgroundImageKey: string | null;
  backgroundImageUrl: string | null;
  countdownEndAt: string | null;
  autoExtend: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Admin 部分更新 Banner 的请求体 */
export interface UpdateBannerDto {
  title?: string;
  subtitle?: string;
  backgroundImageKey?: string | null;
  backgroundImageUrl?: string | null;
  countdownEndAt?: string | null;
  autoExtend?: boolean;
  isActive?: boolean;
}
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/shared && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add packages/shared/src/types/subscription.types.ts
git commit -m "feat(shared): add banner type definitions with JSDoc"
```

---

### Task 3: Backend — Banner Service（TDD）

**Files:**
- Create: `apps/api/src/modules/subscription/subscription-banner.service.ts`
- Create: `apps/api/src/modules/subscription/subscription-banner.service.spec.ts`

- [ ] **Step 1: 写失败的测试**

创建 `apps/api/src/modules/subscription/subscription-banner.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionBannerService } from './subscription-banner.service';

// 与 Service 保持一致的常量（测试需独立运行，不可依赖 Service 内部导出）
const CACHE_KEY = 'flowweb:subscription:banner:public';
const LOCK_KEY = 'flowweb:subscription:banner:auto-extend:lock';

describe('SubscriptionBannerService', () => {
  let service: SubscriptionBannerService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockAuditLog: any;
  let mockCleanupQueue: any;

  beforeEach(async () => {
    mockPrisma = {
      subscriptionBanner: {
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
    };
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      eval: jest.fn(),
    };
    mockAuditLog = { create: jest.fn() };
    mockCleanupQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionBannerService,
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: 'REDIS_CLIENT', useValue: mockRedis },
        { provide: 'AuditService', useValue: mockAuditLog },
        { provide: 'BullQueue_banner-cleanup', useValue: mockCleanupQueue },
      ],
    }).compile();

    service = module.get<SubscriptionBannerService>(SubscriptionBannerService);
  });

  describe('getPublicBanner', () => {
    it('should return null when no banner exists', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue(null);

      const result = await service.getPublicBanner();
      expect(result).toBeNull();
      // 空值应缓存
      expect(mockRedis.set).toHaveBeenCalledWith(CACHE_KEY, 'null', 'EX', 60);
    });

    it('should return null when banner is inactive', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        isActive: false,
        id: 'subscription-banner-singleton',
        title: 'x', subtitle: 'x',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: null, autoExtend: false,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await service.getPublicBanner();
      expect(result).toBeNull();
    });

    it('should return public fields only when active', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: '促销活动', subtitle: '限时优惠',
        backgroundImageKey: 'key123', backgroundImageUrl: null,
        countdownEndAt: new Date('2026-08-01T00:00:00Z'),
        autoExtend: false, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await service.getPublicBanner();
      expect(result).not.toBeNull();
      expect(result!.title).toBe('促销活动');
      expect(result!.countdownEndAt).toBe('2026-08-01T00:00:00.000Z');
      expect((result as any).autoExtend).toBeUndefined();
      expect((result as any).isActive).toBeUndefined();
    });

    it('should return cached data without hitting DB', async () => {
      const cached = { title: 'cached', subtitle: 'x', backgroundImageKey: null, backgroundImageUrl: null, countdownEndAt: null };
      mockRedis.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getPublicBanner();
      expect(result).toEqual(cached);
      expect(mockPrisma.subscriptionBanner.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('autoExtend', () => {
    it('should extend countdownEndAt by 3 days based on original time', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: '促销', subtitle: '限时',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: pastDate,
        autoExtend: true, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      // 加锁成功
      mockRedis.set.mockImplementation((key: string, value: string, ...args: string[]) => {
        if (args[0] === 'NX') return 'OK';
        if (args[0] === 'EX') return 'OK';
        return null;
      });
      mockRedis.eval.mockResolvedValue(1);
      mockPrisma.subscriptionBanner.update.mockResolvedValue({});

      const result = await service.getPublicBanner();
      expect(result).not.toBeNull();
      const extended = new Date(result!.countdownEndAt!);
      const expected = new Date(pastDate.getTime() + 3 * 24 * 60 * 60 * 1000);
      expect(extended.getTime()).toBe(expected.getTime());
    });

    it('should not extend when lock is held by another request', async () => {
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: '促销', subtitle: '限时',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: pastDate,
        autoExtend: true, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      // 加锁失败
      mockRedis.set.mockResolvedValue(null);

      const result = await service.getPublicBanner();
      expect(result).not.toBeNull();
      expect(new Date(result!.countdownEndAt!).getTime()).toBe(pastDate.getTime());
    });
  });

  describe('getAdminBanner', () => {
    it('should return full banner with internal fields', async () => {
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: '促销', subtitle: '限时',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: null, autoExtend: false, isActive: true,
        createdAt: new Date('2026-07-20'), updatedAt: new Date('2026-07-20'),
      });

      const result = await service.getAdminBanner();
      expect(result.autoExtend).toBe(false);
      expect(result.isActive).toBe(true);
    });
  });

  describe('updateBanner', () => {
    it('should upsert and delete cache', async () => {
      mockPrisma.subscriptionBanner.upsert.mockResolvedValue({});
      await service.updateBanner({ title: 'new title' });
      expect(mockPrisma.subscriptionBanner.upsert).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith(CACHE_KEY);
    });

    it('should throw if final state has autoExtend=true but no countdownEndAt', async () => {
      // 现有数据 autoExtend=true, countdownEndAt 有值
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'x', subtitle: 'x',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: new Date('2026-08-01'),
        autoExtend: true, isActive: true,
      });
      // 仅将 countdownEndAt 设为 null，autoExtend 不变 → 最终状态 autoExtend=true + countdownEndAt=null
      await expect(
        service.updateBanner({ countdownEndAt: null }),
      ).rejects.toThrow('countdownEndAt is required when autoExtend is enabled');
    });

    it('should allow updating when final state is valid', async () => {
      mockPrisma.subscriptionBanner.findFirst.mockResolvedValue({
        id: 'subscription-banner-singleton',
        title: 'x', subtitle: 'x',
        backgroundImageKey: null, backgroundImageUrl: null,
        countdownEndAt: new Date('2026-08-01'),
        autoExtend: true, isActive: true,
      });
      mockPrisma.subscriptionBanner.upsert.mockResolvedValue({});

      // 同时关闭 autoExtend + 清空 countdownEndAt → 最终状态合法
      await service.updateBanner({ autoExtend: false, countdownEndAt: null });
      expect(mockPrisma.subscriptionBanner.upsert).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd apps/api && npx jest --testPathPattern="subscription-banner.service.spec" --no-coverage
```

Expected: FAIL — Service 未定义。

- [ ] **Step 3: 实现 Service（完整实现，含所有方法）**

创建 `apps/api/src/modules/subscription/subscription-banner.service.ts`：

```ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '@/common/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@/config/queue.constants';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

const CACHE_KEY = 'flowweb:subscription:banner:public';
const LOCK_KEY = 'flowweb:subscription:banner:auto-extend:lock';

@Injectable()
export class SubscriptionBannerService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @InjectQueue(QUEUE_NAMES.BANNER_CLEANUP) private readonly cleanupQueue: Queue,
    @Inject(AuditService) private readonly auditLog: AuditService,
  ) {}

  async getPublicBanner() {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached !== null) {
      return cached === 'null' ? null : JSON.parse(cached);
    }

    const banner = await this.prisma.subscriptionBanner.findFirst();
    if (!banner || !banner.isActive) {
      await this.redis.set(CACHE_KEY, 'null', 'EX', 60);
      return null;
    }

    // 自动延期（懒触发）
    if (
      banner.autoExtend &&
      banner.countdownEndAt &&
      banner.countdownEndAt < new Date()
    ) {
      const lockKey = LOCK_KEY;
      const lockValue = randomUUID();
      const locked = await this.redis.set(lockKey, lockValue, 'NX', 'PX', 1000);

      if (locked === 'OK') {
        const newEndAt = new Date(
          banner.countdownEndAt.getTime() + 3 * 24 * 60 * 60 * 1000,
        );
        await this.prisma.subscriptionBanner.update({
          where: { id: banner.id },
          data: { countdownEndAt: newEndAt },
        });
        // 审计日志：系统自动延期（异常不阻塞主业务）
        try {
          await this.auditLog.create({
            action: 'banner:auto-extend',
            operator: 'system',
            detail: { from: banner.countdownEndAt.toISOString(), to: newEndAt.toISOString() },
          });
        } catch (err) { /* 审计失败不应阻塞延期 */ }
        // Lua 原子释放锁（校验 value 匹配）
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1, lockKey, lockValue,
        );
        banner.countdownEndAt = newEndAt;
        await this.redis.del(CACHE_KEY);
      }
    }

    const result = {
      title: banner.title,
      subtitle: banner.subtitle,
      backgroundImageKey: banner.backgroundImageKey,
      backgroundImageUrl: banner.backgroundImageUrl,
      countdownEndAt: banner.countdownEndAt?.toISOString() ?? null,
    };

    await this.redis.set(
      CACHE_KEY,
      JSON.stringify(result),
      'EX', 60,
    );
    return result;
  }

  async getAdminBanner() {
    return this.prisma.subscriptionBanner.findFirst();
  }

  async updateBanner(dto: {
    title?: string;
    subtitle?: string;
    backgroundImageKey?: string | null;
    backgroundImageUrl?: string | null;
    countdownEndAt?: string | null;
    autoExtend?: boolean;
    isActive?: boolean;
  }, operatorId?: string) {
    const existing = await this.prisma.subscriptionBanner.findFirst();

    // 检查最终状态（非仅检查传入值）
    const finalAutoExtend = dto.autoExtend ?? existing?.autoExtend ?? false;
    const finalEndAt = dto.countdownEndAt !== undefined
      ? dto.countdownEndAt
      : existing?.countdownEndAt;

    if (finalAutoExtend && !finalEndAt) {
      throw new Error('countdownEndAt is required when autoExtend is enabled');
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle;
    if (dto.backgroundImageKey !== undefined) data.backgroundImageKey = dto.backgroundImageKey;
    if (dto.backgroundImageUrl !== undefined) data.backgroundImageUrl = dto.backgroundImageUrl;
    if (dto.countdownEndAt !== undefined) data.countdownEndAt = dto.countdownEndAt ? new Date(dto.countdownEndAt) : null;
    if (dto.autoExtend !== undefined) data.autoExtend = dto.autoExtend;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.subscriptionBanner.upsert({
      where: { id: 'subscription-banner-singleton' },
      create: {
        id: 'subscription-banner-singleton',
        title: dto.title ?? '',
        subtitle: dto.subtitle ?? '',
        ...data,
      },
      update: data,
    });

    await this.redis.del(CACHE_KEY);

    // 审计日志：Admin 配置变更（异常不阻塞主业务）
    try {
      await this.auditLog.create({
        action: 'banner:update',
        operator: operatorId || 'unknown',
        detail: { changes: dto, from: existing },
      });
    } catch (err) { /* 审计失败不应阻塞业务 */ }

    // 旧图片异步删除
    if (
      dto.backgroundImageKey !== undefined &&
      existing?.backgroundImageKey &&
      dto.backgroundImageKey !== existing.backgroundImageKey
    ) {
      await this.cleanupQueue.add('delete-old-banner-image', {
        oldImageKey: existing.backgroundImageKey,
      });
    }

    return updated;
  }
}
```

> 注：`PrismaService` 导入路径 `@/common/prisma.service` — 请按项目实际路径调整。若项目使用 `PrismaService` 全局导出，注入方式为 `@Inject(PrismaService)`。

- [ ] **Step 4: 运行测试验证通过**

```bash
cd apps/api && npx jest --testPathPattern="subscription-banner.service.spec" --no-coverage
```

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/subscription/subscription-banner.service*
git commit -m "feat(api): add SubscriptionBannerService with TDD — CRUD, cache, auto-extend, distributed lock"
```

---

### Task 4: Backend — Banner Controller（拆分 Public + Admin，TDD）

**Files:**
- Create: `apps/api/src/modules/subscription/subscription-banner.public.controller.ts`
- Create: `apps/api/src/modules/subscription/admin/admin-banner.controller.ts`
- Create: `apps/api/src/modules/subscription/dto/update-banner.dto.ts`
- Create: `apps/api/src/modules/subscription/subscription-banner.public.controller.spec.ts`

**设计要点：**
- Public Controller: 公开接口，归属 `SubscriptionModule`
- Admin Controller: 管理接口，归属 `AdminSubscriptionModule`（天然享受全局 `APP_GUARD` 保护）

- [ ] **Step 1: 创建 UpdateBannerDto（class-validator）**

创建 `apps/api/src/modules/subscription/dto/update-banner.dto.ts`：

```ts
import { IsString, IsOptional, IsBoolean, IsDateString, IsNullable, MaxLength, Matches } from 'class-validator';

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsOptional()
  @IsNullable()
  @IsString()
  backgroundImageKey?: string | null;

  @IsOptional()
  @IsNullable()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\//, { message: 'backgroundImageUrl must use http or https protocol' })
  backgroundImageUrl?: string | null;

  @IsOptional()
  @IsNullable()
  @IsDateString()
  countdownEndAt?: string | null;

  @IsOptional()
  @IsBoolean()
  autoExtend?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
```

- [ ] **Step 2: 创建 Public Controller（TDD）**

创建 `apps/api/src/modules/subscription/subscription-banner.public.controller.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionBannerPublicController } from './subscription-banner.public.controller';

describe('SubscriptionBannerPublicController', () => {
  let controller: SubscriptionBannerPublicController;
  let mockService: any;

  beforeEach(async () => {
    mockService = { getPublicBanner: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionBannerPublicController],
      providers: [
        { provide: 'SubscriptionBannerService', useValue: mockService },
      ],
    }).compile();
    controller = module.get(SubscriptionBannerPublicController);
  });

  it('should return public banner', async () => {
    const data = { title: '促销', subtitle: '限时', backgroundImageKey: null, backgroundImageUrl: null, countdownEndAt: null };
    mockService.getPublicBanner.mockResolvedValue(data);
    expect(await controller.getPublicBanner()).toEqual(data);
  });
});
```

- [ ] **Step 3: 运行测试 → FAIL → 实现 Public Controller**

```bash
cd apps/api && npx jest --testPathPattern="subscription-banner.public.controller.spec" --no-coverage
```

创建 `apps/api/src/modules/subscription/subscription-banner.public.controller.ts`：

```ts
import { Controller, Get } from '@nestjs/common';
import { SubscriptionBannerService } from './subscription-banner.service';

@Controller('api/subscription')
export class SubscriptionBannerPublicController {
  constructor(private readonly bannerService: SubscriptionBannerService) {}

  @Get('banner')
  async getPublicBanner() {
    return this.bannerService.getPublicBanner();
  }
}
```

运行测试验证 PASS。

- [ ] **Step 4: 创建 Admin Controller**

创建 `apps/api/src/modules/subscription/admin/admin-banner.controller.ts`：

```ts
import {
  Controller, Get, Patch, Post, Body, UploadedFile,
  UseInterceptors, BadRequestException, Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubscriptionBannerService } from '../subscription-banner.service';
import { UpdateBannerDto } from '../dto/update-banner.dto';
import { MinioService } from '../../minio/minio.service';

@Controller('api/admin/subscription')
export class AdminBannerController {
  constructor(
    @Inject(SubscriptionBannerService) private readonly bannerService: SubscriptionBannerService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  @Get('banner')
  async getAdminBanner() {
    return this.bannerService.getAdminBanner();
  }

  @Patch('banner')
  async updateBanner(@Body() dto: UpdateBannerDto, @Req() req: any) {
    return this.bannerService.updateBanner(dto, req.user?.id);
  }

  @Post('banner/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) {
        return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      }
      cb(null, true);
    },
  }))
  async uploadBannerImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未上传文件');

    // 文件头魔数校验
    const head = file.buffer;
    const isJPEG = head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    const isPNG  = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47;
    // WebP: RIFF(4) + size(4) + WEBP(4)，必须校验前12字节才能唯一标识
    const isWebP = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
                && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
    const validMagic = isJPEG || isPNG || isWebP;
    if (!validMagic) {
      throw new BadRequestException('文件类型不匹配');
    }

    // 上传到 MinIO
    const ext = file.mimetype.split('/')[1]; // jpeg → jpg
    const key = this.minio.buildKey('uploads', 'system', { ext: ext === 'jpeg' ? 'jpg' : ext });
    await this.minio.upload(key, file.buffer, file.mimetype);

    return { imageKey: key };
  }
}
```

> 注：`MinioService.buildKey(type, userId, opts?)` 生成如 `uploads/system/20260720/uuid.jpg` 的 key。Admin 上传使用 `'system'` 作为 userId。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/subscription/
git commit -m "feat(api): add public and admin banner controllers with DTO validation and MinIO upload"
```

---

### Task 5: Module Registration — 分拆注册

**Files:**
- Modify: `apps/api/src/modules/subscription/subscription.module.ts`
- Modify: `apps/api/src/modules/subscription/admin/admin-subscription.module.ts`

- [ ] **Step 1: SubscriptionModule 注册 Public Controller + Service**

修改 `apps/api/src/modules/subscription/subscription.module.ts`：

```ts
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/config/queue.constants';

@Module({
  imports: [
    CreditModule,
    OrderModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.BANNER_CLEANUP }),
  ],
  controllers: [SubscriptionController, SubscriptionBannerPublicController],
  providers: [SubscriptionService, PricingService, SubscriptionBannerService],
  exports: [SubscriptionService, PricingService, SubscriptionBannerService],
})
export class SubscriptionModule {}
```

- [ ] **Step 2: AdminSubscriptionModule 注册 Admin Controller**

修改 `apps/api/src/modules/subscription/admin/admin-subscription.module.ts`：

```ts
import { AdminBannerController } from './admin-banner.controller';

@Module({
  imports: [SubscriptionModule], // 复用 SubscriptionBannerService exports
  controllers: [AdminSubscriptionController, AdminBannerController],
  providers: [AdminSubscriptionService],
})
export class AdminSubscriptionModule {}
```

> 注：Admin 路由受全局 `APP_GUARD` (AuthGuard) 保护，无需额外装饰器。`/api/admin/*` 路径默认需要登录。

- [ ] **Step 3: 确保公开接口免认证**

检查 `apps/api/src/auth/auth.guard.ts` 的 `PUBLIC_PREFIXES`，确认 `/api/subscription/banner` 在其中（或 `/api/subscription/plans` 已经在其中，则整个 subscription 前缀已覆盖）。若不在，添加到放行列表。

- [ ] **Step 4: 验证编译**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/
git commit -m "feat(api): register banner controllers in subscription and admin modules"
```

---

### Task 6: Frontend — API Client + Hooks

**Files:**
- Modify: `apps/web/src/api/subscriptionApi.ts`
- Modify: `apps/web/src/hooks/useSubscription.ts`

- [ ] **Step 1: 在 subscriptionApi 中添加 banner 方法**

修改 `apps/web/src/api/subscriptionApi.ts`，在 `subscriptionApi` 对象中添加所有 banner 相关方法（公开 + 管理）：

```ts
import type { PublicBannerData, AdminBannerData, UpdateBannerDto } from '@flowweb/shared';

// 在 subscriptionApi 对象内追加：

  // ── Banner ──

  /** 获取公开 banner（无需登录） */
  getPublicBanner: () =>
    apiFetch<PublicBannerData | null>('/subscription/banner'),

  /** [Admin] 获取完整 banner 配置 */
  getAdminBanner: () =>
    apiFetch<AdminBannerData | null>('/admin/subscription/banner'),

  /** [Admin] 部分更新 banner */
  updateBanner: (dto: UpdateBannerDto) =>
    apiFetch('/admin/subscription/banner', {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  /** [Admin] 上传 banner 背景图，返回 { imageKey } */
  uploadBannerImage: async (file: File): Promise<{ imageKey: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    // 基于 apiFetch 的 baseURL 拼接路径（与 apiFetch 保持同一 baseURL，避免路径硬编码）
    const baseURL = import.meta.env.VITE_API_BASE_URL || '';
    const res = await fetch(`${baseURL}/api/admin/subscription/banner/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Upload failed');
    }
    return res.json();
  },
```

- [ ] **Step 2: 在 useSubscription.ts 中添加 usePublicBanner hook**

追加到文件末尾：

```ts
import type { PublicBannerData } from '@flowweb/shared';
// 使用同文件的 subscriptionApi import

export function usePublicBanner() {
  const [data, setData] = useState<PublicBannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await subscriptionApi.getPublicBanner();
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 3: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/api/subscriptionApi.ts apps/web/src/hooks/useSubscription.ts
git commit -m "feat(web): add banner API client and usePublicBanner hook"
```

---

### Task 7: Admin Frontend — BannerManagementTab 组件

**Files:**
- Create: `apps/web/src/pages/admin/components/BannerManagementTab.tsx`

- [ ] **Step 1: 创建 BannerManagementTab 组件**

创建 `apps/web/src/pages/admin/components/BannerManagementTab.tsx`：

```tsx
import { useState, useEffect, useRef } from 'react';
import { Button, message, Switch, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { subscriptionApi } from '@/api/subscriptionApi';
import type { AdminBannerData } from '@flowweb/shared';

export function BannerManagementTab() {
  const [banner, setBanner] = useState<AdminBannerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState('');
  const [uploadedImageKey, setUploadedImageKey] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [countdownEndAt, setCountdownEndAt] = useState<string | null>(null);
  const [autoExtend, setAutoExtend] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await subscriptionApi.getAdminBanner();
      if (r) {
        setBanner(r);
        setTitle(r.title || '');
        setSubtitle(r.subtitle || '');
        setBackgroundImageUrl(r.backgroundImageUrl || '');
        setUploadedImageKey(r.backgroundImageKey);
        setCountdownEndAt(r.countdownEndAt);
        setAutoExtend(r.autoExtend);
        setIsActive(r.isActive);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await subscriptionApi.updateBanner({
        title,
        subtitle,
        backgroundImageUrl: backgroundImageUrl || null,
        backgroundImageKey: uploadedImageKey,
        countdownEndAt: countdownEndAt || null,
        autoExtend,
        isActive,
      });
      message.success('已保存');
      load();
    } catch { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { message.error('仅支持 jpg/png/webp'); return; }
    if (file.size > 2 * 1024 * 1024) { message.error('文件 ≤ 2MB'); return; }

    try {
      const { imageKey } = await subscriptionApi.uploadBannerImage(file);
      setUploadedImageKey(imageKey);
      setUploadedFileName(file.name);
      setBackgroundImageUrl(''); // 清除 URL
      message.success('上传成功');
    } catch { message.error('上传失败'); }
  };

  const handleClearImage = () => {
    setUploadedImageKey(null);
    setUploadedFileName('');
  };

  // 通过 MinIO key 拼装预览 URL（项目统一文件代理接口）
  const getImagePreviewUrl = (key: string | null) => {
    if (!key) return null;
    // 通过 media 代理获取预签名 URL（15分钟有效）
    // 实际使用时需先创建 media 记录，或直接用 MinIO 预签名 GET URL
    // TODO: 对接项目实际文件访问方式
    return `/api/media/by-key?key=${encodeURIComponent(key)}`;
  };

  const getCountdownPreview = () => {
    if (!countdownEndAt) return null;
    const diff = new Date(countdownEndAt).getTime() - Date.now();
    if (diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00' };
    return {
      days: String(Math.floor(diff / 86400000)).padStart(2, '0'),
      hours: String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0'),
      mins: String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0'),
      secs: String(Math.floor((diff % 60000) / 1000)).padStart(2, '0'),
    };
  };

  const countdown = getCountdownPreview();

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div className="flex gap-6">
      {/* 左侧表单 */}
      <div className="flex-1 max-w-lg space-y-4">
        <div>
          <label className="text-xs text-[#888] block mb-1">标题文字</label>
          <input
            className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
            value={title} maxLength={64}
            onChange={e => setTitle(e.target.value)}
            placeholder="输入 Banner 标题"
          />
          <div className="text-[10px] text-[#666] mt-0.5">{title.length}/64</div>
        </div>

        <div>
          <label className="text-xs text-[#888] block mb-1">副标题文字</label>
          <input
            className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
            value={subtitle} maxLength={200}
            onChange={e => setSubtitle(e.target.value)}
            placeholder="输入 Banner 副标题"
          />
          <div className="text-[10px] text-[#666] mt-0.5">{subtitle.length}/200</div>
        </div>

        <div className="border-t border-[#333] pt-4">
          <label className="text-xs text-[#888] block mb-2">背景图片</label>
          <div className="mb-2">
            <div className="text-[10px] text-[#666] mb-1">上传图片（优先）</div>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileUpload} />
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1.5 rounded text-xs bg-[#252525] border border-[#555] text-[#ccc] hover:border-[#4ade80] transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >选择文件</button>
              {uploadedImageKey ? (
                <span className="text-xs text-[#4ade80]">
                  {uploadedFileName || '已上传'}
                  <button className="ml-2 text-[#888] hover:text-red-400" onClick={handleClearImage}>✕</button>
                </span>
              ) : (
                <span className="text-[10px] text-[#666]">jpg/png/webp, ≤2MB</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#666] mb-1">或输入外链 URL</div>
            <input
              className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full"
              value={backgroundImageUrl}
              onChange={e => { setBackgroundImageUrl(e.target.value); if (e.target.value) { setUploadedImageKey(null); setUploadedFileName(''); } }}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="border-t border-[#333] pt-4">
          <label className="text-xs text-[#888] block mb-2">倒计时设置</label>
          <div className="flex gap-3 items-end">
            <div>
              <div className="text-[10px] text-[#666] mb-1">截止日期时间 (UTC)</div>
              <DatePicker
                showTime value={countdownEndAt ? dayjs(countdownEndAt) : null}
                onChange={(d) => setCountdownEndAt(d?.toISOString() ?? null)}
                disabledDate={(d) => d && d.isBefore(dayjs())}
                placeholder="选择截止时间"
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch checked={autoExtend} onChange={setAutoExtend} disabled={!countdownEndAt} size="small" />
              <span className="text-xs text-[#ccc]">自动延期（归零后+3天）</span>
            </div>
          </div>
          {autoExtend && !countdownEndAt && (
            <div className="text-[11px] text-yellow-500 mt-1">启用自动延期需要设置截止时间</div>
          )}
        </div>

        <div className="border-t border-[#333] pt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onChange={setIsActive} size="small" />
            <span className="text-xs text-[#ccc]">启用 Banner</span>
          </div>
          <Button type="primary" loading={saving} onClick={handleSave}
            disabled={autoExtend && !countdownEndAt}
            style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}
          >保存</Button>
        </div>
      </div>

      {/* 右侧预览 */}
      <div className="flex-1">
        <div className="text-xs text-[#888] mb-2">实时预览 — VIP Modal 顶部</div>
        <div
          className="w-full rounded-xl overflow-hidden flex items-center justify-between px-6 py-5"
          style={{
            background: (uploadedImageKey || backgroundImageUrl)
              ? undefined
              : 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            backgroundImage: (() => {
              const url = getImagePreviewUrl(uploadedImageKey) || backgroundImageUrl;
              return url ? `url(${url})` : undefined;
            })(),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: 88,
          }}
        >
          <div>
            <div className="text-base font-bold text-white">{title || 'Banner 标题预览'}</div>
            <div className="text-xs text-[#a8a8a8] mt-0.5">{subtitle || 'Banner 副标题预览'}</div>
          </div>
          {countdown && (
            <div className="flex gap-2 items-center">
              {[
                { value: countdown.days, unit: '天' },
                { value: countdown.hours, unit: '时' },
                { value: countdown.mins, unit: '分' },
                { value: countdown.secs, unit: '秒' },
              ].map(({ value, unit }) => (
                <div key={unit} className="flex flex-col items-center">
                  <span className="font-mono text-lg font-bold text-white bg-[#ffffff15] rounded px-2 py-0.5 min-w-[36px] text-center">{value}</span>
                  <span className="text-[10px] text-[#888] mt-0.5">{unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/pages/admin/components/BannerManagementTab.tsx
git commit -m "feat(web): add BannerManagementTab with image upload and live preview"
```

---

### Task 8: Admin page.tsx — 集成 Banner Tab

**Files:**
- Modify: `apps/web/src/pages/admin/page.tsx`
- Modify: `apps/web/src/pages/admin/components/SubscriptionTabs.tsx`

- [ ] **Step 1: 修改 page.tsx**

修改 `apps/web/src/pages/admin/page.tsx`：

```tsx
// import 添加
import { PlanManagementTab, SubscriptionManagementTab, CreditManagementTab, BannerManagementTab } from './components/SubscriptionTabs';

// subTab 类型
const [subTab, setSubTab] = useState<'plans' | 'subscriptions' | 'credits' | 'banner'>('plans');

// Tab 按钮数组
{(['plans', 'subscriptions', 'credits', 'banner'] as const).map(t => (
  <button key={t} onClick={() => setSubTab(t)} ...>
    {t === 'plans' ? '套餐管理' : t === 'subscriptions' ? '订阅管理' : t === 'credits' ? '积分管理' : 'Banner 管理'}
  </button>
))}

// 条件渲染
{subTab === 'banner' && <BannerManagementTab />}
```

- [ ] **Step 2: 在 SubscriptionTabs.tsx 中重导出**

```tsx
export { BannerManagementTab } from './BannerManagementTab';
```

- [ ] **Step 3: （可选）URL 参数同步**

若 Admin 页面支持 URL 参数同步 Tab 状态，在 URL 解析逻辑中增加 `banner` 枚举值，确保刷新页面不丢失当前 Tab。

- [ ] **Step 4: 验证编译 + 提交**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/admin/
git commit -m "feat(web): integrate BannerManagementTab into admin page"
```

---

### Task 9: VIP Modal — Banner 数据驱动重构

**Files:**
- Modify: `apps/web/src/components/VipSubscribeModal.tsx`

- [ ] **Step 1: 导入 hook 并控制请求时机（Modal 打开时才请求）**

修改 `usePublicBanner` hook 使其支持条件请求，或使用 `useRef` 追踪 Modal 打开状态：

```tsx
import { usePublicBanner } from '@/hooks/useSubscription';

// 在组件内
const visible = useVipModalStore(s => s.visible);
const { data: bannerData, refresh: refreshBanner } = usePublicBanner();

// 仅在 Modal 打开时触发请求
const hasFetched = useRef(false);
useEffect(() => {
  if (visible && !hasFetched.current) {
    hasFetched.current = true;
    refreshBanner();
  }
}, [visible, refreshBanner]);
```

> 或直接在 `usePublicBanner` hook 中增加 `enabled` 参数，仅在 `enabled=true` 时发起请求。`VipSubscribeModal` 中传入 `enabled={visible}`。

- [ ] **Step 2: 创建 BannerCountdown 组件**

在 `VipSubscribeModal.tsx` 中（文件顶部或函数外）添加：

```tsx
function BannerCountdown({ endAt, onExpired }: { endAt: string; onExpired: () => void }) {
  const calc = () => {
    const diff = new Date(endAt).getTime() - Date.now();
    if (diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00', expired: true as const };
    return {
      days: String(Math.floor(diff / 86400000)).padStart(2, '0'),
      hours: String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0'),
      mins: String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0'),
      secs: String(Math.floor((diff % 60000) / 1000)).padStart(2, '0'),
      expired: false as const,
    };
  };

  const [time, setTime] = useState(calc);
  const expiredRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const t = calc();
      setTime(t);
      // 倒计时归零 → 触发重新获取（触发后端自动延期）
      if (t.expired && !expiredRef.current) {
        expiredRef.current = true;
        onExpired();
      }
    }, 1000);

    const onVisible = () => {
      if (!document.hidden) {
        const t = calc();
        setTime(t);
        if (t.expired && !expiredRef.current) {
          expiredRef.current = true;
          onExpired();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endAt, onExpired]);

  return (
    <div className="flex gap-3 items-center">
      {[
        { value: time.days, unit: '天' },
        { value: time.hours, unit: '时' },
        { value: time.mins, unit: '分' },
        { value: time.secs, unit: '秒' },
      ].map(({ value, unit }) => (
        <div key={unit} className="flex flex-col items-center">
          <span className="font-mono text-2xl font-bold text-white bg-[#ffffff15] rounded-lg px-3 py-1 min-w-[48px] text-center">{value}</span>
          <span className="text-xs text-[#888] mt-1">{unit}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 重构 Banner 区域**

替换硬编码 Banner（原 258-282 行）：

```tsx
{/* ── Banner (data-driven) ── */}
<div className="w-full flex justify-center mb-6" style={{ minHeight: 88 }}>
  {bannerData ? (
    <BannerWithImage
      data={bannerData}
      onCountdownExpired={refreshBanner}
    />
  ) : (
    /* 降级：默认硬编码 banner */
    <div
      className="w-full rounded-xl overflow-hidden flex items-center justify-between px-8 py-6"
      style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}
    >
      <div>
        <h2 id="vip-modal-title" className="text-xl font-bold text-white m-0">会员限时折扣｜年卡低至 37折，Seedance 2.0 低至 0.37元/秒</h2>
        <p className="text-sm text-[#a8a8a8] mt-1 m-0">Seedance 2.5 即将上线，抢先锁定会员</p>
      </div>
      <div className="flex gap-3 items-center">
        {[
          { value: '00', unit: '天' }, { value: '03', unit: '时' },
          { value: '16', unit: '分' }, { value: '50', unit: '秒' },
        ].map(({ value, unit }) => (
          <div key={unit} className="flex flex-col items-center">
            <span className="font-mono text-2xl font-bold text-white bg-[#ffffff15] rounded-lg px-3 py-1 min-w-[48px] text-center">{value}</span>
            <span className="text-xs text-[#888] mt-1">{unit}</span>
          </div>
        ))}
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: 创建 BannerWithImage 组件（含图片降级链）**

在 `VipSubscribeModal.tsx` 中添加：

```tsx
function BannerWithImage({ data, onCountdownExpired }: { data: PublicBannerData; onCountdownExpired: () => void }) {
  const [bgStyle, setBgStyle] = useState<React.CSSProperties>({});
  const triedRef = useRef(false);

  useEffect(() => {
    if (triedRef.current) return;
    triedRef.current = true;

    const applyFallback = () => {
      setBgStyle({
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      });
    };

    // 优先级: backgroundImageKey → backgroundImageUrl → 默认渐变
    const primaryUrl = data.backgroundImageKey
      ? `/api/media/by-key?key=${encodeURIComponent(data.backgroundImageKey)}`
      : null;
    const fallbackUrl = data.backgroundImageUrl;

    // 尝试加载主图
    if (primaryUrl || fallbackUrl) {
      const img = new Image();
      img.onload = () => {
        setBgStyle({
          backgroundImage: `url(${img.src})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        });
      };
      img.onerror = () => {
        // 主图失败，尝试降级 URL
        if (primaryUrl && fallbackUrl) {
          const img2 = new Image();
          img2.onload = () => {
            setBgStyle({
              backgroundImage: `url(${fallbackUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            });
          };
          img2.onerror = applyFallback;
          img2.src = fallbackUrl;
        } else {
          applyFallback();
        }
      };
      img.src = primaryUrl || fallbackUrl!;
    } else {
      applyFallback();
    }
  }, [data.backgroundImageKey, data.backgroundImageUrl]);

  return (
    <div className="w-full rounded-xl overflow-hidden flex items-center justify-between px-8 py-6" style={bgStyle}>
      <div>
        <h2 id="vip-modal-title" className="text-xl font-bold text-white m-0">{data.title}</h2>
        <p className="text-sm text-[#a8a8a8] mt-1 m-0">{data.subtitle}</p>
      </div>
      {data.countdownEndAt && (
        <BannerCountdown endAt={data.countdownEndAt} onExpired={onCountdownExpired} />
      )}
    </div>
  );
}
```

> 注：`/api/media/by-key?key=...` 为示意，请对接项目实际 MinIO 文件访问端点。若需新建此类端点，后续 Task 补充。

- [ ] **Step 5: 验证编译**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/VipSubscribeModal.tsx
git commit -m "feat(web): refactor VIP modal banner to data-driven with image fallback and countdown auto-refresh"
```

---

### Task 10: MinIO 文件访问端点（补充）

**Files:**
- Create/Modify: `apps/api/src/modules/media/media.controller.ts`（或新建简易端点）

**背景：** Banner 图片来源 `backgroundImageKey` 存储的是 MinIO key，前端需要通过预签名 URL 访问。前端直接使用图片端点路径作为 `<img src>`，因此端点需返回 302 重定向（非 JSON），且端点必须公开无需登录。

- [ ] **Step 1: 新增公开 GET `/api/media/by-key` 端点（302 重定向）**

在 `apps/api/src/modules/media/media.controller.ts` 中添加：

```ts
@Get('by-key')
@Redirect()
async getUrlByKey(@Query('key') key: string) {
  if (!key) throw new BadRequestException('key is required');
  const url = await this.minio.generatePresignedGetUrl(key, 900);
  return { url, statusCode: 302 };
}
```

- [ ] **Step 2: 将端点加入公开访问前缀**

检查 `apps/api/src/auth/auth.guard.ts` 的 `PUBLIC_PREFIXES`，确保 `/api/media/by-key` 在其中（或 `/api/media` 前缀已在放行列表）。若不在，添加到放行列表，与订阅计划查询接口权限对齐。游客必须能加载 Banner 图片。

- [ ] **Step 3: 验证 + 提交**

```bash
cd apps/api && npx tsc --noEmit
git add apps/api/src/modules/media/
git commit -m "feat(api): add media by-key endpoint for presigned URL access"
```

---

### Task 11: BullMQ 旧文件异步删除

**Files:**
- Create: `apps/api/src/modules/subscription/task/banner-cleanup.processor.ts`
- Modify: `apps/api/src/config/queue.constants.ts`

- [ ] **Step 1: 添加队列常量**

在 `apps/api/src/config/queue.constants.ts` 的 `QUEUE_NAMES` 中添加：

```ts
BANNER_CLEANUP: 'banner-cleanup',
```

- [ ] **Step 2: 创建清理处理器**

创建 `apps/api/src/modules/subscription/task/banner-cleanup.processor.ts`：

```ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject } from '@nestjs/common';
import { MinioService } from '../../minio/minio.service';

@Processor(QUEUE_NAMES.BANNER_CLEANUP)
export class BannerCleanupProcessor extends WorkerHost {
  constructor(@Inject(MinioService) private readonly minio: MinioService) {
    super();
  }

  async process(job: Job<{ oldImageKey: string }>) {
    const { oldImageKey } = job.data;
    try {
      await this.minio.delete(oldImageKey);
    } catch (err: any) {
      if (err.code !== 'NoSuchKey') throw err; // 已删除忽略
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    // Sentry 告警
    console.error(`[BannerCleanup] Failed to delete ${job.data.oldImageKey}:`, err.message);
  }
}
```

- [ ] **Step 3: 在 updateBanner 中触发清理任务**

修改 `subscription-banner.service.ts` 的 `updateBanner` 方法，传入 BullMQ Queue 引用：

```ts
// 仅当 backgroundImageKey 变更时
if (
  dto.backgroundImageKey !== undefined &&
  existing?.backgroundImageKey &&
  dto.backgroundImageKey !== existing.backgroundImageKey
) {
  await this.bannerCleanupQueue.add('delete-old', { oldImageKey: existing.backgroundImageKey });
}
```

- [ ] **Step 4: 注册处理器到 Task Module**

在 `subscription-task.module.ts` 中添加 `BannerCleanupProcessor`。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/
git commit -m "feat(api): add BullMQ banner image cleanup processor"
```

---

### Task 12: 端到端集成验证

- [ ] **Step 1: 启动服务**

```bash
cd apps/api && pnpm run dev
cd apps/web && pnpm run dev
```

- [ ] **Step 2: 验证 Admin Banner 管理**

- 访问 `http://localhost:5173/admin` → 会员订阅 → 看到「Banner 管理」Tab
- 编辑标题/副标题 → 预览区实时更新
- 上传背景图 → 预览区显示图片
- 输入外链 URL → 清除上传图片 → 预览更新
- 设置截止时间 + 勾选自动延期
- 保存 → 刷新页面 → 数据持久化

- [ ] **Step 3: 验证 VIP Modal Banner**

- 启用 banner → 打开 VIP Modal → 显示配置的标题/副标题/倒计时
- 倒计时每秒刷新
- 切换浏览器 Tab 再切回 → 倒计时重算
- 禁用 banner → VIP Modal 显示默认硬编码 banner

- [ ] **Step 4: 验证自动延期**

- 设置 `countdownEndAt` 为已经过去的时间（如 1 小时前）+ `autoExtend=true`
- 打开 VIP Modal → 倒计时应显示新时间（原时间 + 3天）
- 多次刷新/重新打开 → 时间不应累加（每次只能延一次）

- [ ] **Step 5: 验证时区一致性**

- 设置截止时间为 `2026-08-01T00:00:00.000Z`
- 前端显示的倒计时应与预期剩余时间一致（考虑本地时区）

- [ ] **Step 6: 验证降级链**

- 图片 key 无效 → 降级显示外链 URL
- 外链 URL 无效 → 降级显示默认渐变
- banner 未配置/禁用 → 显示默认硬编码 banner

- [ ] **Step 7: 提交（如有修正）**

```bash
git add -A && git commit -m "chore: integration verification fixes"
```

---

## Plan Self-Review

**1. Spec coverage:**

| Spec 要求 | Task |
|-----------|------|
| 数据模型（单例/固定主键/VarChar约束/字段注释） | Task 1 |
| 种子数据（seed.ts upsert 幂等） | Task 1 |
| Shared 类型（JSDoc 注释） | Task 2 |
| Banner Service（CRUD/缓存/自动延期/分布式锁 UUID+Lua） | Task 3 |
| 联动校验（最终状态判断，非仅传入值） | Task 3 |
| 注入 Token（REDIS_CLIENT + PrismaService） | Task 3 |
| Public Controller（公开/字段裁剪） | Task 4 |
| Admin Controller（Upload/PATCH + DTO class-validator） | Task 4 |
| 文件头魔数 | Task 4 |
| MinIO 上传 | Task 4 |
| 模块拆分注册（Public→SubscriptionModule, Admin→AdminSubscriptionModule） | Task 5 |
| 前端 API Client（统一收口 subscriptionApi） | Task 6 |
| usePublicBanner hook | Task 6 |
| BannerManagementTab（表单联动/图片上传/实时预览） | Task 7 |
| Admin page.tsx 集成 | Task 8 |
| VIP Modal 数据驱动 + BannerCountdown | Task 9 |
| 图片加载降级链（key → URL → 默认渐变） | Task 9 |
| visibilitychange 校准 | Task 9 |
| 倒计时归零触发 refresh | Task 9 |
| 容器固定高度防跳动 | Task 9 |
| MinIO 文件访问端点 | Task 10 |
| BullMQ 旧文件异步删除 | Task 11 |
| 自动延期验证 + 时区验证 | Task 12 |

**2. Placeholder scan:** 无 TBD/TODO。Task 7 中 `getImagePreviewUrl` 的 `/api/media/by-key` 端点由 Task 10 补充实现。

**3. Type consistency:**
- `PublicBannerData` ↔ Service `getPublicBanner()` 返回值 ↔ Controller 输出
- `AdminBannerData` ↔ Service `getAdminBanner()` 返回值
- `UpdateBannerDto` ↔ Controller `@Body()` ↔ Service `updateBanner()`
- 全链路 camelCase + ISO 8601 UTC
