import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getOwnerTeamId } from '../team/team.util';

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
    // 临时接线：Task 6 将参数化 teamId 并切换团队维度
    const teamId = await getOwnerTeamId(this.prisma, userId);
    return this.prisma.folder.create({ data: { name, userId, teamId } });
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
