// apps/api/src/modules/collab/collab-t9-ownership-switch.spec.ts
// Y1c T9（偏离 38①——P1 入口条件）：所有权切换验收计数+onStoreDocument 旧链拆除（强形态=生产链
// spy——零调用=旧链确已拆）+修正 #8 版本门/historyId auth 回执半链接线。
// 验收（卡文原文）：一帧 → 恰一次 WAL append+一次 PG row+一次广播（update 事件恰一）+旧 spool
// append 计数 0（维护队列为空）+onStoreDocument 对 connection-origin 零调用。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { createMockRepo } from '../../test-utils/mock-repo';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';
import { messageYjsUpdate } from 'y-protocols/sync';

let spoolDir: { dir: string; cleanup: () => Promise<void> };
beforeEach(async () => { const d = await makeSpoolDir('t9-own-'); spoolDir = d; });
afterEach(async () => { await spoolDir.cleanup(); });

function buildGateway(opts: { lease?: ReturnType<typeof createLeaseStub> } = {}) {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 't9-history' }) },
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo();
  const lease = opts.lease ?? createLeaseStub();
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t9-owner');
  const eventEmitter = new EventEmitter2();
  const gateway = new CollabGateway(
    prisma as any, eventEmitter as any, repo as any, lease as any,
    perm as any, 48000 + Math.floor(Math.random() * 2000),
    undefined, undefined, undefined, spool,
  );
  gatewayFacade(gateway).forceCollabState('serving');
  const storeUnlockedSpy = gatewayFacade(gateway).spyStoreUnlocked();
  return { gateway, repo, spool, prisma, storeUnlockedSpy, eventEmitter };
}

function makeFrame(name: string, key: string, val: unknown) {
  const src = new Y.Doc();
  src.getMap('nodes').set(key, val);
  return { type: messageYjsUpdate, payload: Y.encodeStateAsUpdate(src) };
}

