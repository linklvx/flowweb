// apps/api/src/modules/collab/collab.library-anchors.spec.ts
// 库行为锚（实际集合 A1/A5/A6/A7/A8/A9）——测库不测我们的包装（v2.2 修订：gateway.hooks 事后覆盖
// 对库无效——Server 构造时捕获闭包引用；库锚一律独立最小 Server 直挂钩子）。
import { describe, it, expect, vi } from 'vitest';
import { Server, shouldSkipStoreHooks } from '@hocuspocus/server';
import { SkipFurtherHooksError } from '@hocuspocus/common';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as Y from 'yjs';
import { pollUntil } from '../../test-utils/poll-until';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { register } from 'prom-client';

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
  it('A5：store 钩子抛错→库不再自动重试（失败不重武装 debounce——gateway 自管退避是唯一重试源；"doc 留内存"仅 WS 断连面成立，A9 注释有分立实证）', async () => {
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
      kit.forget(provider);   // 自管 destroy 后移出 dispose 数组——防双 destroy（flaky 源，惯例同 gateway.spec:262）
      await pollUntil(() => !kit.gateway.server.hocuspocus.documents.has(name), 8_000);   // A2 四条件不含"store 成功"
      expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(false);
    } finally {
      await kit.dispose();
    }
  }, 20_000);
});

describe('A14 store 钩子锁形态（v2：结论已实测写死——探针降级为回归断言，防升级漂移）', () => {
  it('A14 store 钩子在 saveMutex 内执行（esm:1536-1539——onStore/afterStore 同包 saveMutex.runExclusive；重入加锁=死锁防线）', async () => {
    const order: string[] = [];
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 50, maxDebounce: 80,
      onStoreDocument: async ({ document }) => { order.push('hook'); expect(document.saveMutex.isLocked()).toBe(true); },
    });
    await server.listen();
    try {
      const conn = await server.hocuspocus.openDirectConnection('p-mutex');   // 直连入口在 Hocuspocus 实例（Server 不透传——A5 同款）
      await conn.transact((doc) => { doc.getMap('nodes').set('n', new Y.Map()); });
      await conn.disconnect();
      await pollUntil(() => order.length >= 1, 3_000);
      expect(order).toContain('hook');   // 断言实质：钩子被调且 isLocked 通过（钩子体内 expect 已红则本轮不会到达）
    } finally { await server.destroy(); }
  });
});

