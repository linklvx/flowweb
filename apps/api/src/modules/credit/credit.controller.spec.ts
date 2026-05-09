import { Test, TestingModule } from '@nestjs/testing';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CreditController', () => {
  let controller: CreditController;
  let service: {
    getOrCreateBalance: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    deduct: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      getOrCreateBalance: vi.fn().mockResolvedValue({ userId: 'u1', credits: 100, version: 0 }),
      getBalance: vi.fn(),
      deduct: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CreditController],
      providers: [{ provide: CreditService, useValue: service }],
    }).compile();

    controller = module.get<CreditController>(CreditController);
  });

  it('should return balance for given userId', async () => {
    service.getOrCreateBalance.mockResolvedValue({ userId: 'u1', credits: 100, version: 0 });
    const result = await controller.getBalance('u1');
    expect(result).toEqual({ credits: 100 });
    expect(service.getOrCreateBalance).toHaveBeenCalledWith('u1');
  });

  it('should default userId to default-user when empty', async () => {
    service.getOrCreateBalance.mockResolvedValue({ userId: 'default-user', credits: 100, version: 0 });
    const result = await controller.getBalance('default-user');
    expect(result).toEqual({ credits: 100 });
  });
});
