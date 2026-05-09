import { Test, TestingModule } from '@nestjs/testing';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PricingController', () => {
  let controller: PricingController;
  let service: {
    findAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    batchCreate: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      findAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      batchCreate: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [{ provide: PricingService, useValue: service }],
    }).compile();

    controller = module.get<PricingController>(PricingController);
  });

  it('should list pricing rules with filters', async () => {
    service.findAll.mockResolvedValue([{ id: 'r1', creditCost: 5 }]);
    const result = await controller.findAll('nt1', 'm1');
    expect(result).toHaveLength(1);
    expect(service.findAll).toHaveBeenCalledWith({ nodeTypeId: 'nt1', modelId: 'm1' });
  });

  it('should create a pricing rule', async () => {
    const dto = { nodeTypeId: 'nt1', modelId: 'm1', resolutionId: 'r1', creditCost: 5 };
    service.create.mockResolvedValue({ id: 'r1', ...dto });
    const result = await controller.create(dto);
    expect(result.id).toBe('r1');
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('should update a pricing rule', async () => {
    service.update.mockResolvedValue({ id: 'r1', creditCost: 10 });
    const result = await controller.update('r1', { creditCost: 10 });
    expect(result.creditCost).toBe(10);
    expect(service.update).toHaveBeenCalledWith('r1', { creditCost: 10 });
  });

  it('should delete a pricing rule', async () => {
    service.delete.mockResolvedValue({ id: 'r1' });
    await controller.delete('r1');
    expect(service.delete).toHaveBeenCalledWith('r1');
  });

  it('should batch upsert pricing rules', async () => {
    const rules = [{ nodeTypeId: 'nt1', modelId: 'm1', creditCost: 8 }];
    service.batchCreate.mockResolvedValue([{ id: 'r1', creditCost: 8 }]);
    const result = await controller.batchCreate({ rules });
    expect(result).toHaveLength(1);
    expect(service.batchCreate).toHaveBeenCalledWith(rules);
  });
});
