import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TeamService } from '../team/team.service';
import { assertTeamMember } from '../team/team.util';

interface CreateFolderInput {
  name: string;
  parentId?: string | null;
}

@Injectable()
export class FolderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TeamService) private readonly teamService: TeamService,
  ) {}

  /** 解析目标团队（外部 teamId 优先，否则默认团队）并做成员自证——团队维度入口统一走此门 */
  private async resolveTeamId(teamId: string | undefined | null, userId: string) {
    const resolved = teamId ?? (await this.teamService.ensureDefaultTeam(userId)).id;
    await assertTeamMember(this.prisma, resolved, userId);
    return resolved;
  }

  async list(userId: string, teamId?: string) {
    const teamIdResolved = await this.resolveTeamId(teamId, userId);
    const folders = await this.prisma.folder.findMany({
      where: { teamId: teamIdResolved },
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

  async create(dto: CreateFolderInput, userId: string, teamId?: string) {
    const teamIdResolved = await this.resolveTeamId(teamId, userId);
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.folder.findFirst({ where: { id: dto.parentId } });
      if (!parent || parent.teamId !== teamIdResolved) {
        throw new BadRequestException('不能跨团队挂载文件夹');
      }
      parentId = parent.id;
    }
    // 同名预检查（partial unique index 仅并发兜底，友好报错走这里），维度 = 团队 + 同级
    const duplicate = await this.prisma.folder.findFirst({
      where: { teamId: teamIdResolved, parentId, name: dto.name },
    });
    if (duplicate) throw new BadRequestException('已存在同名文件夹');
    return this.prisma.folder.create({
      data: { name: dto.name, userId, teamId: teamIdResolved, parentId },
    });
  }

  async rename(id: string, name: string, userId: string, teamId?: string) {
    const teamIdResolved = await this.resolveTeamId(teamId, userId);
    const folder = await this.prisma.folder.findFirst({ where: { id, teamId: teamIdResolved } });
    if (!folder) throw new NotFoundException('文件夹不存在');
    const duplicate = await this.prisma.folder.findFirst({
      where: { teamId: teamIdResolved, parentId: folder.parentId, name, id: { not: id } },
    });
    if (duplicate) throw new BadRequestException('已存在同名文件夹');
    return this.prisma.folder.update({ where: { id }, data: { name } });
  }

  async remove(id: string, userId: string, teamId?: string) {
    const teamIdResolved = await this.resolveTeamId(teamId, userId);
    const folder = await this.prisma.folder.findFirst({ where: { id, teamId: teamIdResolved } });
    if (!folder) throw new NotFoundException('文件夹不存在');

    // 删父文件夹时其子文件夹将升入 root（parentId 置空），先消解与 root 同名者——
    // 集合化查重且已分配新名即时占位，防兄弟互撞（如子 A 与兄弟 A (1) 同升 root → A (1) / A (2)）
    const children = await this.prisma.folder.findMany({ where: { parentId: id } });
    const rootNames = await this.prisma.folder.findMany({
      where: { teamId: teamIdResolved, parentId: null },
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
        await this.prisma.folder.update({ where: { id: child.id }, data: { name: newName } });
      }
    }

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
}