// ══ Z80/Z94 库行为锚 4 枚（Y0c C0/T5）══
// Z59 常驻化机制基石的测试化钉死：持有 DirectConnection ⇒ directConnectionsCount≥1 ⇒ getConnectionsCount≥1
// ⇒ shouldUnloadDocument 恒 false ⇒ 库全部卸载入口静默 no-op。行号引证=4.6.0 安装态实测
// （hocuspocus-server.esm.js；spec Z59 立项快照 :1550/:1541/:1385 对应实测 :1551/:1543/:1386——
// Z95 纪律：行号是立项快照非执行锚，断言以语义/结构定位，漂移由正例②源码锚+check-hocuspocus-pin 兜底）。
describe('Z80 正例① 持有 direct ⇒ 谓词恒 false ⇒ 4 入口 no-op（Z59 机制测试化）', () => {
  it('入口① store 完成后的卸载判定（esm:1550-1552 setTimeout 谓词守卫）：store 跑完不卸载', async () => {
    let calls = 0;
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { calls++; },
    });
    await server.listen();
    const name = 'p-anchor-z80-store';
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      const doc = server.hocuspocus.documents.get(name)!;
      await conn.transact((d) => { d.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await pollUntil(() => calls >= 1, 3_000);   // store 确已跑（防「未触发即断言」的通过无意义竞态——A9 同款）
      const debouncer = (server.hocuspocus as any).debouncer;
      await pollUntil(                            // debounce/在飞/saveMutex 全 settle——卸载判定前置全清（A9 判据直读形态）
        () => !debouncer.isDebounced(`onStoreDocument-${name}`) && !debouncer.isCurrentlyExecuting(`onStoreDocument-${name}`) && !doc.saveMutex.isLocked(),
        3_000,
      );
      await new Promise((r) => setTimeout(r, 100));   // >setTimeout(0)：完成分支的卸载判定必已跑
      expect(calls).toBe(1);
      expect(server.hocuspocus.shouldUnloadDocument(doc)).toBe(false);   // 机制面：count=1 ⇒ 谓词恒 false
      expect(server.hocuspocus.documents.has(name)).toBe(true);          // Z59 入口①：store 完成 setTimeout 判定被持有钉住=no-op
    } finally { await conn.disconnect(); await server.destroy(); }
  }, 10_000);

  it('入口② SkipFurtherHooksError 分支（esm:1541-1545 setTimeout 谓词守卫）：钩子抛 SkipFurtherHooksError 不卸载', async () => {
    let calls = 0;
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { calls++; throw new SkipFurtherHooksError(); },
    });
    await server.listen();
    const name = 'p-anchor-z80-skip';
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      await conn.transact((d) => { d.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await pollUntil(() => calls >= 1, 3_000);   // 钩子确已跑（防空转通过）
      const debouncer = (server.hocuspocus as any).debouncer;
      await pollUntil(() => !debouncer.isDebounced(`onStoreDocument-${name}`) && !debouncer.isCurrentlyExecuting(`onStoreDocument-${name}`), 3_000);
      await new Promise((r) => setTimeout(r, 100));   // >setTimeout(0)：SkipFurtherHooks 分支的卸载判定必已跑
      expect(server.hocuspocus.documents.has(name)).toBe(true);   // Z59 入口②：跳链分支 setTimeout 判定被持有钉住=no-op
    } finally { await conn.disconnect(); await server.destroy(); }
  }, 10_000);

  it('入口③ WS 关页 onClose（esm:1382-1387 首行计数早退 :1383）：direct 持有下 provider 断开不卸载', async () => {
    const kit = await startDualClientServer({}, 200);
    const name = 'project:p-anchor-z80-ws';
    const conn = await kit.gateway.server.hocuspocus.openDirectConnection(name);   // 先持有 direct（生产 withDoc 同入口 collab-document.service.ts:69）
    try {
      const { provider, synced } = kit.connect(name);
      await synced;
      provider.document.getMap('nodes').set('n', new Y.Map([['x', 1]]));
      await pollUntil(() => kit.gateway.server.hocuspocus.documents.get(name)?.getMap('nodes').has('n') === true, 5_000);   // 写已达服务端（A9 同款防通过无意义竞态）
      provider.destroy();
      kit.forget(provider);   // WS 关页→onClose：:1383 计数含 direct=1 ⇒ 早退（Z59 入口③）
      const debouncer = (kit.gateway.server.hocuspocus as any).debouncer;
      await pollUntil(() => !debouncer.isDebounced(`onStoreDocument-${name}`) && !debouncer.isCurrentlyExecuting(`onStoreDocument-${name}`), 8_000);   // 与「断连在 debounce 在途」两机制分离（A9 探针修正同款）
      await new Promise((r) => setTimeout(r, 100));   // store 完成分支 setTimeout(0) 必已跑
      expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(true);   // Z59 入口③：:1383 计数含 direct=1 ⇒ 早退不卸载
    } finally {
      await conn.disconnect();   // 清理释放：direct 持有下 server.destroy 永不 settle（Z81 runDestroy 等 documents 归零）
      await kit.dispose();
    }
  }, 20_000);

  it('入口④ direct disconnect（esm:1145-1174 :1160 计数守卫）：双 direct 断开其一不卸载', async () => {
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { /* 默认成功 */ },
    });
    await server.listen();
    const name = 'p-anchor-z80-direct';
    const connA = await server.hocuspocus.openDirectConnection(name);
    const connB = await server.hocuspocus.openDirectConnection(name);   // 同名复用同 doc（esm:1432-1433）⇒ count=2
    try {
      const doc = server.hocuspocus.documents.get(name)!;
      expect(doc.getConnectionsCount()).toBe(2);
      await connA.transact((d) => { d.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      await connB.disconnect({ unloadImmediately: true });   // 断开 B：:1160 count=1≠0 ⇒ 跳过 onDisconnect+unload 块
      expect(server.hocuspocus.documents.has(name)).toBe(true);   // Z59 入口④：其余 direct 钉住 doc 不卸载
      await connA.transact((d) => { d.getMap('nodes').set('m', new Y.Map([['x', 2]])); });   // A 仍可用（钉住的是活连接非僵尸）
      await pollUntil(() => {   // B 断开触发的 store 走完——setTimeout 判定同样被 A 钉住
        const debouncer = (server.hocuspocus as any).debouncer;
        return !debouncer.isDebounced(`onStoreDocument-${name}`) && !debouncer.isCurrentlyExecuting(`onStoreDocument-${name}`);
      }, 3_000);
      await new Promise((r) => setTimeout(r, 100));
      expect(server.hocuspocus.documents.has(name)).toBe(true);   // 对照锚：A 仍钉住（与探针红方向相反——真钉住证据）
    } finally { await connA.disconnect(); await server.destroy(); }
  }, 10_000);
});

