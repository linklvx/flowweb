import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import type { CreateStyleCategoryDto, UpdateStyleCategoryDto } from './dto/style-category.dto';
import type { CreateStyleDto, UpdateStyleDto } from './dto/style.dto';

@Injectable()
export class AdminStyleService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  // ==== 分类 ====
  listCategories() {
    return this.prisma.styleCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createCategory(dto: CreateStyleCategoryDto) {
    const dup = await this.prisma.styleCategory.findUnique({ where: { name: dto.name } });
    if (dup) throw new BadRequestException('分类已存在');
    try {
      return await this.prisma.styleCategory.create({ data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('分类已存在'); // 并发创建撞唯一名（P16）
      throw e;
    }
  }

  async updateCategory(id: string, dto: UpdateStyleCategoryDto) {
    const existing = await this.prisma.styleCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.styleCategory.update({ where: { id }, data }).catch((e) => {
      if ((e as { code?: string }).code === 'P2002') throw new BadRequestException('分类已存在'); // 改名撞唯一索引（P2-1——比并发创建更常见）
      throw e;
    });
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.styleCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('分类不存在');
    const styleCount = await this.prisma.style.count({ where: { categoryId: id } });
    // 删除保护 400（先例 modules/material-library/services/folder.service.ts:93-94）
    if (styleCount > 0) throw new BadRequestException('该分类下存在风格，请先清空后再删除');
    return this.prisma.styleCategory.delete({ where: { id } });
  }

  // ==== 风格内容 ====
  async listStyles(q: { categoryId?: string; search?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize) || 20));
    const where: any = {};
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { authorName: { contains: q.search, mode: 'insensitive' } }];
    const [items, total] = await Promise.all([
      this.prisma.style.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: { category: { select: { name: true } } } }),
      this.prisma.style.count({ where }),
    ]);
    return {
      items: await Promise.all(items.map(async (s) => ({ ...s, coverUrl: await this.minio.generatePresignedGetUrl(s.coverKey, 3600) }))),
      total, page, pageSize,
    };
  }

  async createStyle(dto: CreateStyleDto) {
    try {
      return await this.prisma.style.create({
        data: {
          name: dto.name, categoryId: dto.categoryId, coverKey: dto.coverKey,
          authorName: dto.authorName ?? null, isCommercial: dto.isCommercial ?? false,
          promptText: dto.promptText, sortOrder: dto.sortOrder ?? 0, active: dto.active ?? true,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2003') throw new BadRequestException('分类不存在'); // 非法 categoryId FK（P16）
      throw e;
    }
  }

  async updateStyle(id: string, dto: UpdateStyleDto) {
    const existing = await this.prisma.style.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('风格不存在');
    const data: Record<string, unknown> = {};
    for (const k of ['name', 'categoryId', 'authorName', 'isCommercial', 'promptText', 'sortOrder', 'active'] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    const coverChanged = dto.coverKey !== undefined && dto.coverKey !== existing.coverKey;
    if (coverChanged) data.coverKey = dto.coverKey;
    const updated = await this.prisma.style.update({ where: { id }, data }).catch((e) => {
      if ((e as { code?: string }).code === 'P2003') throw new BadRequestException('分类不存在');
      throw e;
    });
    if (coverChanged) await this.minio.delete(existing.coverKey).catch(() => {}); // 换图清旧对象，失败不阻断（banner 先例）
    return updated;
  }

  async deleteStyle(id: string) {
    const existing = await this.prisma.style.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('风格不存在');
    // 对象删除失败不阻断行删除（updateStyle 同款 .catch；MinIO 抖动时管理员不被 500 卡死——P3-4）
    await this.minio.delete(existing.coverKey).catch(() => {});
    return this.prisma.style.delete({ where: { id } }); // Cascade 清收藏/最近由 FK 承担
  }

  // ==== 封面上传（admin-video-work.controller.ts:30-42 + video-work.service.ts:372-382 先例） ====
  async uploadCover(buffer: Buffer, mimetype: string): Promise<{ key: string }> {
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
    if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
    const key = this.minio.buildKey('uploaded', 'system', { ext });
    await this.minio.upload(key, buffer, mimetype);
    return { key };
  }
}
