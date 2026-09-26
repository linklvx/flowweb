import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';

export interface StyleListItem {
  id: string; name: string; coverUrl: string; authorName: string | null;
  isCommercial: boolean; usageCount: number; promptText: string; favorited: boolean;
}

const PAGE_SIZE_MAX = 50;

@Injectable()
export class StylesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MinioService) private readonly minio: MinioService,
  ) {}

  listCategories() {
    return this.prisma.styleCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  }

  async list(
    userId: string,
    q: { tab: string; categoryId?: string; search?: string; commercialOnly?: boolean; page?: number; pageSize?: number },
  ): Promise<{ items: StyleListItem[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(q.pageSize) || 20));

    // 共享 style 过滤（P1-6 第七轮：搜索/商用在收藏/最近 tab 同样生效——搜索框三 tab 恒显，别留假交互）
    const styleFilter: any = { active: true };
    if (q.commercialOnly) styleFilter.isCommercial = true;
    if (q.search) {
      styleFilter.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { authorName: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    // favorites/recent：分页 join 行驱动（该用户收藏/使用时间倒序——非全局收藏数；
    // join 行 id 作 tiebreaker，spec §4.2 稳定序）。all：style 主表分页。
    if (q.tab === 'favorites' || q.tab === 'recent') {
      const isFav = q.tab === 'favorites';
      const model = isFav ? this.prisma.styleFavorite : this.prisma.styleRecentUsage;
      const timeField = isFav ? 'createdAt' : 'lastUsedAt';
      const joinWhere = { userId, style: styleFilter };
      const [joinRows, total] = await Promise.all([
        (model.findMany as any)({
          where: joinWhere,
          orderBy: [{ [timeField]: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: { styleId: true, style: true },
        }),
        (model.count as any)({ where: joinWhere }),
      ]);
      const styleRows = (joinRows as Array<{ style: any }>).map((r) => r.style);
      // favorited 修复（P1-5 第七轮：favorited:true 硬编码会把「用过未收藏」全显示实心星，
      // 且点星第一次 toggle 会误发 false 删不存在的收藏）——recent 批量查真实收藏集
      const favSet = isFav
        ? new Set(styleRows.map((s) => s.id))
        : new Set(
            (await this.prisma.styleFavorite.findMany({
              where: { userId, styleId: { in: styleRows.map((s) => s.id) } },
              select: { styleId: true },
            })).map((f) => f.styleId),
          );
      const items = await Promise.all(
        styleRows.map(async (r) => ({
          id: r.id, name: r.name, authorName: r.authorName, isCommercial: r.isCommercial,
          usageCount: r.usageCount, promptText: r.promptText,
          coverUrl: await this.minio.generatePresignedGetUrl(r.coverKey, 3600),
          favorited: favSet.has(r.id),
        })),
      );
      return { items, total, page, pageSize };
    }

    // spread 而非就地改写（第八轮 B2：styleFilter 为共享对象，就地赋值在将来插入分支时会串味）
    const where: any = q.categoryId ? { ...styleFilter, categoryId: q.categoryId } : styleFilter;

    // 排序含 id tiebreaker（spec §4.2——偏移分页需稳定序）
    const orderBy = [{ sortOrder: 'asc' as const }, { usageCount: 'desc' as const }, { id: 'asc' as const }];

    const [rows, total] = await Promise.all([
      this.prisma.style.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.style.count({ where }),
    ]);

    const favs = await this.prisma.styleFavorite.findMany({
      where: { userId, styleId: { in: rows.map((r) => r.id) } },
      select: { styleId: true },
    });
    const favSet = new Set(favs.map((f) => f.styleId));

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id, name: r.name, authorName: r.authorName, isCommercial: r.isCommercial,
        usageCount: r.usageCount, promptText: r.promptText,
        coverUrl: await this.minio.generatePresignedGetUrl(r.coverKey, 3600),
        favorited: favSet.has(r.id),
      })),
    );
    return { items, total, page, pageSize };
  }

  /** 停用/不存在一律 404（钉死语义，spec §4.5——前端映射为「无风格」）。 */
  async getById(userId: string, id: string): Promise<StyleListItem & { coverKey: string }> {
    const style = await this.prisma.style.findFirst({ where: { id, active: true } });
    if (!style) throw new NotFoundException('风格不存在');
    const fav = await this.prisma.styleFavorite.findUnique({
      where: { userId_styleId: { userId, styleId: id } },
      select: { styleId: true },
    });
    return {
      id: style.id, name: style.name, authorName: style.authorName,
      isCommercial: style.isCommercial, usageCount: style.usageCount, promptText: style.promptText,
      coverKey: style.coverKey,
      coverUrl: await this.minio.generatePresignedGetUrl(style.coverKey, 3600),
      favorited: Boolean(fav),
    };
  }

  /** 幂等 toggle：createMany skipDuplicates / deleteMany 双向不抛（spec D26）。
   *  typeof 校验：controller 无 ValidationPipe，非布尔值不得静默按 false 取消收藏（P17）。 */
  async favorite(userId: string, styleId: string, favorited: boolean): Promise<{ favorited: boolean }> {
    if (typeof favorited !== 'boolean') throw new BadRequestException('favorited 必须为布尔值');
    if (favorited) {
      await this.prisma.styleFavorite.createMany({ data: [{ userId, styleId }], skipDuplicates: true });
    } else {
      await this.prisma.styleFavorite.deleteMany({ where: { userId, styleId } });
    }
    return { favorited };
  }

  /** use 三步非事务（D26：PG 事务 aborted 无 savepoint，事务内 catch P2002 必炸）。计数=首次使用人数（D14）。 */
  async use(userId: string, styleId: string) {
    const style = await this.prisma.style.findFirst({ where: { id: styleId, active: true } });
    if (!style) throw new NotFoundException('风格不存在');

    let isFirstUse = false;
    try {
      await this.prisma.styleRecentUsage.create({ data: { userId, styleId } });
      isFirstUse = true;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      await this.prisma.styleRecentUsage.update({
        where: { userId_styleId: { userId, styleId } },
        data: { lastUsedAt: new Date() },
      });
    }
    if (isFirstUse) {
      await this.prisma.style.updateMany({
        where: { id: styleId, active: true },
        data: { usageCount: { increment: 1 } },
      });
    }
    return this.getById(userId, styleId); // 扁平 StyleListItem（use 返回形状口径：扁平，非 { style } 包装——H3）
  }
}