describe('Z80 正例② 谓词=唯一卸载决策者（源码级结构锚——unloadDocument 双校验 esm:1576/:1589）', () => {
  it('全库卸载调用点全部汇入 unloadDocument 的谓词双校验（升级结构漂移即红——Z18/Z123 锚清单成员）', () => {
    // 读安装态 dist 源码做结构断言（路径解析：createRequire 基座=包根 package.json——vitest cwd=包根惯例；
    // require 条件→cjs 入口→同目录 esm 构建=Z59 行号引证的同源文本）
    const serverCjs = createRequire(path.join(process.cwd(), 'package.json')).resolve('@hocuspocus/server');
    const src = readFileSync(serverCjs.replace(/hocuspocus-server\.cjs$/, 'hocuspocus-server.esm.js'), 'utf8');
    // ① 谓词体单源（esm:1571-1573）：debouncer 二态+saveMutex+连接计数四态一行定真假——外部无第二决策点
    expect(src).toContain("shouldUnloadDocument(document) {\n\t\treturn (this.debouncer.isDebounced(`onStoreDocument-${document.name}`) || this.debouncer.isCurrentlyExecuting(`onStoreDocument-${document.name}`) || document.saveMutex.isLocked()) === false && document.getConnectionsCount() === 0;");
    // ② 全库卸载调用点 census：this.unloadDocument 恰 4 处（Z59 四入口中的三处 :1386/:1543/:1551
    // +装载失败清理 :1483——Z59 快照口径 4 入口未含 :1483）+ direct 断开 this.instance.unloadDocument 1 处（:1171）=5 处全汇入
    expect((src.match(/this\.unloadDocument\(/g) ?? []).length).toBe(4);
    expect((src.match(/this\.instance\.unloadDocument\(/g) ?? []).length).toBe(1);
    // ③ unloadDocument 双校验：首道守卫先于 unloading 判定（:1576）、第二道守卫先于 documents.delete（:1589）
    const body = src.match(/async unloadDocument\(document\) \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
    const guards = [...body.matchAll(/if \(!this\.shouldUnloadDocument\(document\)\) return;/g)];
    expect(guards.length).toBe(2);   // esm:1576/:1589 双校验——调用点判定之后 unloadDocument 内再验两次
    expect(body.indexOf('this.unloadingDocuments.has')).toBeGreaterThan(guards[0]!.index!);
    expect(body.indexOf('this.documents.delete(')).toBeGreaterThan(guards[guards.length - 1]!.index!);
  });
});

describe('Z80 反例① 释放确实能卸载（disconnect({unloadImmediately:true})——钉住是持有期语义非永久）', () => {
  it('释放后 documents 不再含该 doc 且谓词翻真（与正例①互为单变量对照）', async () => {
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { /* 默认成功 */ },
    });
    await server.listen();
    const name = 'p-anchor-z80-release';
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      const doc = server.hocuspocus.documents.get(name)!;
      await conn.transact((d) => { d.getMap('nodes').set('n', new Y.Map([['x', 1]])); });
      expect(server.hocuspocus.shouldUnloadDocument(doc)).toBe(false);   // 持有期：谓词 false（正例①机制面）
      await conn.disconnect({ unloadImmediately: true });
      await pollUntil(() => !server.hocuspocus.documents.has(name), 5_000);
      expect(server.hocuspocus.documents.has(name)).toBe(false);          // 反例①：释放确实能卸载——documents Map 不再含
      expect(server.hocuspocus.shouldUnloadDocument(doc)).toBe(true);     // 谓词翻真（单变量对照——钉住解除）
    } finally { await server.destroy(); }
  }, 10_000);
});

