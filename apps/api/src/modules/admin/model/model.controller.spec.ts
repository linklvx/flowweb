import { Test, TestingModule } from '@nestjs/testing';
import { ModelController } from './model.controller';
import { ModelService } from './model.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ModelController', () => {
  let controller: ModelController;
  let service: {
    findByNodeType: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    toggle: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    addResolution: ReturnType<typeof vi.fn>;
    removeResolution: ReturnType<typeof vi.fn>;
    addDuration: ReturnType<typeof vi.fn>;
    removeDuration: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      findByNodeType: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      toggle: vi.fn(),
      delete: vi.fn(),
      addResolution: vi.fn(),
      removeResolution: vi.fn(),
      addDuration: vi.fn(),
      removeDuration: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModelController],
      providers: [{ provide: ModelService, useValue: service }],
    }).compile();

    controller = module.get<ModelController>(ModelController);
  });

  it('should list models by node type', async () => {
    service.findByNodeType.mockResolvedValue([{ id: 'm1', name: 'SD XL' }]);
    const result = await controller.findByNodeType('nt1');
    expect(result).toHaveLength(1);
  });

  it('should get model by id', async () => {
    service.findById.mockResolvedValue({ id: 'm1', name: 'SD XL' });
    const result = await controller.findById('m1');
    expect(result.name).toBe('SD XL');
  });

  it('should create a model under a node type', async () => {
    const dto = { name: 'SD XL', provider: 'Stability', apiUrl: 'https://api.example.com' };
    service.create.mockResolvedValue({ id: 'm1', ...dto, nodeTypeId: 'nt1' });
    const result = await controller.create('nt1', dto);
    expect(result.id).toBe('m1');
  });

  it('should update a model', async () => {
    service.update.mockResolvedValue({ id: 'm1', name: 'updated' });
    const result = await controller.update('m1', { name: 'updated' });
    expect(result.name).toBe('updated');
  });

  it('should toggle a model', async () => {
    service.toggle.mockResolvedValue({ id: 'm1', active: false });
    const result = await controller.toggle('m1');
    expect(result.active).toBe(false);
  });

  it('should delete a model', async () => {
    service.delete.mockResolvedValue({ id: 'm1' });
    await controller.delete('m1');
    expect(service.delete).toHaveBeenCalledWith('m1');
  });

  it('should add resolution to model', async () => {
    service.addResolution.mockResolvedValue({ id: 'r1', label: '1024x1024', width: 1024, height: 1024 });
    const result = await controller.addResolution('m1', { label: '1024x1024', width: 1024, height: 1024 });
    expect(result.label).toBe('1024x1024');
  });

  it('should remove resolution', async () => {
    service.removeResolution.mockResolvedValue({ id: 'r1' });
    await controller.removeResolution('r1');
    expect(service.removeResolution).toHaveBeenCalledWith('r1');
  });

  it('should add duration to model', async () => {
    service.addDuration.mockResolvedValue({ id: 'd1', label: '15s', seconds: 15 });
    const result = await controller.addDuration('m1', { label: '15s', seconds: 15 });
    expect(result.seconds).toBe(15);
  });

  it('should remove duration', async () => {
    service.removeDuration.mockResolvedValue({ id: 'd1' });
    await controller.removeDuration('d1');
    expect(service.removeDuration).toHaveBeenCalledWith('d1');
  });
});
