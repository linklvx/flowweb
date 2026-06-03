import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';
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

  /** Check if ancestorId is an ancestor of folderId (walking up parent chain) */
  private async isDescendant(
    folderId: string,
    ancestorId: string,
    userId: string,
  ): Promise<boolean> {
    const visited = new Set<string>();
    let currentId: string | null = folderId;

    while (currentId !== null) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);

      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: currentId, userId, deletedAt: null },
        select: { parentId: true },
      });
      currentId = folder?.parentId ?? null;
    }
    return false;
  }

  /** Calculate folder depth from root (root has depth 0, its child has depth 1, etc.) */
  private async getFolderDepth(
    folderId: string | null,
    userId: string,
  ): Promise<number> {
    if (!folderId) return -1;
    let depth = 0;
    let currentId: string | null = folderId;

    while (currentId !== null) {
      const folder = await this.prisma.materialFolder.findFirst({
        where: { id: currentId, userId, deletedAt: null },
        select: { parentId: true },
      });
      currentId = folder?.parentId ?? null;
      if (currentId) depth++;
    }
    return depth;
  }

  async moveFolder(id: string, dto: MoveFolderDto, userId: string) {
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, userId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    if (folder.isDefault) throw new BadRequestException('系统默认文件夹不可移动');

    const targetParentId = dto.parentId ?? null;

    if (targetParentId) {
      const parent = await this.prisma.materialFolder.findFirst({
        where: { id: targetParentId, userId, deletedAt: null },
      });
      if (!parent) throw new BadRequestException('目标父文件夹不存在');
      if (parent.isDefault) throw new BadRequestException('不能将文件夹移入系统默认文件夹');

      // 3-level nesting depth limit
      const targetDepth = await this.getFolderDepth(targetParentId, userId);
      if (targetDepth >= 2) {
        throw new BadRequestException('文件夹嵌套深度不能超过3层（父→子→孙）');
      }
    }

    // Prevent circular reference
    if (targetParentId !== folder.parentId && targetParentId !== null) {
      const wouldCycle = await this.isDescendant(targetParentId, id, userId);
      if (wouldCycle) throw new BadRequestException('不能将文件夹移入其自身或其子文件夹');
    }

    // Fetch siblings under target parent (excluding moving folder)
    const siblings = await this.prisma.materialFolder.findMany({
      where: { userId, parentId: targetParentId, deletedAt: null, id: { not: id } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    });

    // Determine insertion index
    let insertIndex: number;
    if (dto.afterId === null) {
      insertIndex = 0;
    } else {
      const afterIdx = siblings.findIndex((s) => s.id === dto.afterId);
      if (afterIdx === -1) {
        throw new BadRequestException('参考位置文件夹不在目标父文件夹下');
      }
      insertIndex = afterIdx + 1;
    }

    // Build update operations: renumber siblings + move target folder
    const operations: any[] = [];

    for (let i = 0; i < siblings.length; i++) {
      const newSortOrder = i >= insertIndex ? i + 1 : i;
      if (siblings[i].sortOrder !== newSortOrder) {
        operations.push(
          this.prisma.materialFolder.update({
            where: { id: siblings[i].id },
            data: { sortOrder: newSortOrder },
          }),
        );
      }
    }

    operations.push(
      this.prisma.materialFolder.update({
        where: { id },
        data: {
          parentId: targetParentId,
          sortOrder: insertIndex,
        },
      }),
    );

    await this.prisma.$transaction(operations);
  }
}
