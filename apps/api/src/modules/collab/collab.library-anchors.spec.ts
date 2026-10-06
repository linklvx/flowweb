// apps/api/src/modules/collab/collab.library-anchors.spec.ts
// 库行为锚（实际集合 A1/A5/A6/A7/A8/A9）——测库不测我们的包装（v2.2 修订：gateway.hooks 事后覆盖
// 对库无效——Server 构造时捕获闭包引用；库锚一律独立最小 Server 直挂钩子）。
import { describe, it, expect, vi } from 'vitest';
import { Server, shouldSkipStoreHooks } from '@hocuspocus/server';
import * as Y from 'yjs';
import { pollUntil } from '../../test-utils/poll-until';
import { startDualClientServer } from '../../test-utils/dual-client-server';

describe('A7 pendingStructs 边界（确定性构造，纯 yjs）', () => {
  it('A7b 超前行（diffUpdate 子集）→ pendingStructs 非 null', () => {
    const a = new Y.Doc(); a.getMap('nodes').set('k', new Y.Map([['x', 1]]));
    const svA = Y.encodeStateVector(a);
    a.getMap('nodes').set('m', new Y.Map([['x', 2]]));              // 同 doc 后写（clock 超前 svA）
    const laterOnly = Y.diffUpdate(Y.encodeStateAsUpdate(a), svA);  // 只含后写 struct（实测 27B 级）
    const c = new Y.Doc();                                          // 空 doc：无前置 struct
    Y.applyUpdate(c, laterOnly);
    expect(c.store.pendingStructs).not.toBeNull();                  // 产生 pending
  });
  it('A7a 整行缺失（只 apply 半组行）→ pendingStructs 为 null 且内容缺失（读侧守卫推迟 Y1c-1 的实证依据）', () => {
    const d1 = new Y.Doc(); d1.getMap('nodes').set('n1', new Y.Map([['x', 1]]));
    const d2 = new Y.Doc(); d2.getMap('nodes').set('n2', new Y.Map([['x', 2]]));
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(d2));                    // 只给后半（d1 整行缺失）
    expect(c.store.pendingStructs).toBeNull();                      // 整行缺失不可探测
    expect(c.getMap('nodes').has('n1')).toBe(false);                // 但内容确实缺——守卫盲区实证
  });
});

describe('A8 store 跳过判据（公开导出，禁手写等价物）', () => {
  it('withDoc 路径（source=local 无 skipStoreHooks）必触发 store；connection 源不跳过', () => {
    expect(shouldSkipStoreHooks({ source: 'local' } as any)).toBe(false);
    expect(shouldSkipStoreHooks({ source: 'connection' } as any)).toBe(false);
  });
});

describe('A1/A5/A6（独立最小 Server——库直挂钩子）', () => {
  it('A1+A5：store 钩子抛错→doc 留内存且库不再自动重试（debounce 不重武装）', async () => {
    let calls = 0;
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { calls++; throw new Error('boom'); },
    });
    await server.listen();
    try {
      const name = 'p-anchor-a1';
      const conn = await server.hocuspocus.openDirectConnection(name);   // 直连入口在 Hocuspocus 实例（Server 不透传——生产 withDoc 同形 collab-document.service.ts:17）
      await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await conn.disconnect();                          // 触发 store→失败（失败也卸载——A6 面）
      await pollUntil(() => calls >= 1, 3_000);
      const settled = calls;
      await new Promise((r) => setTimeout(r, 1_000));    // >5×debounce：失败不重武装则 calls 不增
      expect(calls).toBe(settled);                       // A5：库不自动重试——gateway 自管退避是唯一重试源
    } finally {
      await server.destroy();
    }
  });

  it('A6：DirectConnection 断开后（store 失败被吞）doc 仍被卸载——失败也卸载语义（spool 承重性）', async () => {
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { throw new Error('boom'); },
    });
    await server.listen();
    try {
      const name = 'p-anchor-a6';
      const conn = await server.hocuspocus.openDirectConnection(name);   // 同 A1：直连入口在 Hocuspocus 实例
      await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await conn.disconnect();
      await pollUntil(
        () => !server.hocuspocus.documents.has(name), 5_000,
      );                                                // A6：卸载发生（与 A1 的 WS 路径"不卸载"相反——两路径分立断言）
      expect(server.hocuspocus.documents.has(name)).toBe(false);
    } finally {
      await server.destroy();
    }
  });
});

describe('A9 最后连接关闭→脏 doc 销毁（WS 路径·失败态——spool 承重性锚）', () => {
  it('append 持续失败下 provider 断开：store 已失败后最后一连关闭仍卸载（else 分支不问 store 成败——A2 四条件实证）', async () => {
    const appendFail = vi.fn(async () => { throw new Error('boom'); });
    const kit = await startDualClientServer({ append: appendFail }, 200);
    try {
      const name = 'project:p-anchor-a9';
      const { provider, synced } = kit.connect(name);
      await synced;
      provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
      await pollUntil(() => kit.gateway.server.hocuspocus.documents.get(name)?.getMap('nodes').has('n') === true, 5_000);  // 写已达服务端（destroy 前确认——防"update 未达即断开"的通过无意义竞态）
      // 探针修正（v1 断言红+stderr 实证）：debounce 在途时断连走 executeNow 分支（hocuspocus-server.esm.js:1384-1385），
      // store 失败被库吞（"Document stays in memory to avoid data loss" :1547）→ doc 不卸载（A1 的 WS 面——
      // 此时唯一恢复源是 gateway 自管退避）。本锚改锚分立的 else 分支（:1386）：等库侧 debounce 完成
      // （isDebounced/isCurrentlyExecuting 双 false——onClose 分支判据的直读形态）再断开。
      const debouncer = (kit.gateway.server.hocuspocus as any).debouncer;
      const debounceId = `onStoreDocument-${name}`;
      await pollUntil(() => !debouncer.isDebounced(debounceId) && !debouncer.isCurrentlyExecuting(debounceId), 5_000);
      expect(appendFail.mock.calls.length).toBeGreaterThanOrEqual(1);   // store 确已失败过（防"未触发即断开"的通过无意义竞态）
      await provider.destroy();
      await pollUntil(() => !kit.gateway.server.hocuspocus.documents.has(name), 8_000);   // A2 四条件不含"store 成功"
      expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(false);
    } finally {
      await kit.dispose();
    }
  }, 20_000);
});
