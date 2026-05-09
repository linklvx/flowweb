import { Test, TestingModule } from '@nestjs/testing';
import { NodeTypeController } from './node-type.controller';
import { NodeTypeService } from './node-type.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('NodeTypeController', () => {
  let controller: NodeTypeController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NodeTypeController],
      providers: [{ provide: NodeTypeService, useValue: service }],
    }).compile();

    controller = module.get<NodeTypeController>(NodeTypeController);
  });

  it('should return all node types', async () => {
    service.findAll.mockResolvedValue([{ id: '1', name: '文本生成', key: 'text' }]);
    const result = await controller.findAll();
    expect(result).toHaveLength(1);
  });

  it('should return node type by id', async () => {
    service.findById.mockResolvedValue({ id: '1', name: '文本生成', key: 'text' });
    const result = await controller.findById('1');
    expect(result!.key).toBe('text');
  });

  it('should create a node type', async () => {
    const dto = { name: '图片生成', key: 'image' };
    service.create.mockResolvedValue({ id: '1', ...dto });
    const result = await controller.create(dto);
    expect(result.key).toBe('image');
  });

  it('should update a node type', async () => {
    service.update.mockResolvedValue({ id: '1', active: false });
    const result = await controller.update('1', { active: false });
    expect(result!.active).toBe(false);
  });
});
