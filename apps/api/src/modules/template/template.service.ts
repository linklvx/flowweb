import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { FolderService } from '../folder/folder.service';
import { TeamService } from '../team/team.service';
import { TeamFundsGateService } from '../team/team-funds-gate.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { assertTeamMember } from '../team/team.util';
import { TEMPLATE_CACHE_TTL, DEFAULT_PAGE_SIZE } from './template.constants';

interface TemplateListQuery {
  type?: 'my';
  search?: string;
  sort?: 'newest';
  page?: number;
  limit?: number;
  folderId?: string;
  teamId?: string;
}

interface UpdateTemplateInput {
  name?: string;
  folderId?: string | null;
}

@Injectable()
export class TemplateService {
  private cache = new Map<string, { data: any; timestamp: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(TeamFundsGateService) private readonly fundsGate: TeamFundsGateService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
    @Inject(EventEmitter2) private readonly eventEmitter: EventEmitter2,
  ) {}

  async findMany(query: TemplateListQuery, userId: string) {
    // teamId 过滤不是鉴权：必须先成员自证，否则任何用户传 teamId 即可枚举团队模板
    if (query.teamId) await assertTeamMember(this.prisma, query.teamId, userId);
    const cacheKey = JSON.stringify({ query, userId });
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.timestamp < TEMPLATE_CACHE_TTL) {
        return cached.data;
      }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * limit;

    const where: any = {};

    // M0 后列表唯一源=type=my（本人 OR 团队项目）；official/community 市场面随 M0 删除
    if (query.teamId) {
      // Template 自带 teamId（带索引）直查：不走 project 反查——多一次 join，且漏掉本团队 projectId=null 的模板行
      where.teamId = query.teamId;
    } else {
      // 团队化（B2）：团队项目全员可见；保留 userId 以覆盖本人无 project 关联的模板行
      const team = await this.teamService.ensureDefaultTeam(userId);
      where.OR = [{ userId }, { project: { teamId: team.id } }];
    }

    // M0 后 type 唯一取值 my（DTO 收窄）——判式塌缩为 folderId 单条件
    if (query.folderId) {
      where.folderId = query.folderId === 'root' ? null : query.folderId;
    }

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    // importCount 列已 drop（M0）——排序塌缩为 createdAt 单源
    const orderBy: any = { createdAt: 'desc' };

    const [templates, total] = await Promise.all([
      this.prisma.template.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.template.count({ where }),
    ]);

    // 读侧收敛（v10 裁决 2 第 ⑤ 点）：解构剥键——模型将来加字段自动跟随，杜绝 select 反推漏字段类回归
    const result = {
      templates: templates.map((t) => ({ ...t, isOwner: t.userId === userId })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };

    this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  async findById(id: string) {
    const template = await this.prisma.template.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('模板不存在');
    return template;
  }

  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      // OR 关系：创建者 / 团队成员 / 项目编辑者 任一通过
      let allowed = false;
      if (template.teamId) {
        const member = await this.prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: template.teamId, userId } },
        });
        if (member) allowed = true;
      }
      if (!allowed && template.projectId) {
        await this.perm.assertEditor(template.projectId, userId);
        allowed = true;
      }
      if (!allowed) throw new ForbiddenException('无权编辑此模板');
    }
    this.clearCache();
    const data: any = {};
    const touchIds = new Set<string>();

    if (input.name !== undefined) data.name = input.name;
    if (input.folderId !== undefined) {
      if (input.folderId !== null) {
        // 跨团队挂载防护：目标文件夹必须属于模板所在团队（无团队模板不可挂团队文件夹）
        const folder = template.teamId
          ? await this.prisma.folder.findFirst({ where: { id: input.folderId, teamId: template.teamId } })
          : null;
        if (!folder) throw new BadRequestException('目标文件夹不存在');
      }
      data.folderId = input.folderId;
      if (input.folderId !== template.folderId) {
        if (template.folderId) touchIds.add(template.folderId);
        if (input.folderId) touchIds.add(input.folderId);
      }
    }
    if (input.name !== undefined && template.folderId) touchIds.add(template.folderId);

    const updated = await this.prisma.template.update({ where: { id }, data });
    if (touchIds.size > 0) await this.folderService.touch([...touchIds]);
    return updated;
  }

  async delete(id: string, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      // D1 收紧：template.delete 会级联删 canvasProject，团队成员 EDITOR 不可删他人整个工程。
      // perm.resolve 的 PROJECT_OWNER 已覆盖 创建者/团队 OWNER/显式项目 OWNER 三种情形（解析链）。
      const role = template.projectId ? await this.perm.resolve(template.projectId, userId) : null;
      if (role !== 'PROJECT_OWNER') {
        throw new ForbiddenException('仅创建者或项目 OWNER 可删除');
      }
    }
    this.clearCache();
    // Y0b-1（§1.4ter/Z4）：模板级联删工程前置清算门（非事务调用点传 this.prisma）
    if (template.projectId) await this.fundsGate.assertSettled(this.prisma, { projectId: template.projectId });
    // 先删 Template 解除 projectId FK，再删工程（nodes/edges 由 DB 级联 Cascade 清理）
    await this.prisma.$transaction([
      this.prisma.template.delete({ where: { id } }),
      ...(template.projectId
        ? [this.prisma.canvasProject.delete({ where: { id: template.projectId } })]
        : []),
    ]);
    // Y0a-2（V11）：项目删除入口之三——事务提交后 emit（回滚=无 emit=无假终态；emitAsync await
    // 监听器——处理器禁慢操作：内存终态+关连接）
    if (template.projectId) await this.eventEmitter.emitAsync('project.gone', { projectIds: [template.projectId] });
    if (template.folderId) await this.folderService.touch([template.folderId]);
    return null;
  }

  clearCache() {
    this.cache.clear();
  }
}