describe('Y1c T9 所有权切换（偏离 38①——P1 入口条件）', () => {
  it('验收计数：一帧 → 恰一次 WAL append+一次 PG row（appendBatch 单行）+一次广播（update 事件恰一）+旧链零调用（onStoreDocument telemetry-only+storeDocumentUnlocked 零 debounce 触发+维护队列空）', async () => {
    const { gateway, repo, spool, storeUnlockedSpy } = buildGateway();
    const doc = new Y.Doc();
    (doc as unknown as { name: string }).name = 'project:p1';   // 库 Document 结构面（gate pid 解析消费）
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p1', socketId: 's0' } as never);
    // 白盒：hook 直调不经库 createDocument——手工注册进库 documents Map（actor host 读面）
    (gateway.server.hocuspocus.documents as Map<string, Y.Doc>).set('project:p1', doc);
    const conn = { socketId: 's1', readOnly: false, sendStateless: vi.fn() };
    let updateEvents = 0;
    doc.on('update', () => { updateEvents += 1; });   // 广播由库 update 事件驱动（S1 harness 锁库侧面——此处锚事件恰一）
    const f = makeFrame('project:p1', 'own1', 'v1');
    await gateway.hooks.beforeSync({ type: f.type, payload: f.payload, document: doc, connection: conn } as never);
    expect(doc.getMap('nodes').get('own1')).toBe('v1');          // pre-apply 落 doc
    expect(repo.appendBatch).toHaveBeenCalledTimes(1);            // 恰一次 PG 批写
    const rows = repo.appendBatch.mock.calls[0][1] as Array<{ frameCount: number; updateHash: string }>;
    expect(rows).toHaveLength(1);                                 // 一次 PG row（actor drain 批单行）
    expect(rows[0].frameCount).toBe(1);
    expect(updateEvents).toBe(1);                                 // 一次广播（gate apply 事件恰一——库重放幂等零事件）
    expect(await spool.peek('p1')).toHaveLength(0);               // WAL 帧 confirm 回收（旧 spool append 计数 0=维护队列恒空）
    expect(gateway.hasPendingWrites('p1')).toBe(false);   // 旧链队列零帧（双写红①的验收面——B1 委托位②公有直调）
    expect(storeUnlockedSpy).not.toHaveBeenCalled();              // onStoreDocument 旧链确已拆（强形态 spy——零调用）
    // onStoreDocument 钩子 telemetry-only：可调用不触达 store
    await gateway.hooks.onStoreDocument({ document: doc, documentName: 'project:p1' } as never);
    expect(storeUnlockedSpy).not.toHaveBeenCalled();
  }, 20_000);

  it('SS2 帧闸（gate ⓪ 收编面）：SS2>maxDocBytes+ALLOWANCE → 4404 doc-over-quota+doc-status 先通告', async () => {
    const { gateway, repo } = buildGateway();
    const doc = new Y.Doc();
    (doc as unknown as { name: string }).name = 'project:p2';
    await gateway.hooks.onLoadDocument({ document: doc, documentName: 'project:p2', socketId: 's0' } as never);
    (gateway.server.hocuspocus.documents as Map<string, Y.Doc>).set('project:p2', doc);
    const conn = { socketId: 's2', readOnly: false, sendStateless: vi.fn() };
    const huge = new Uint8Array(8 * 1024 * 1024 + 64 * 1024 + 1);   // 恰越 ss2FrameGate（WS maxPayload 9MiB 内承载）
    await expect(gateway.hooks.beforeSync({ type: 1, payload: huge, document: doc, connection: conn } as never))
      .rejects.toMatchObject({ code: 4404 });
    expect(repo.appendBatch).not.toHaveBeenCalled();               // 零 WAL 零 PG
    expect(conn.sendStateless).toHaveBeenCalled();                  // doc-status 先通告（自救面）
  }, 20_000);

  it('修正 #8（resolveVersionGate 接线）：hid 不匹配 → auth 拒 schema-outdated；首连无 hid → 放行+auth 回执下发 historyId', async () => {
    const { gateway, prisma } = buildGateway();
    gatewayFacade(gateway).forceCollabState('serving');
    // 服务端历史权威接线（listenCollab 面以 prisma mock 承载——直调 setServerHistory 等价接线）
    gateway.sessionGuard.setServerHistory({ historyId: 'server-history-1' });
    const base = { documentName: 'project:p3', requestHeaders: new Headers({ cookie: 'flowweb.session_token=t' }), socketId: 's3' };
    // 首连（无 hid）→ 放行（allowFirstConnect——无值≠有值不匹配）
    await expect(gateway.hooks.onAuthenticate({ ...base, requestParameters: new URLSearchParams('csv=3') } as never)).resolves.toBeTruthy();
    // hid 不匹配 → client-outdated（4406 族——auth 面 SCHEMA_OUTDATED 拒）
    await expect(gateway.hooks.onAuthenticate({ ...base, requestParameters: new URLSearchParams('csv=3&hid=stale') } as never))
      .rejects.toMatchObject({ reason: 'schema-outdated' });
    // hid 匹配 → 放行
    await expect(gateway.hooks.onAuthenticate({ ...base, requestParameters: new URLSearchParams('csv=3&hid=server-history-1') } as never)).resolves.toBeTruthy();
    void prisma;
    // auth 回执下发（connected 面 stateless auth-receipt 携 historyId——web 消费归后续卡 deferred）
    const conn = { socketId: 's3', readOnly: false, sendStateless: vi.fn(), context: {}, webSocket: { send: vi.fn(), close: vi.fn(), bufferedAmount: 0 } };
    await gateway.hooks.connected({ socketId: 's3', connection: conn as never, documentName: 'project:p3' } as never);
    const receipt = conn.sendStateless.mock.calls.map((c: unknown[]) => String(c[0])).find((s: string) => s.includes('auth-receipt'));
    expect(receipt).toBeDefined();
    expect(JSON.parse(receipt!).historyId).toBe('server-history-1');
  }, 20_000);

  it('S-M2：setProjectGeneration 接线真行为——装载 generation=7 → spool.currentGeneration=7+后续段名 g7 域', async () => {
    const { gateway: gw2, spool, repo } = buildGatewayWithGen(7);
    // PG 腿失败（帧留 spool 未 confirm——段名可观测；connection 帧已 resolve 不受影响）
    repo.appendBatch.mockImplementation(async () => { throw new Error('pg down'); });
    const doc2 = new Y.Doc();
    // Y1c T12：gen=7 的 canonical wire 名=#g7（裸名装载被世代准入拒——admitDocNameForGeneration）
    const canonicalName = 'project:p5#g7';
    (doc2 as unknown as { name: string }).name = canonicalName;
    await gw2.hooks.onLoadDocument({ document: doc2, documentName: canonicalName, socketId: 's0' } as never);
    expect(spool.currentGeneration('p5'), '装载播种经 onGenerationSeeded 缝直达 spool（gateway 1 行转发接线面）').toBe(7);
    (gw2.server.hocuspocus.documents as Map<string, Y.Doc>).set(canonicalName, doc2);
    const conn = { socketId: 's5', readOnly: false, sendStateless: vi.fn() };
    const f = makeFrame('project:p5', 'gen1', 1);
    await gw2.hooks.beforeSync({ type: f.type, payload: f.payload, document: doc2, connection: conn } as never);
    const frames = await spool.peek('p5');
    expect(frames).toHaveLength(1);                                    // 未 confirm 帧留 spool（PG 腿失败档）
    expect(frames[0].frameId, '后续段名 g7 域（appendBatchRaw 消费播种值——空断言空心化修复）').toContain('.g7.');
    expect(frames[0].walSeq).toBe(1n);
  }, 20_000);

  it('Q-I1：卸载/projectGone 链清 actor states——两项目建态→卸载一 states 键消失；project.gone 事件同钩', async () => {
    // lease fast=false：onModuleInit 只注册 project.gone 订阅不 listen（doc-lifecycle spec :448 同款装置）
    const lease = createLeaseStub({ tryAcquireFast: vi.fn(async () => false), isServing: vi.fn(() => false) });
    const { gateway, repo, eventEmitter } = buildGateway({ lease });
    await gateway.onModuleInit();   // project.gone/team.disbanded 订阅注册（本用例锚事件链）
    gatewayFacade(gateway).forceCollabState('serving');   // onModuleInit 置 acquiring（fast=false 不 listen）——回播种放行态
    // PG 腿恒失败：帧留 spool 未 confirm——owner 目录不回收（规避 confirm rmdir×并发 append 的
    // ENOENT 竞态，本用例锚 states 清理链非 WAL 写面；竞态本体已登记 T33 收口）
    repo.appendBatch.mockImplementation(async () => { throw new Error('pg down'); });
    // 两项目各装载+提交一帧（actor states 建键）
    for (const pid of ['pa', 'pb']) {
      const doc = new Y.Doc();
      (doc as unknown as { name: string }).name = `project:${pid}`;
      (doc as unknown as { connections: Map<unknown, unknown> }).connections = new Map();   // 库 Document 结构面（projectGone 链 closeTeamDocuments 消费）
      await gateway.hooks.onLoadDocument({ document: doc, documentName: `project:${pid}`, socketId: 's0' } as never);
      (gateway.server.hocuspocus.documents as Map<string, Y.Doc>).set(`project:${pid}`, doc);
      const f = makeFrame(pid, 'k1', 1);
      await gateway.hooks.beforeSync({ type: f.type, payload: f.payload, document: doc, connection: { socketId: pid, readOnly: false, sendStateless: vi.fn() } } as never);
    }
    const states = (gateway.projectActor as unknown as { states: Map<string, unknown> }).states;
    expect(states.size, '两项目态在位（红相基线——卸载链不触达 actor=无界驻留）').toBe(2);
    // 卸载链：afterUnloadDocument → DR 终态清理 + actor.onProjectStateCleanup
    await gateway.hooks.afterUnloadDocument({ documentName: 'project:pa' } as never);
    expect(states.has('pa'), '卸载一 → states 键消失（cleanupKey 契约兑现）').toBe(false);
    expect(states.has('pb')).toBe(true);
    // 项目消失链：project.gone 事件 → handleProjectsGone → actor 清理（同一钩；drain 末轮收尾后触发
    // ——beforeSync resolve 在 apply 点，PG flush 尾段仍可能在飞，守卫=留驻下次钩）
    await new Promise((r) => setTimeout(r, 20));
    eventEmitter.emit('project.gone', { projectIds: ['pb'] });
    expect(states.has('pb'), 'projectGone 链同钩清理').toBe(false);
    expect(states.size).toBe(0);
  }, 20_000);
});

