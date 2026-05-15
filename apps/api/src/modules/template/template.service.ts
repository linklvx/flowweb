import { Injectable, Inject, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectService } from '../project/project.service';
import { validateTemplateData } from './template.validation';
import { OFFICIAL_USER_ID, TEMPLATE_CACHE_TTL, DEFAULT_PAGE_SIZE } from './template.constants';
import type { TemplateCategory } from '@prisma/client';

interface CreateTemplateInput {
  projectId: string;
  name: string;
  description?: string;
  isPublic?: boolean;
}

interface TemplateListQuery {
  type?: 'official' | 'my' | 'community';
  search?: string;
  sort?: 'importCount' | 'newest';
  page?: number;
  limit?: number;
}

interface UpdateTemplateInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

@Injectable()
export class TemplateService {
  private cache = new Map<string, { data: any; timestamp: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
  ) {}

  async create(input: CreateTemplateInput, userId: string) {
    const project = await this.projectService.findById(input.projectId);
    if (project.userId !== null && project.userId !== userId) {
      throw new ForbiddenException('无权将此项目保存为模板');
    }

    // Normalize edges: Prisma sourceId/targetId → ReactFlow source/target
    const edges = (project.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sourceId || e.source || '',
      target: e.targetId || e.target || '',
    }));

    const templateData = {
      nodes: project.nodes || [],
      edges,
      viewport: project.viewport,
    };

    try {
      validateTemplateData(templateData);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '模板数据验证失败';
      throw new BadRequestException(message);
    }

    this.clearCache();
    return this.prisma.template.create({
      data: {
        name: input.name,
        description: input.description,
        isPublic: input.isPublic ?? false,
        userId,
        templateData,
        category: input.isPublic ? 'COMMUNITY' : undefined,
      },
    });
  }

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
      case 'my':
        where.userId = userId;
        break;
      case 'community':
      default:
        where.isPublic = true;
        where.userId = { not: OFFICIAL_USER_ID };
        break;
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
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isPublic !== undefined) {
      data.isPublic = input.isPublic;
      data.category = input.isPublic ? 'COMMUNITY' : undefined;
    }
    return this.prisma.template.update({ where: { id }, data });
  }

  async delete(id: string, userId: string) {
    const template = await this.findById(id);
    if (template.userId !== userId) {
      throw new ForbiddenException('无权删除此模板');
    }
    this.clearCache();
    return this.prisma.template.delete({ where: { id } });
  }

  async import(id: string, userId: string) {
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

    const project = await this.projectService.create(
      projectName,
      userId,
      projectData.nodes || [],
      projectData.edges || [],
      projectData.viewport,
    );

    await this.prisma.template.update({
      where: { id },
      data: { importCount: { increment: 1 } },
    });

    return project;
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
      await this.prisma.template.upsert({
        where: { name_userId: { name: tpl.name, userId: OFFICIAL_USER_ID } },
        update: {},
        create: tpl,
      });
    }
  }

  private clearCache() {
    this.cache.clear();
  }
}
