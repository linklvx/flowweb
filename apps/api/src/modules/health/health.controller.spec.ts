import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('HealthController', () => {
  let controller: HealthController;
  let service: { check: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { check: vi.fn().mockResolvedValue({ status: 'ok', db: true, timestamp: '2024-01-01' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: service }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return health status', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe(true);
  });
});