// ══ Z64 两子窗口（Y0c T19——卸载管线竞态拆两窗口的确定性构造）══
// 装置裁决（元纪律⑤：先盘点再选形态）：窗口本质=库 unloadDocument 内部时序（:1576 首守卫→:1581
// beforeUnloadDocument 钩子窗→:1589 二次校验→:1590 documents.delete），真库可达且可经库公开配置面
// （beforeUnloadDocument 钩子）deferred 门控确定性构造 ⇒ 选真库行为锚（本文件 Z80/Z94 同款 bare
// Server 装置）。fake fixture（residency/reaper spec）的 disconnect 复刻止步于「count===0→持久化+
// 删键」终态，无窗口中间态可表达；正例②源码结构锚只锚守卫结构不锚窗口行为。
// 「写到达⇒等待」的会话层串行化（acquire 遇 releasing 有限等待）由 T15 Z83 用例承载——两用例分工：
// 本组锚库层窗口语义（:1589 二次校验/B 窗口新装载），T15 锚应用层会话表协议。
describe('Z64 用例①（A 窗口：卸载已决定、documents 未删——:1576 过 :1590 前）：写到达⇒:1589 二次校验因会话持有返回', () => {
  it('窗口内新 direct 写到达 ⇒ doc 存活+flush 已提交+无第二实例（卸载被取消——:1589 count>0 ⇒ 谓词 false ⇒ return）', async () => {
    const deferred = <T = void>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
    const gate = deferred<void>();
    let beforeUnloadEntered = false;
    let storeCalls = 0;
    const persisted = new Map<string, Uint8Array>();
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async ({ document }) => { storeCalls += 1; persisted.set(document.name, Y.encodeStateAsUpdate(document)); },
      beforeUnloadDocument: async () => { beforeUnloadEntered = true; await gate.promise; },   // 窗口门：钩子 await 挂起=停在 :1581→:1589 之间
    });
    await server.listen();
    const name = 'p-z64-a';
    const conn1 = await server.hocuspocus.openDirectConnection(name);
    const doc1 = server.hocuspocus.documents.get(name)!;
    let conn2: Awaited<ReturnType<typeof server.hocuspocus.openDirectConnection>> | null = null;
    try {
      await conn1.transact((d) => { d.getMap('nodes').set('k1', new Y.Map([['x', 1]])); });
      const dis = conn1.disconnect({ unloadImmediately: true });   // 卸载管线开跑（不 await——store 先行 :1149 后 :1171 进 unloadDocument）
      await pollUntil(() => beforeUnloadEntered, 3_000);            // A 窗口开门：:1576 首守卫已过（卸载已决定）/flush 已提交（store await 先于钩子）/documents 未删（:1590 未达）
      expect(server.hocuspocus.unloadingDocuments.has(name)).toBe(true);   // 窗口内公开实例字段直读（esm:1598 置入——Z64 守卫读面）
      expect(storeCalls).toBeGreaterThanOrEqual(1);

      conn2 = await server.hocuspocus.openDirectConnection(name);   // 写到达（窗口内新 direct）：documents.has 命中⇒复用同实例（count 0→1）
      expect(server.hocuspocus.documents.get(name)).toBe(doc1);     // 无第二实例
      await conn2.transact((d) => { d.getMap('nodes').set('k2', new Y.Map([['x', 2]])); });

      gate.resolve();                                               // 关窗：:1589 二次校验——count=1 ⇒ shouldUnloadDocument false ⇒ return（卸载被取消）
      await dis;                                                    // disconnect 收敛（未走 :1590 删键）
      expect(server.hocuspocus.documents.has(name)).toBe(true);     // doc 存活
      const probe = new Y.Doc();
      Y.applyUpdate(probe, persisted.get(name)!);                   // flush 内容可读（k1 已提交——store #1 先于窗口开门）
      expect(probe.getMap('nodes').has('k1')).toBe(true);
    } finally {
      gate.resolve();                                               // 幂等释门（断言早退防卸载管线永挂=destroy 永不 settle）
      try { await conn2?.disconnect({ unloadImmediately: true }); } catch { /* 清理面吞错 */ }
      await server.destroy();
    }
  }, 10_000);
});

