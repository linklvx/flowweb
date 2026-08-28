import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabGateway } from './collab.gateway';
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('CollabGateway 多实例配置', () => {
  let gateway: CollabGateway;

  afterEach(async () => {
    // Redis extension 构造即建 ioredis 连接，销毁以防句柄泄漏
    await gateway.server.destroy();
  });

  it('Redis extension 挂载（REDIS_URL 传入）', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        CollabGateway,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: { on: vi.fn() } },
        { provide: CanvasDocUpdateRepository, useValue: {} },
        { provide: 'COLLAB_PORT', useValue: 3101 },
      ],
    }).compile();
    gateway = mod.get(CollabGateway);
    const names = (gateway.server as any).configuration.extensions.map((e: any) => e.constructor.name);
    expect(names).toContain('Redis');
  });
});
