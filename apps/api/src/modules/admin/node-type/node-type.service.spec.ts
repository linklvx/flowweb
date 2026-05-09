import { Test, TestingModule } from '@nestjs/testing';
import { NodeTypeService } from './node-type.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('NodeTypeService', () => {
  let service: NodeTypeService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      nodeType: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [NodeTypeService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<NodeTypeService>(NodeTypeService);
  });

  it('should list all node types', async () => {
    const mock = [{ id: '1', name: '文本生成', key: 'text', description: null, active: true, createdAt: new Date(), updatedAt: new Date() }];
    prisma.nodeType.findMany.mockResolvedValue(mock);
    const result = await service.findAll();
    expect(result).toHaveLength(1);
  });

  it('should create a node type', async () => {
    const dto = { name: '图片生成', key: 'image', description: 'AI图片生成' };
    prisma.nodeType.create.mockResolvedValue({ id: '1', ...dto, active: true, createdAt: new Date(), updatedAt: new Date() });
    const result = await service.create(dto);
    expect(result.key).toBe('image');
  });

  it('should update a node type', async () => {
    prisma.nodeType.update.mockResolvedValue({ id: '1', name: 'updated', key: 'text', description: null, active: false, createdAt: new Date(), updatedAt: new Date() });
    const result = await service.update('1', { active: false });
    expect(result.active).toBe(false);
  });

  it('should find node type by id', async () => {
    prisma.nodeType.findUnique.mockResolvedValue({ id: '1', name: 'text', key: 'text', models: [] });
    const result = await service.findById('1');
    expect(result.key).toBe('text');
    expect(prisma.nodeType.findUnique).toHaveBeenCalledWith({ where: { id: '1' }, include: { models: true } });
  });
});
