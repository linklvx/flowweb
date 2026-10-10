// apps/api/src/modules/collab/collab-gateway.options.spec.ts
// Y0b-3 T1：Server 构造四 pin——pre-auth 库配置三 pin（§3.1bis）+websocketOptions maxPayload（§7.2）。
// 形态：直构 gateway 读回 server.configuration（collab.gateway.env.spec 先例——库构造 spread 保留
// 全部传入键；无 vi.mock，配置面即构造入参的真实读回）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let spoolDir: string;
let spoolCleanup: () => Promise<void> = async () => {};
beforeEach(async () => {
  const d = await makeSpoolDir('y0b3-options-');
  spoolDir = d.dir;
  spoolCleanup = d.cleanup;
});
afterEach(async () => spoolCleanup());

function buildGateway(): CollabGateway {
  return new CollabGateway(
    {} as any, new EventEmitter2() as any, {} as any, createLeaseStub() as any,
    { resolve: vi.fn() } as any,
    48000 + Math.floor(Math.random() * 4000),
    undefined, undefined, undefined, new CollabSpoolService(spoolDir),
  );
}

describe('Y0b-3 T1：Server 构造 pin', () => {
  it('pre-auth 库配置三 pin+maxPayload 显式在位（断言构造入参读回）', () => {
    const ctor = buildGateway().server.configuration;
    expect(ctor.websocketOptions).toEqual({ maxPayload: 16 * 1024 * 1024 });   // §7.2 禁回落 ws 默认 100MiB
    expect(ctor.maxUnauthenticatedQueueMessages).toBe(256);   // 库默认 1e3 → 未 pin 即红
    expect(ctor.maxUnauthenticatedQueueSize).toBe(1024 * 1024);   // 库默认 5MiB → 未 pin 即红
    expect(ctor.maxPendingDocuments).toBe(100);   // 库默认即 100——文档锚防升级翻转（P24 先例）
  });

  it('websocketOptions 键集 ⊆ {maxPayload}（防未来塞 noServer/handleProtocols 覆盖 crossws 强制项砸 upgrade 路径）', () => {
    const ctor = buildGateway().server.configuration;
    expect(Object.keys(ctor.websocketOptions ?? {}).every((k) => k === 'maxPayload')).toBe(true);
  });
});
