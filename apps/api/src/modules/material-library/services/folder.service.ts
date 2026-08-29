import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';
import { DEFAULT_FOLDER_NAMES } from '../constants/material-library.constants';
import { getOwnerTeamId, assertTeamMember } from '../../team/team.util';

@Injectable()
export class FolderService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 团队维度入口统一门：外部 teamId 自证成员资格，否则回落本人默认团队 */
  private async resolveTeamId(teamId: string | undefined | null, userId: string): Promise<string> {
    const resolved = teamId ?? (await getOwnerTeamId(this.prisma, userId));
    await assertTeamMember(this.prisma, resolved, userId);
    return resolved;
  }

  async create(dto: CreateFolderDto, userId: string) {
    const teamId = await this.resolveTeamId(dto.teamId, userId);

    // Auto-calculate sortOrder: max existing sortOrder + 1（团队 + 同级维度）
    const maxResult = await this.prisma.materialFolder.aggregate({
      where: { teamId, parentId: dto.parentId ?? null, deletedAt: null },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxResult._max.sortOrder ?? -1) + 1;

    return this.prisma.materialFolder.create({
      data: {
        name: dto.name,
        parentId: dto.parentId ?? null,
        userId,
        teamId,
        sortOrder,
      },
    });
  }

  async findAll(userId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const folders = await this.prisma.materialFolder.findMany({
      where: { teamId: resolved, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });

    // Lazy creation: if team has no folders (e.g., team created before this feature), create defaults
    if (folders.length === 0) {
      await this.prisma.materialFolder.createMany({
        data: DEFAULT_FOLDER_NAMES.map((name, index) => ({
          name,
          userId,
          teamId: resolved,
          isDefault: true,
          sortOrder: index,
        })),
      });
      return this.prisma.materialFolder.findMany({
        where: { teamId: resolved, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
    }

    return folders;
  }

  async update(id: string, dto: UpdateFolderDto, userId: string) {
    const resolved = await this.resolveTeamId(dto.teamId, userId);
    // Use findFirst (not findUnique) because we filter by teamId + deletedAt
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, teamId: resolved, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');
    return this.prisma.materialFolder.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, teamId: resolved, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');

    const hasFiles = await this.hasFilesRecursive(id, resolved);
    if (hasFiles) throw new BadRequestException('文件夹或其子文件夹中存在文件，请先清空后再删除');

    // 删父文件夹时其子文件夹将升入 root（parentId 置空），先消解与 root 现有同名者——
    // 集合化查重 + 已分配新名即时占位，防兄弟互撞（如子 A 与兄弟 A (1) 同升 root → A (1) / A (2)）
    const children = await this.prisma.materialFolder.findMany({
      where: { parentId: id, teamId: resolved, deletedAt: null },
    });
    const rootNames = await this.prisma.materialFolder.findMany({
      where: { teamId: resolved, parentId: null, deletedAt: null },
      select: { name: true },
    });
    const reserved = new Set(rootNames.map((r) => r.name));
    for (const child of children) {
      const base = child.name.replace(/\s\(\d+\)$/, ''); // 剥末尾序数后缀，同名家族共享一个序数空间
      let newName = child.name;
      let i = 0;
      while (reserved.has(newName)) {
        newName = `${base} (${++i})`;
      }
      reserved.add(newName);
      if (newName !== child.name) {
        await this.prisma.materialFolder.update({ where: { id: child.id }, data: { name: newName } });
      }
    }

    await this.prisma.$transaction([
      this.prisma.materialFolder.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.materialFolder.updateMany({
        where: { parentId: id, teamId: resolved, deletedAt: null },
        data: { parentId: null },
      }),
      this.prisma.media.updateMany({
        where: { folderId: id, teamId: resolved },
        data: { folderId: null },
      }),
    ]);
  }

  /** Recursively check if a folder or any of its descendants contain media files */
  private async hasFilesRecursive(folderId: string, teamId: string): Promise<boolean> {
    const directCount = await this.prisma.media.count({
      where: { folderId, teamId },
    });
    if (directCount > 0) return true;

    const children = await this.prisma.materialFolder.findMany({
      where: { parentId: folderId, teamId, deletedAt: null },
      select: { id: true },
    });

    for (const child of children) {
      const childHasFiles = await this.hasFilesRecursive(child.id, teamId);
      if (childHasFiles) return true;
    }

    return false;
  }

  async moveUp(id: string, userId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, teamId: resolved, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');

    const previousFolder = await this.prisma.materialFolder.findFirst({
      where: {
        teamId: resolved,
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
    teamId: string,
  ): Promise<boolean> {
    const visited = new Set<string>();
    let currentId: string | null = folderId;

    while (currentId !== null) {
      if (currentId === ancestorId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);

      const folder: { parentId: string | null } | null =
        await this.prisma.materialFolder.findFirst({
          where: { id: currentId, teamId, deletedAt: null },
          select: { parentId: true },
        });
      currentId = folder?.parentId ?? null;
    }
    return false;
  }

  /** Calculate folder depth from root (root has depth 0, its child has depth 1, etc.) */
  private async getFolderDepth(
    folderId: string | null,
    teamId: string,
  ): Promise<number> {
    if (!folderId) return -1;
    let depth = 0;
    let currentId: string | null = folderId;

    while (currentId !== null) {
      const folder: { parentId: string | null } | null =
        await this.prisma.materialFolder.findFirst({
          where: { id: currentId, teamId, deletedAt: null },
          select: { parentId: true },
        });
      currentId = folder?.parentId ?? null;
      if (currentId) depth++;
    }
    return depth;
  }

  async moveFolder(id: string, dto: MoveFolderDto, userId: string, teamId?: string) {
    const resolved = await this.resolveTeamId(teamId, userId);
    const folder = await this.prisma.materialFolder.findFirst({
      where: { id, teamId: resolved, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('文件夹不存在');

    const targetParentId = dto.parentId ?? null;

    if (targetParentId) {
      const parent = await this.prisma.materialFolder.findFirst({
        where: { id: targetParentId, teamId: resolved, deletedAt: null },
      });
      if (!parent) throw new BadRequestException('目标父文件夹不存在');

      // 3-level nesting depth limit
      const targetDepth = await this.getFolderDepth(targetParentId, resolved);
      if (targetDepth >= 2) {
        throw new BadRequestException('文件夹嵌套深度不能超过3层（父→子→孙）');
      }
    }

    // Prevent circular reference
    if (targetParentId !== folder.parentId && targetParentId !== null) {
      const wouldCycle = await this.isDescendant(targetParentId, id, resolved);
      if (wouldCycle) throw new BadRequestException('不能将文件夹移入其自身或其子文件夹');
    }

    // 同名预检查（跨父移动会撞 partial unique index，友好报错走这里，并发兜底靠索引）
    const duplicate = await this.prisma.materialFolder.findFirst({
      where: { teamId: resolved, parentId: targetParentId, name: folder.name, id: { not: id }, deletedAt: null },
    });
    if (duplicate) throw new BadRequestException('目标目录下已存在同名文件夹');

    // Fetch siblings under target parent (excluding moving folder)
    const siblings = await this.prisma.materialFolder.findMany({
      where: { teamId: resolved, parentId: targetParentId, deletedAt: null, id: { not: id } },
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