describe('Z64 用例②（B 窗口：:1590 已删/:1591 已 destroy）：写到达⇒新装载自 PG+旧 store 提交后 CRDT 合并可见', () => {
  it('真卸载终态后新 direct ⇒ 新实例装载+旧 store 提交的 k1 经 PG 重放可见+unloadingDocuments 已清（守卫读面公开字段——503 瞬态守卫已落生产=下方生产守卫组）', async () => {
    const persisted = new Map<string, Uint8Array>();   // mini-PG（onLoadDocument 重放源=旧 store 提交面）
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onLoadDocument: async ({ document }) => { const saved = persisted.get(document.name); if (saved) Y.applyUpdate(document, saved); },
      onStoreDocument: async ({ document }) => { persisted.set(document.name, Y.encodeStateAsUpdate(document)); },
    });
    await server.listen();
    const name = 'p-z64-b';
    try {
      const conn1 = await server.hocuspocus.openDirectConnection(name);
      const doc1 = server.hocuspocus.documents.get(name)!;
      await conn1.transact((d) => { d.getMap('nodes').set('k1', new Y.Map([['x', 1]])); });
      await conn1.disconnect({ unloadImmediately: true });          // 旧 store 提交 k1⇒真卸载（:1590 删键+:1591 destroy）
      await pollUntil(() => !server.hocuspocus.documents.has(name), 5_000);
      expect((doc1 as any).isDestroyed).toBe(true);                 // B 窗口态：已 destroy（:1591——库 Document 自有旗标 :770；yjs 侧无 destroyed 属性）
      expect(server.hocuspocus.unloadingDocuments.has(name)).toBe(false);   // B 窗口态：卸载已了结（esm:1600 清键——常驻化后本字段非空的窗=瞬态，守卫读面）

      const conn2 = await server.hocuspocus.openDirectConnection(name);   // 写到达：documents 无键⇒createDocument 新装载+onLoadDocument 重放
      const doc2 = server.hocuspocus.documents.get(name)!;
      expect(doc2).not.toBe(doc1);                                  // 新实例（旧实例已 destroy）
      expect(doc2.getMap('nodes').has('k1')).toBe(true);             // 旧 store 提交后 CRDT 合并可见（PG 重放）
      await conn2.transact((d) => { d.getMap('nodes').set('k2', new Y.Map([['x', 2]])); });
      expect(doc2.getMap('nodes').has('k2')).toBe(true);             // 新写在装载实例上生效
      await conn2.disconnect({ unloadImmediately: true });
      await pollUntil(() => !server.hocuspocus.documents.has(name), 5_000);
    } finally { await server.destroy(); }
  }, 10_000);
});

