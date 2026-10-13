import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

  it('Y0b-5 T14（E44 职责维持）：/api/health 不引 Collab 模块（liveness+db 极简面）——degraded 块挂 /api/ready token 档非 health（静态源扫描锚）', async () => {
    // vitest cwd=包根（apps/api）——三文件全扫：controller/service/module 任一处引入 collab 即红
    for (const f of ['health.controller.ts', 'health.service.ts', 'health.module.ts']) {
      const src = await readFile(path.join('src/modules/health', f), 'utf8');
      expect(src).not.toMatch(/collab/i);
    }
  });
});
