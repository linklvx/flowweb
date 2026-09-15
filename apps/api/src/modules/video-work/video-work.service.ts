// 空壳，构造签名一次到位——后续任务只加方法、不动构造/providers，spec 文件从创建起就 provide 全部依赖、永不需要二次编辑
import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';
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

  // —— 类型（改类型后删缓存（tags 公开端无缓存，无需失效），spec §4.2 categories 缓存失效） ——
  private static readonly CATEGORY_CACHE_KEY = 'videoWork:categories';

  // like 键构造收敛为单一来源（批次 3 登记落点）：getDetail 读 liked / toggleLike 写删共用，防两处模板漂移
  private static likeKey(workId: string, userId: string): string {
    return `videoWork:like:${workId}:${userId}`;
  }

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

  async listAllWorks(page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.videoWork.findMany({ orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
      this.prisma.videoWork.count(),
    ]);
    return { items, total };
  }
  async getWorkById(id: string) { return this.prisma.videoWork.findUnique({ where: { id } }); }

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
    const liked = userId ? await this.redis.get(VideoWorkService.likeKey(id, userId)).then(v => v === '1') : false; // 匿名短路，同 key（§4.2 约束）
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

  /** 删除红线（spec §4.3）：只删 DB 行，禁止 minio.delete——videoKey 与源 Media 指向同一对象。
   *  HomeBanner "先删对象再删行"先例不可照抄；coverKey 自有上传对象 v1 也统一不删。 */
  async removeWork(id: string) {
    await this.prisma.videoWork.delete({ where: { id } });
    await this.invalidateWorkCaches(id);
  }

  async recordView(id: string, ip: string) {
    const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    const allowed = await this.rateLimiter.checkIpRateLimit(ip, 'video-work:view', 60, 30);
    if (!allowed) throw new ThrottlerException();
    // SET NX 原子去重（1h）——key 存哈希不存明文 IP（spec §4.5 写的就是 ipHash：Redis 内长期驻留客户端明文 IP 是刻意规避的 PII 留存，第七轮对齐）
    const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);
    const ok = await this.redis.set(`videoWork:view:${id}:${ipHash}`, '1', 'EX', 3600, 'NX');
    if (ok !== 'OK') return { counted: false };
    await this.prisma.videoWork.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return { counted: true };
  }

  async toggleLike(id: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
    const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:like', 60, 30); // spec §7.5 限流（第八轮补）
    if (!allowed) throw new ThrottlerException();
    const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    const key = VideoWorkService.likeKey(id, userId);
    const nx = await this.redis.set(key, '1', 'EX', 7776000, 'NX'); // 90 天（§4.5）
    let delta: number;
    if (nx === 'OK') delta = 1;
    else { await this.redis.del(key); delta = -1; } // NX 原子判断，勿 GET-再-SET（并发双击 +2）
    await this.prisma.$executeRaw`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`;
    const row = await this.prisma.videoWork.findUnique({ where: { id }, select: { likeCount: true } });
    return { liked: delta === 1, likeCount: row?.likeCount ?? 0 };
  }

  async uploadCover(buffer: Buffer, mimetype: string): Promise<{ key: string }> {
    // magic-number（WebP 查 12 字节：RIFF(0-3) + 偏移 8-11 WEBP——banner 同款 admin-home-banner.controller.ts:54-57）
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
    if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
    const key = this.minio.buildKey('uploaded', 'system', { ext }); // uploads/system/{date}/{uuid}.{ext}——勿手拼 key 勿用 uuid 包（C1-4）
    await this.minio.upload(key, buffer, mimetype); // upload(key, buffer, contentType) 三参（minio.service.ts:105）
    return { key };
  }

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
}