// ══ Z64② 生产守卫（Y0c T19 补落——spec §A2 目标形态 5 字面：onLoadDocument 查
// hocuspocus.unloadingDocuments（公开字段 esm:166/:1271）有该 name ⇒ 瞬态 503 让调用方重试；
// 窗口生命周期=库 unloadDocument 内部段 :1598 set→:1600 清键）══ 与上两组分工：①②锚库层窗口
// 语义（bare Server 最小钩子），本组锚 gateway 生产守卫面（真 kit——loadDocument 门列的瞬态门）。
// 装置裁决：守卫唯一可达子窗=「unloadingDocuments 有键 ∧ documents 无键」（库 createDocument 对
// existingDoc 早退不触发 onLoadDocument——A 窗口复用语义用例①已锚）⇒ 门必须挂在 actualUnloadingLogic
// 尾段（:1590 删键之后/:1600 清键之前）——经库公开扩展面 configuration.extensions.push 挂 deferred
// afterUnloadDocument（listen() 推 onListen 同款机制——零 patch 零 fork）。
describe('Z64② 生产守卫（gateway loadDocument——卸载窗口新装载=瞬态 503）', () => {
  it('窗口内新 direct 装载 ⇒ 503 COLLAB_NOT_SERVING(doc-unloading)+yjs_load_unloading_window_total 计数；卸载了结后装载成功（重试可达）——改造前窗口内装载成功=B 窗口第二实例风险面（红锚）', async () => {
    const kit = await startDualClientServer({}, 200);
    const deferred = <T = void>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
    const gate = deferred<void>();
    let afterUnloadEntered = false;
    kit.gateway.server.hocuspocus.configuration.extensions.push({
      afterUnloadDocument: async () => { afterUnloadEntered = true; await gate.promise; },   // 窗口门：钩子链挂起=停在 :1590 之后/:1600 之前
    });
    const name = 'project:p-z64-guard';
    const countOf = async () => {   // 全局单例 register——测试间累积恒用增量（heap-gate spec 同款惯例）
      const metric: any = register.getSingleMetric('yjs_load_unloading_window_total');
      const values = await metric?.get();
      return (values?.values ?? []).reduce((s: number, v: any) => s + v.value, 0);
    };
    let inWindowConn: Awaited<ReturnType<typeof kit.gateway.server.hocuspocus.openDirectConnection>> | null = null;
    try {
      const before = await countOf();
      const conn1 = await kit.gateway.server.hocuspocus.openDirectConnection(name);
      await conn1.transact((d) => { d.getMap('nodes').set('k1', new Y.Map([['x', 1]])); });
      const dis = conn1.disconnect({ unloadImmediately: true });   // store(executeNow)→direct 断开卸载管线开跑（esm:1171）
      await pollUntil(() => afterUnloadEntered, 5_000);            // 窗口开门（扩展链序在 gateway 清账钩子后——链挂起即窗口保持）
      expect(kit.gateway.server.hocuspocus.documents.has(name)).toBe(false);          // 子窗判据①：documents 已删（:1590）
      expect(kit.gateway.server.hocuspocus.unloadingDocuments.has(name)).toBe(true);  // 子窗判据②：清键未达（:1600——守卫读面）

      let err: any = null;   // 窗口内新装载——守卫唯一可达面；改造前=装载成功（第二实例）=红锚
      try { inWindowConn = await kit.gateway.server.hocuspocus.openDirectConnection(name); } catch (e: any) { err = e; }
      expect(err).toBeTruthy();
      expect(err.getStatus?.() ?? err.status).toBe(503);                                // SUE 瞬态档
      expect(JSON.stringify(err.getResponse?.() ?? err.response)).toContain('COLLAB_NOT_SERVING');   // Retry-After filter 判据（body.code——vacuuming 门同款）
      expect(String(err.message)).toMatch(/doc-unloading/);
      expect(await countOf()).toBe(before + 1);                                         // 计数器落档

      gate.resolve();                                               // 关窗：afterUnload 链 settle→await unloading→:1600 清键
      await dis;                                                    // disconnect 收敛
      await pollUntil(() => !kit.gateway.server.hocuspocus.unloadingDocuments.has(name), 5_000);
      const conn2 = await kit.gateway.server.hocuspocus.openDirectConnection(name);   // 卸载了结后装载成功——重试可达语义
      expect(kit.gateway.server.hocuspocus.documents.get(name)).toBeTruthy();
      expect(await countOf()).toBe(before + 1);                      // 成功装载不再计数
      await conn2.disconnect({ unloadImmediately: true });
    } finally {
      gate.resolve();                                               // 幂等释门（断言早退防卸载管线永挂=destroy 永不 settle）
      try { await inWindowConn?.disconnect({ unloadImmediately: true }); } catch { /* 清理面吞错（红相位防泄漏钉住） */ }
      await kit.dispose();
    }
  }, 20_000);
});

