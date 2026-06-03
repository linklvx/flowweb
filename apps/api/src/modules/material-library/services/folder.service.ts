import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { DEFAULT_FOLDER_NAMES } from '../constants/material-library.constants';

@Injectable()
export class FolderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateFolderDto, userId: string) {
    // Auto-calculate sortOrder: max existing sortOrder + 1
    const maxResult = await this.prisma.materialFolder.aggregate({
      where: { userId, parentId: dto.parentId ?? null, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxResult._max.sortOrder ?? -1) + 1;

    return this.prisma.materialFolder.create({
      data: {
        name: dto.name,
        parentId: dto.parentId ?? null,
        userId,
        sortOrder,
      },
    });
  }

  async findAllByUserId(userId: string) {
    const folders = await this.prisma.materialFolder.findMany({
      where: { userId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    // Lazy creation: if user has no folders (e.g., account created before this feature), create defaults
    if (folders.length === 0) {
      await this.prisma.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((name, index) => ({
          name,
          userId,
          isDefault: true,
          sortOrder: index,
        })),
      });
      return this.prisma.materialFolder.findMany({
        where: { userId, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return folders;
  }

  async update(id: string, dto: UpdateFolderDto, userId: string) {
    // Use findFirst (not findUnique) because we filter by userId + deletedAt
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可修改');
    return this.prisma.materialFolder.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可删除');

    await this.prisma.$transaction([
      this.prisma.materialFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.materialFolder.updateMany({
        where: { parentId: id, userId, deletedAt: null },
        data: { parentId: null },
      }),
      this.prisma.media.updateMany({
        where: { folderId: id, userId },
        data: { folderId: null },
      }),
    ]);
  }

  async moveUp(id: string, userId: string) {
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可移动');

    const previousFolder = await this.prisma.materialFolder.findFirst({
      where: {
        userId,
        parentId: folder.parentId,
        deletedAt: null,
        sortOrder: { lt: folder.sortOrder },
      },
      orderBy: { sortOrder: 'desc' },
    });

    if (!previousFolder) return;

    await this.prisma.$transaction([
      this.prisma.materialFolder.update({
        where: { id: folder.id },
        data: { sortOrder: previousFolder.sortOrder },
      }),
      this.prisma.materialFolder.update({
        where: { id: previousFolder.id },
        data: { sortOrder: folder.sortOrder },
      }),
    ]);
  }
}
