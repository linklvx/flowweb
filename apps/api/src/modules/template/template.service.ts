import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { validateParentGraph } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { validateTemplateData } from './template.validation';
import { TeamService } from '../team/team.service';
import { ProjectPermissionService } from '../team/project-permission.service';
import { assertTeamMember } from '../team/team.util';
import { buildFilteredSnapshot, CLONE_WHITELIST, ensureParentFirst } from '../video-work/snapshot-filter.util';
import { OFFICIAL_USER_ID, TEMPLATE_CACHE_TTL, DEFAULT_PAGE_SIZE } from './template.constants';
import type { TemplateCategory, Template } from '@prisma/client';

interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
  folderId?: string;
  teamId?: string;
}

interface UpdateTemplateInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
  folderId?: string | null;
}

@Injectable()
export class TemplateService {
  private cache = new Map<string, { data: any; timestamp: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(FolderService) private readonly folderService: FolderService,
    @Inject(TeamService) private readonly teamService: TeamService,
    @Inject(ProjectPermissionService) private readonly perm: ProjectPermissionService,
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

    switch (query.type) {
      case 'official':
        where.userId = OFFICIAL_USER_ID;
        where.isPublic = true;
        break;
      case 'my': {
        if (query.teamId) {
          // Template 自带 teamId（带索引）直查：不走 project 反查——多一次 join，且漏掉本团队 projectId=null 的模板行
          where.teamId = query.teamId;
        } else {
          // 团队化（B2）：团队项目全员可见；保留 userId 以覆盖本人无 project 关联的模板行
          const team = await this.teamService.ensureDefaultTeam(userId);
          where.OR = [{ userId }, { project: { teamId: team.id } }];
        }
        break;
      }
      case 'community':
      default:
        where.isPublic = true;
        where.userId = { not: OFFICIAL_USER_ID };
        break;
    }

    if (query.type === 'my' && query.folderId) {
      where.folderId = query.folderId === 'root' ? null : query.folderId;
    }

    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const orderBy: any = query.sort === 'newest'
      ? { createdAt: 'desc' }
      : { importCount: 'desc' };

    const [templates, total] = await Promise.all([
      this.prisma.template.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.template.count({ where }),
    ]);

    // 读侧收敛（v10 裁决 2 第 ⑤ 点）：剥 templateData 单键、其余模型字段全量下发（解构剥键——
    // 模型将来加字段自动跟随，杜绝 select 反推漏字段类回归）；公开行的 templateData 等同公开载荷
    const result = {
      templates: templates.map(({ templateData, ...t }) => ({ ...t, isOwner: t.userId === userId })),
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

  /** 读侧收敛后返回形：owner=全字段；非 owner 剥 templateData（键不存在——故类型上可选，运行时缺键） */
  async getTemplate(
    id: string,
    userId: string,
  ): Promise<Omit<Template, 'templateData'> & { templateData?: Template['templateData']; isOwner: boolean }> {
    const template = await this.findById(id);
    if (!template.isPublic && template.userId !== userId) {
      // 鉴权为 OR 关系：团队成员 OR 项目显式协作者任一通过即放行。
      // 不得写成 if-else if 互斥——普通团队允许 addProjectMember 添加外部协作者（Task 4 只拦默认团队），
      // 互斥写法会让非团队成员的项目协作者永远打不开项目内模板。
      let allowed = false;
      if (template.teamId) {
        // 成员判断用 findUnique 直查而非 assertTeamMember——此处需要"成员资格作为 OR 条件之一"而非"不通过即抛"
        const member = await this.prisma.teamMember.findUnique({
          where: { teamId_userId: { teamId: template.teamId, userId } },
        });
        if (member) allowed = true;
      }
      if (!allowed && template.projectId) {
        const perm = await this.perm.resolve(template.projectId, userId);
        if (perm) allowed = true;
      }
      if (!allowed) throw new ForbiddenException('无权访问此模板');
    }
    const { templateData, ...rest } = template;
    return template.userId === userId
      ? { ...template, isOwner: true }
      : { ...rest, isOwner: false };
  }

  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      // OR 关系（同 getTemplate）：创建者 / 团队成员 / 项目编辑者 任一通过
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
    if (input.description !== undefined) data.description = input.description;
    if (input.isPublic !== undefined) {
      data.isPublic = input.isPublic;
      data.category = input.isPublic ? 'COMMUNITY' : undefined;
    }
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
    // 先删 Template 解除 projectId FK，再删工程（nodes/edges 由 DB 级联 Cascade 清理）
    await this.prisma.$transaction([
      this.prisma.template.delete({ where: { id } }),
      ...(template.projectId
        ? [this.prisma.canvasProject.delete({ where: { id: template.projectId } })]
        : []),
    ]);
    if (template.folderId) await this.folderService.touch([template.folderId]);
    return null;
  }

  async import(id: string, userId: string, teamId?: string) {
    try {
      // 先成员自证：他团队成员猜 teamId 不得借 import 落资源（默认团队路径亦统一过此门）
      const teamIdResolved = teamId ?? (await this.teamService.ensureDefaultTeam(userId)).id;
      await assertTeamMember(this.prisma, teamIdResolved, userId);
      const template = await this.findById(id);

      if (!template.isPublic && template.userId !== userId) {
        throw new ForbiddenException('无权导入此模板');
      }

      if (!template.templateData) {
        throw new BadRequestException('模板数据为空，无法导入');
      }

      let projectData = JSON.parse(JSON.stringify(template.templateData));
      // v3：守卫前置——残缺行（缺 nodes/edges）在过滤前 fail-closed 成 400 业务文案
      if (!Array.isArray(projectData?.nodes) || !Array.isArray(projectData?.edges)) {
        throw new BadRequestException('模板数据为空，无法导入');
      }
      // Task 21（F39 v6 判据）：导入档校验钉在跨用户过滤/remap 之前——remap 把悬空折 undefined（挂后 dangling 恒 0 假绿）；
      // 过滤剥节点（dropTypes/dropIdPrefixes）后 cells 变悬空（挂后合法公开模板假拒）。fatal=producer 侧不可能合法产出的结构（400 三种）；
      // 三类悬空=修不拒（producer 侧可达：删组窗口/过滤剥节点——下方 remap 循环内折 undefined/null/丢边）
      const { violations } = validateParentGraph(projectData.nodes, 'import', projectData.edges);
      const fatal = violations.filter((v) => ['cycle', 'nested-group', 'non-group-parent'].includes(v.kind));
      if (fatal.length > 0) throw new BadRequestException(`模板组结构非法（${fatal[0].kind}: ${fatal[0].id}），无法导入`);
      const nonFatal = violations.length - fatal.length;
      if (nonFatal > 0) console.warn(`[template.import] 悬空结构 ${nonFatal} 处已修复放行（parentId→undefined/cells→null/悬空边丢弃）`);
      // 跨用户导入过滤（v9 裁决③：覆盖"私有→后公开"旧行）；
      // 模板 JSON edges 本就是 source/target 单形状（EdgeSchema）——直传，无键名转换（R1a 收敛）
      if (template.isPublic && template.userId !== userId) {
        const filtered = buildFilteredSnapshot(
          {
            nodes: projectData.nodes,
            edges: projectData.edges,
          },
          { dropTypes: [], dropIdPrefixes: [], resetStatusIdle: true, injectThumbnails: false, whitelist: CLONE_WHITELIST },
        );
        projectData = { ...projectData, nodes: filtered.nodes, edges: filtered.edges };
      }
      validateTemplateData(projectData);

      let projectName = `${template.name} (副本)`;
      let counter = 1;

      // 重名查重按团队维度：队友导入同一模板时不因 userId 不同产生错乱编号
      while (true) {
        const existing = await this.prisma.canvasProject.findFirst({
          where: { name: projectName, teamId: teamIdResolved },
        });
        if (!existing) break;
        projectName = `${template.name} (副本 ${++counter})`;
      }

      // Generate fresh IDs to avoid unique constraint conflicts on import
      const ts = Date.now().toString(36);
      const idMap = new Map<string, string>();
      const rawNodes = ensureParentFirst(projectData.nodes || []);
      for (const n of rawNodes) idMap.set(n.id, `n${ts}_${idMap.size}`);
      // 第一遍建全 idMap（边建边用会误判靠后节点为悬空）
      const cleanNodes = rawNodes.map((n: any) => ({
        id: idMap.get(n.id)!,
        type: n.type,
        parentId: n.parentId ? (idMap.get(n.parentId) ?? undefined) : undefined,  // 悬空→undefined（非 null——NodeSchema optional）
        width: n.width ?? undefined,
        height: n.height ?? undefined,
        position: n.position ?? { x: 0, y: 0 },
        data: n.data ?? {},
      }));
      // 第二遍组 cells 单独重映射（悬空→null 长度不变；null=空宫格占位保留）
      for (const n of cleanNodes) {
        if (n.type !== 'group') continue;
        if (n.data.cells == null) continue;                       // 缺失=合法（无宫格配置的组）
        if (!Array.isArray(n.data.cells)) {                       // v3：非数组的"宫格结构损坏"fail-closed
          throw new BadRequestException('分镜组宫格结构损坏（cells 非数组），无法导入');
        }
        n.data.cells = (n.data.cells as (string | null)[]).map(c =>
          c === null || c === undefined ? null : (idMap.get(c) ?? null),
        );
      }
      // 悬空边丢弃（source/target 任一未命中 idMap 即 continue——"|| e.source 保留原 id"的反模式同源清除，R1a 收敛）
      const cleanEdges = (projectData.edges || []).flatMap((e: any, i: number) => {
        const source = idMap.get(e.source);
        const target = idMap.get(e.target);
        if (source == null || target == null) return [];
        return [{ id: `e${ts}_${i}`, source, target }];
      });

      const project = await this.projectService.create(
        projectName,
        userId,
        cleanNodes,
        cleanEdges,
        teamIdResolved,
      );

      await this.prisma.template.update({
        where: { id },
        data: { importCount: { increment: 1 } },
      });

      return project;
    } catch (e: unknown) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      const message = e instanceof Error ? e.message : '导入失败';
      throw new BadRequestException(message);
    }
  }

