// 空壳，构造签名一次到位——后续任务只加方法、不动构造/providers，spec 文件从创建起就 provide 全部依赖、永不需要二次编辑
import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import type { CandidateMedia } from '@flowweb/shared'; // 裸包名——shared 无 exports map（package.json 只有 main/types→src/index.ts），子路径 '@flowweb/shared/types/video-work' 不可解析，api 侧 tsc 直接 TS2307（先例 content.service.ts:3）
import { CreateVideoWorkDto } from './dto/create-video-work.dto';
import { UpdateVideoWorkDto } from './dto/update-video-work.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import Redis from 'ioredis';

@Injectable()
export class VideoWorkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,             // @Global
    @Inject(MinioService) private readonly minio: MinioService,                 // @Global（presign，无删除能力——删除红线）
    @Inject('REDIS_CLIENT') private readonly redis: Redis,                      // Task 2.1 缓存/3.3 liked/4.x 计数
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService, // Task 4.2 view 限流
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService, // Task 5.3 快照 readCanvas（详情端点禁用）
  ) {}

  // —— 类型（改类型/标签后删缓存，spec §4.2 categories 缓存失效） ——
  private static readonly CATEGORY_CACHE_KEY = 'videoWork:categories';

  //（第十一轮：删孤儿 listCategories()——公开端走 listCategoriesPublic（Task 3.2）、admin 端走 listAllCategories，全 plan 无第三调用者）
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
      previewUrl: await this.presignWork(r.key).catch(() => null), // 第七轮 A5：走 presignWork 短缓存（与列表/详情/缩略图同纪律）——原逐行裸签名 50 次/页
    })));
    return { items, total };
  }

  // presign + 短缓存纪律（TTL < URL TTL，media.service.ts:16-31 同款）——本任务即定义（Task 3.2 列表/3.3 详情/5.2 缩略图复用；
  // 第七轮前移：原定义在 Task 3.2 会造成本任务的前向引用 tsc 红）
  private async presignWork(key: string): Promise<string> {
    const cacheKey = `videoWork:url:${key}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;
    const url = await this.minio.generatePresignedGetUrl(key, 3600);
    await this.redis.set(cacheKey, url, 'EX', 3500);
    return url;
  }

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
    await this.invalidateWorkCaches(id);
    return row;
  }

  // 第七轮：本任务就地定义（Task 2.4 removeWork 也调用——前向引用 Task 5.3 会让批次 2 的 tsc 编译红、
  // 违反"每任务红-绿-提交"）。Task 5.3 仅把 key 收敛进 PROCESS_CACHE 常量，方法体不变。
  private async invalidateWorkCaches(id: string) {
    await this.redis.del(`videoWork:process:${id}`);
  }

  private assertProcessFlags(w: { allowViewProcess?: boolean; allowClone?: boolean; canvasProjectId?: string | null }) {
    if ((w.allowViewProcess || w.allowClone) && !w.canvasProjectId) {
      throw new BadRequestException('开启创作过程/克隆需要画布来源（canvasProjectId）');
    }
    // 第八轮裁定（spec §4.3）：克隆入口在创作过程视图顶栏——允许克隆必须允许看过程，防"可克隆不可看过程"死开关
    if (w.allowClone && !w.allowViewProcess) {
      throw new BadRequestException('允许克隆必须同时允许查看创作过程（allowClone 依赖 allowViewProcess）');
    }
  }
}