describe('Z80 反例② saveMutex 锁定 ⇒ 谓词 false（Z94②——与 Z62 reaper 判据的分工边界）', () => {
  it('无连接+零 debounce 下 saveMutex 单变量锁定即拦住谓词，释放翻真', async () => {
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async () => { /* 默认成功 */ },
    });
    await server.listen();
    const name = 'p-anchor-z80-mutex';
    const conn = await server.hocuspocus.openDirectConnection(name);
    try {
      const doc = server.hocuspocus.documents.get(name)!;
      doc.removeDirectConnection();   // 显式清计数（Z94① 同款公开方法）——隔离出「仅 saveMutex」单变量
      const debouncer = (server.hocuspocus as any).debouncer;
      expect(doc.getConnectionsCount()).toBe(0);                            // 前置：零连接
      expect(debouncer.isDebounced(`onStoreDocument-${name}`)).toBe(false); // 前置：零 debounce
      const release = await doc.saveMutex.acquire();                        // 库内部 Mutex 实例直接锁（测试层公开字段操作——A14 同款字段面）
      try {
        expect(doc.saveMutex.isLocked()).toBe(true);
        expect(server.hocuspocus.shouldUnloadDocument(doc)).toBe(false);    // 反例②：锁 alone 拦住谓词（连接已零+debounce 已停）
      } finally { release(); }
      expect(server.hocuspocus.shouldUnloadDocument(doc)).toBe(true);   // 释放翻真（单变量对照——翻转归因于锁）
    } finally { await conn.disconnect(); await server.destroy(); }
  }, 10_000);
});

