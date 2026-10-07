import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabGateway } from './collab.gateway';
import { CollabLeaseService } from './collab-lease.service';
import { CollabSpoolService } from './collab-spool.service';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CollabGateway 多实例配置', () => {
  let gateway: CollabGateway;

  afterEach(async () => {
    // T5 后无 Redis extension（ioredis 句柄面随之消失）；destroy 只收 Server 资源
    await gateway.server.destroy();
  });

  it('Y0a-3 T5：Redis extension 挂载删除（单写者=PG 租约 fence，跨实例消息同步退役——T6 删 service 本体）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CollabGateway,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: { on: vi.fn() } },
        { provide: CanvasDocUpdateRepository, useValue: {} },
        { provide: CollabLeaseService, useValue: createLeaseStub() },
        { provide: CollabSpoolService, useValue: new CollabSpoolService(join(tmpdir(), 'y0a3-mi-spool')) },
        { provide: 'COLLAB_PORT', useValue: 3101 },
      ],
    }).compile();
    gateway = mod.get(CollabGateway);
    const names = ((gateway.server as any).configuration.extensions ?? []).map((e: any) => e.constructor.name);
    expect(names).not.toContain('Redis');
  });
});
