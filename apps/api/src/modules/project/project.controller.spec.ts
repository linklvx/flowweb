import { Test, TestingModule } from '@nestjs/testing';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ProjectController', () => {
  let controller: ProjectController;
  let service: any;
  let prisma: any;

  beforeEach(async () => {
    service = {
      create: vi.fn().mockResolvedValue({ id: 'p1', name: 'test' }),
      findById: vi.fn().mockResolvedValue({ id: 'p1', nodes: [], edges: [] }),
      updateName: vi.fn().mockResolvedValue({ id: 'p1', name: 'updated' }),
      delete: vi.fn().mockResolvedValue({}),
      getProjectFolder: vi.fn().mockResolvedValue({ folderId: null }),
    };
    prisma = { teamMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) } };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectController],
      providers: [
        { provide: ProjectService, useValue: service },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get<ProjectController>(ProjectController);
  });

  it('POST /api/projects should create project（带登录 userId）', async () => {
    const result = await controller.create({ name: 'test' }, { user: { id: 'u1' } } as any);
    expect(result.id).toBe('p1');
    expect(service.create).toHaveBeenCalledWith('test', 'u1', undefined, undefined, undefined);
  });

  it('POST /api/projects should default name to 未命名项目', async () => {
    await controller.create({ name: '' }, { user: { id: 'u1' } } as any);
    expect(service.create).toHaveBeenCalledWith('未命名项目', 'u1', undefined, undefined, undefined);
  });

  it('POST /api/projects 透传 body.teamId', async () => {
    await controller.create({ name: 'test', teamId: 't1' }, { user: { id: 'u1' } } as any);
    expect(service.create).toHaveBeenCalledWith('test', 'u1', undefined, undefined, 't1');
  });

  it('GET /api/projects/:id should return project', async () => {
    const result = await controller.getProject('p1');
    expect(result.id).toBe('p1');
  });

  it('GET /api/projects/:id/folder 登录+teamId 时校验成员并透传', async () => {
    await controller.getProjectFolder('p1', 't1', { user: { id: 'u1' } } as any);
    expect(prisma.teamMember.findFirst).toHaveBeenCalledWith({
      where: { teamId: 't1', userId: 'u1', team: { status: 'ACTIVE' } },
      select: { role: true },
    });
    expect(service.getProjectFolder).toHaveBeenCalledWith('p1', 'u1', 't1');
  });

  it('GET /api/projects/:id/folder 非成员抛 403', async () => {
    prisma.teamMember.findFirst.mockResolvedValue(null);
    await expect(controller.getProjectFolder('p1', 't1', { user: { id: 'u1' } } as any)).rejects.toThrow('非团队成员');
    expect(service.getProjectFolder).not.toHaveBeenCalled();
  });

  it('GET /api/projects/:id/folder 未登录或缺 teamId 直接返回 null', async () => {
    expect(await controller.getProjectFolder('p1', 't1', {} as any)).toEqual({ folderId: null });
    expect(await controller.getProjectFolder('p1', undefined, { user: { id: 'u1' } } as any)).toEqual({ folderId: null });
    expect(prisma.teamMember.findFirst).not.toHaveBeenCalled();
    expect(service.getProjectFolder).not.toHaveBeenCalled();
  });

  it('PATCH /api/projects/:id should update project name', async () => {
    const result = await controller.updateName('p1', { name: '新名字' });
    expect(result.id).toBe('p1');
    expect(service.updateName).toHaveBeenCalledWith('p1', '新名字');
  });

  it('DELETE /api/projects/:id should delete project', async () => {
    await controller.delete('p1');
    expect(service.delete).toHaveBeenCalledWith('p1');
  });
});