// ══ Z105 ephemeral×reaper 交织（Y0c T20 M-3——质量评审建议原文：「ephemeral 在飞读+
// tryRelease('reaper') 交织：读完整+doc 由后断方卸载」）══ 装置裁决（Z64 同款）：交织本质=
// 库 count 门时序（esm:1145-1174 disconnect 内部段），fixture 层 disconnect 复刻止步终态、
// 无窗口中间态可表达 ⇒ 真库 bare Server+deferred 门控（store 段挂起=disconnect 在飞窗——
// Z64 A 窗口同款手法）。与 T15 Z83 用例分工：彼锚应用层会话表协议（acquire 遇 releasing 有限
// 等待），本组锚库层 count 门在「释放撞在飞 ephemeral 读」交织下的三断言：①读结果完整（释放
// 交织不静默丢失——读落在 disconnect store await 窗内）；②doc 由后断的一方触发卸载（count 门
// 互见：先断方 :1160 见 count>0 跳过卸载尾程，后断方 count===0 真卸载）；③无第二实例
// （documents.get 全程同一 doc——常驻复用非重装载）。
describe('Z105 ephemeral×reaper 交织（Y0c T20 M-3——库 count 门时序）', () => {
  it("ephemeral 在飞读+tryRelease('reaper') 交织：读完整+doc 由后断方卸载（count 门互见）+无第二实例", async () => {
    const deferred = <T = void>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
    const storeGate = deferred<void>();
    const readGate = deferred<void>();
    let storeEntered = false;
    let armed = false;   // store 门只挂交织段（transact 触发的常规 debounced store 不拦——先等其 settle）
    const persisted = new Map<string, Uint8Array>();
    const server = new Server({
      port: 0, quiet: true, stopOnSignals: false, debounce: 100, maxDebounce: 150,
      onStoreDocument: async ({ document }) => {
        persisted.set(document.name, Y.encodeStateAsUpdate(document));
        if (armed) { storeEntered = true; await storeGate.promise; }   // 交织段门：disconnect 的 storeDocumentHooks(immediately=true) 挂起=「释放进行中」窗（esm:1149 await 段）
      },
    });
    await server.listen();
    const name = 'p-z105-ephemeral-reaper';
    const connResident = await server.hocuspocus.openDirectConnection(name);   // 常驻 direct（会话表 held 档形态——Z59 钉住面）
    const doc = server.hocuspocus.documents.get(name)!;
    let connEphemeral: Awaited<ReturnType<typeof server.hocuspocus.openDirectConnection>> | null = null;
    try {
      await connResident.transact((d) => { d.getMap('nodes').set('k1', new Y.Map([['x', 1]])); });
      const debouncer = (server.hocuspocus as any).debouncer;
      await pollUntil(() => !debouncer.isDebounced(`onStoreDocument-${name}`) && !debouncer.isCurrentlyExecuting(`onStoreDocument-${name}`), 3_000);   // 常规 store 先走完（Z80 入口① 同款判据——隔离交织段单变量）

      connEphemeral = await server.hocuspocus.openDirectConnection(name);   // ephemeral 读开连（withSession ephemeral entry:null 形态）：doc 常驻 ⇒ 同名复用（esm:1432-1433）⇒ count=2
      expect(server.hocuspocus.documents.get(name)).toBe(doc);              // 断言③（开连面）：无第二实例
      expect(doc.getConnectionsCount()).toBe(2);

      const readPromise = readGate.promise.then(() => {                     // ephemeral 读（read fn 异步在飞形态——readCanvas SV 等待路径同款）
        const nodes = connEphemeral!.document!.getMap('nodes');
        return { has: nodes.has('k1'), x: (nodes.get('k1') as Y.Map<unknown>).get('x') };
      });
      armed = true;
      const dis = connResident.disconnect({ unloadImmediately: true });   // 「读进行中」触发释放：tryRelease('reaper') 对常驻会话的库层动作（releaseSessionFor→disconnect）
      await pollUntil(() => storeEntered, 3_000);                          // 释放进行中窗开门（store await 挂起——:1160 count 检查未达）
      expect(doc.getConnectionsCount()).toBe(1);                           // 先断方已移除自身（esm:1148 removeDirectConnection 先于 store await）——ephemeral 仍在

      readGate.resolve();                                                  // 窗内完成读——释放交织中读不静默丢失
      const read = await readPromise;
      expect(read.has).toBe(true);                                         // 断言①：读完整（k1 在）
      expect(read.x).toBe(1);                                              // 读完整（值无损）

      storeGate.resolve();                                                 // 放行 store ⇒ :1160 count 检查=1>0 ⇒ 跳过卸载（count 门互见·先断方被后断方钉住）
      await dis;                                                           // 先断方 disconnect 收敛（未走卸载尾程）
      expect(server.hocuspocus.documents.has(name)).toBe(true);            // 断言②a：先断方不卸载
      expect(server.hocuspocus.documents.get(name)).toBe(doc);             // 断言③（释放交织后）：仍同一 doc——无第二实例
      const probe = new Y.Doc();
      Y.applyUpdate(probe, persisted.get(name)!);                          // 先断方 flush 已提交（k1 耐久——读完整性的持久面顺带钉守）
      expect(probe.getMap('nodes').has('k1')).toBe(true);

      await connEphemeral.disconnect({ unloadImmediately: true });         // 后断方（ephemeral 收尾——releaseAcquire entry:null 同款 disconnect）
      await pollUntil(() => !server.hocuspocus.documents.has(name), 5_000);
      expect(server.hocuspocus.documents.has(name)).toBe(false);           // 断言②b：doc 由后断的一方触发卸载（count===0 ⇒ 真卸载）
    } finally {
      storeGate.resolve();   // 幂等释门（断言早退防 disconnect 管线永挂=destroy 永不 settle——Z64 同款）
      readGate.resolve();
      try { await connEphemeral?.disconnect({ unloadImmediately: true }); } catch { /* 清理面吞错 */ }
      try { await connResident.disconnect({ unloadImmediately: true }); } catch { /* 清理面吞错 */ }
      await server.destroy();
    }
  }, 15_000);
});