  async initOfficialTemplates() {
    // 确保系统用户存在，满足 FK 约束
    await this.prisma.user.upsert({
      where: { id: OFFICIAL_USER_ID },
      update: {},
      create: {
        id: OFFICIAL_USER_ID,
        name: 'Official Templates',
        email: 'official@flowweb.local',
        emailVerified: true,
      },
    });

    const officialTemplates = [
      {
        name: '文生图工作流',
        description: '基础的文本生成图片模板，输入文字描述即可生成对应图片',
        isPublic: true,
        category: 'OFFICIAL' as TemplateCategory,
        userId: OFFICIAL_USER_ID,
        templateData: {
          version: 1,
          nodes: [
            { id: 'text-1', type: 'textInput', position: { x: 100, y: 100 }, data: { text: '' } },
            { id: 'image-1', type: 'imageGen', position: { x: 400, y: 100 }, data: { model: 'default' } },
          ],
          edges: [{ id: 'e1', source: 'text-1', target: 'image-1' }],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    ];

    for (const tpl of officialTemplates) {
      const existing = await this.prisma.template.findFirst({
        where: { name: tpl.name, userId: OFFICIAL_USER_ID },
      });
      if (existing) {
        await this.prisma.template.update({
          where: { id: existing.id },
          data: { templateData: tpl.templateData, description: tpl.description }, // 幂等覆盖：dev 旧行自愈补 version
        });
      } else {
        await this.prisma.template.create({ data: tpl });
      }
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
