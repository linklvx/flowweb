import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import { PrismaService } from '../../prisma/prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = { $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should return ok when DB is healthy', async () => {
    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe(true);
  });

  it('should return db: false when DB query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await service.check();
    expect(result.db).toBe(false);
  });
});
