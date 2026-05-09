import { Test, TestingModule } from '@nestjs/testing';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PublicController', () => {
  let controller: PublicController;
  let service: {
    getModelsByNodeKey: ReturnType<typeof vi.fn>;
    calculatePrice: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getModelsByNodeKey: vi.fn(),
      calculatePrice: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [{ provide: PublicService, useValue: service }],
    }).compile();

    controller = module.get<PublicController>(PublicController);
  });

  it('should get models by node type key', async () => {
    const models = [{ id: 'm1', name: 'SD XL' }];
    service.getModelsByNodeKey.mockResolvedValue(models);
    const result = await controller.getModels('image');
    expect(result).toEqual(models);
    expect(service.getModelsByNodeKey).toHaveBeenCalledWith('image');
  });

  it('should calculate price with modelId only', async () => {
    service.calculatePrice.mockResolvedValue(5);
    const result = await controller.calculate('m1');
    expect(result).toBe(5);
    expect(service.calculatePrice).toHaveBeenCalledWith('m1', undefined, undefined);
  });

  it('should calculate price with modelId and resolutionId', async () => {
    service.calculatePrice.mockResolvedValue(8);
    const result = await controller.calculate('m1', 'r1');
    expect(result).toBe(8);
    expect(service.calculatePrice).toHaveBeenCalledWith('m1', 'r1', undefined);
  });

  it('should calculate price with all params', async () => {
    service.calculatePrice.mockResolvedValue(12);
    const result = await controller.calculate('m1', 'r1', 'd1');
    expect(result).toBe(12);
    expect(service.calculatePrice).toHaveBeenCalledWith('m1', 'r1', 'd1');
  });
});
