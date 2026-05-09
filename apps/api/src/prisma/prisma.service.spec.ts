import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from './prisma.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    vi.spyOn(PrismaService.prototype, '$connect').mockResolvedValue();
    vi.spyOn(PrismaService.prototype, '$disconnect').mockResolvedValue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should connect on module init', async () => {
    // If no error thrown, service instantiated correctly
    await expect(service.onModuleInit()).resolves.not.toThrow();
  });
});
