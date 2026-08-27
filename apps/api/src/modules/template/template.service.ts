import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { FolderService } from '../folder/folder.service';
import { validateTemplateData } from './template.validation';
import { TeamService } from '../team/team.service';
import { OFFICIAL_USER_ID, TEMPLATE_CACHE_TTL, DEFAULT_PAGE_SIZE } from './template.constants';
import type { TemplateCategory } from '@prisma/client';

interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
  folderId?: string;
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
  ) {}

  async findMany(query: TemplateListQuery, userId: string) {
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
        // 团队化（B2）：团队项目全员可见；保留 userId 以覆盖本人无 project 关联的模板行
        const team = await this.teamService.ensureDefaultTeam(userId);
        where.OR = [{ userId }, { project: { teamId: team.id } }];
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

  async getTemplate(id: string, userId: string) {
    const template = await this.findById(id);
    if (!template.isPublic && template.userId !== userId) {
      throw new ForbiddenException('无权访问此模板');
    }
    return { ...template, isOwner: template.userId === userId };
  }

  async update(id: string, input: UpdateTemplateInput, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      throw new ForbiddenException('无权编辑此模板');
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
        const folder = await this.prisma.folder.findFirst({ where: { id: input.folderId, userId } });
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
      throw new ForbiddenException('无权删除此模板');
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

  async import(id: string, userId: string) {
    try {
      const template = await this.findById(id);

      if (!template.isPublic && template.userId !== userId) {
        throw new ForbiddenException('无权导入此模板');
      }

      if (!template.templateData) {
        throw new BadRequestException('模板数据为空，无法导入');
      }

      const projectData = JSON.parse(JSON.stringify(template.templateData));
      validateTemplateData(projectData);

      let projectName = `${template.name} (副本)`;
      let counter = 1;

      while (true) {
        const existing = await this.prisma.canvasProject.findFirst({
          where: { name: projectName, userId },
        });
        if (!existing) break;
        projectName = `${template.name} (副本 ${++counter})`;
      }

      // Generate fresh IDs to avoid unique constraint conflicts on import
      const ts = Date.now().toString(36);
      const idMap = new Map<string, string>();
      const cleanNodes = (projectData.nodes || []).map((n: any, i: number) => {
        const newId = `n${ts}_${i}`;
        idMap.set(n.id, newId);
        return { id: newId, type: n.type, position: n.position, data: n.data };
      });
      const cleanEdges = (projectData.edges || []).map((e: any, i: number) => {
        const oldSource = e.source || e.sourceId || '';
        const oldTarget = e.target || e.targetId || '';
        return {
          id: `e${ts}_${i}`,
          source: idMap.get(oldSource) || oldSource,
          target: idMap.get(oldTarget) || oldTarget,
        };
      });

      const project = await this.projectService.create(
        projectName,
        userId,
        cleanNodes,
        cleanEdges,
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
      if (!existing) {
        await this.prisma.template.create({ data: tpl });
      }
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
