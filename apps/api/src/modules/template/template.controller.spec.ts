import { Test, TestingModule } from '@nestjs/testing';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TemplateController', () => {
  let controller: TemplateController;
  let service: {
    findMany: ReturnType<typeof vi.fn>;
    getTemplate: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    import: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      findMany: vi.fn().mockResolvedValue({ templates: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
      getTemplate: vi.fn().mockResolvedValue({ id: 't1', name: 'Test', isOwner: true }),
      update: vi.fn().mockResolvedValue({ id: 't1', name: 'Updated' }),
      delete: vi.fn().mockResolvedValue({ success: true }),
      import: vi.fn().mockResolvedValue({ id: 'p2', name: 'Test (副本)' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplateController],
      providers: [{ provide: TemplateService, useValue: service }],
    }).compile();
    controller = module.get<TemplateController>(TemplateController);
  });

  it('GET /templates calls service.findMany', async () => {
    const req = { user: { id: 'u1' } } as any;
    const query = { type: 'community', page: 1 } as any;
    const result = await controller.getTemplates(query, req);
    expect(service.findMany).toHaveBeenCalledWith(query, 'u1');
    expect(result.success).toBe(true);
  });

  it('GET /templates/:id calls service.getTemplate', async () => {
    const req = { user: { id: 'u1' } } as any;
    const result = await controller.getTemplate('t1', req);
    expect(service.getTemplate).toHaveBeenCalledWith('t1', 'u1');
    expect(result.success).toBe(true);
  });

  it('PATCH /templates/:id calls service.update', async () => {
    const req = { user: { id: 'u1' } } as any;
    await controller.update('t1', { name: 'New' }, req);
    expect(service.update).toHaveBeenCalledWith('t1', { name: 'New' }, 'u1');
  });

  it('DELETE /templates/:id calls service.delete', async () => {
    const req = { user: { id: 'u1' } } as any;
    await controller.delete('t1', req);
    expect(service.delete).toHaveBeenCalledWith('t1', 'u1');
  });

  it('POST /templates/:id/import calls service.import', async () => {
    const req = { user: { id: 'u1' } } as any;
    const result = await controller.import('t1', req);
    expect(service.import).toHaveBeenCalledWith('t1', 'u1');
    expect(result.success).toBe(true);
  });

  it('endpoints return UNAUTHORIZED when no user', async () => {
    const req = {} as any;
    const result = await controller.update('t1', { name: 'New' }, req);
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('UNAUTHORIZED');
  });
});
