// 空壳，构造签名一次到位——后续任务只加方法、不动构造/providers，spec 文件从创建起就 provide 全部依赖、永不需要二次编辑
import { Injectable, Inject } from '@nestjs/common';
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
}
