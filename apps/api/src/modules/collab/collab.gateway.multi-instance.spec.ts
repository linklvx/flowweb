// Y0a-3（spec §3.1/§6.1 G-3）：原"跨实例扩展挂载"断言随 extension 依赖删除整删——
// 本 spec 改写为**租约 fail-fast**：第二实例（未持租约）结构性无法接流（不 listen/WS 拒/直连拒）。
// 单实例拓扑钉死后"多实例"的正名=第二实例的**拒绝面**验证（E23：冗余组件判据升无用途）。
// N15 真相：单主机双实例同端口本就 EADDRINUSE 先于租约——租约的真实价值=TTL 崩溃接管/跨主机/
// 误配快速失败；演练（随机端口）是这套机制唯一的验证场。
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { createLeaseStub } from './test-utils/lease-stub';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { CollabAuthReason } from '@flowweb/shared';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CollabGateway 租约 fail-fast（第二实例结构性无法接流——G-3）', () => {
  let dir: { dir: string; cleanup: () => Promise<void> };
  let gateway: CollabGateway;
  beforeEach(async () => {
    dir = await makeSpoolDir('y0a3-mi-');
    gateway = new CollabGateway({} as any, new EventEmitter2() as any, createMockRepo() as any,
      createLeaseStub({ isServing: vi.fn(() => false), tryAcquireFast: vi.fn(async () => false) }) as any,   // 第二实例：租约被占
      { resolve: vi.fn() } as any, 48200, 300, undefined, undefined, new CollabSpoolService(dir.dir));
  });
  afterEach(async () => {
    await gateway.server.destroy();
    await dir.cleanup();
  });

  it('不 listen：onModuleInit 完成但 Server.listen 未调用（E35 三入口之首）', async () => {
    const listenSpy = vi.spyOn(gateway.server, 'listen').mockImplementation(async () => undefined as any);
    try {
      await gateway.onModuleInit();
      expect(listenSpy).not.toHaveBeenCalled();
    } finally { listenSpy.mockRestore(); }
  });

  it('WS 升级拒绝：authenticate 抛 lease-not-ready（瞬态档——客户端重连而非终态）', async () => {
    await expect(gateway.hooks.onAuthenticate({
      requestHeaders: new Headers(), requestParameters: new URLSearchParams('?token=tok'),
      documentName: 'project:p1', connectionConfig: {},
    } as any)).rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
  });

  it('直连路径拒：loadDocument 权威点抛（DirectConnection 绕过 authenticate 的兜底）', async () => {
    await expect(gateway.hooks.onLoadDocument({ document: new Y.Doc(), documentName: 'project:p1' } as any))
      .rejects.toMatchObject({ reason: CollabAuthReason.LEASE_NOT_READY });
  });
});