function buildGatewayWithGen(generation: number) {
  const prisma = {
    systemHistory: { findUnique: vi.fn().mockResolvedValue({ historyId: 't9-history' }) },
    session: { findUnique: vi.fn().mockResolvedValue({ user: { id: 'u1', name: '张三' }, userId: 'u1', expiresAt: new Date(Date.now() + 86400000) }) },
    canvasProject: { findUnique: vi.fn().mockResolvedValue({ teamId: 't1' }) },
    projectMember: { findUnique: vi.fn().mockResolvedValue(null) },
    teamMember: { findUnique: vi.fn().mockResolvedValue({ role: 'MEMBER', userId: 'u1' }) },
  };
  const repo = createMockRepo({ loadForHydration: vi.fn(async () => ({ state: null, updates: [], stateSeq: 0n, generation })) });
  const lease = createLeaseStub();
  const perm = { resolve: vi.fn().mockResolvedValue('PROJECT_EDITOR'), resolveWithTeam: vi.fn().mockResolvedValue({ role: 'PROJECT_EDITOR', teamId: 't1' }) };
  const spool = new CollabSpoolService(spoolDir.dir);
  spool.setOwner('t9-owner');
  const gateway = new CollabGateway(prisma as any, new EventEmitter2() as any, repo as any, lease as any, perm as any, 49000 + Math.floor(Math.random() * 1000), undefined, undefined, undefined, spool);
  gatewayFacade(gateway).forceCollabState('serving');
  return { gateway, spool, repo };
}
