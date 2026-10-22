// apps/web/src/stores/canvasCollabRuntime.t8.spec.ts
// Y0b-5 T8：本地持久化最小内核 runtime 绑定——boot 回放/能力位/离线冷启动只读/diverged 闩锁/
// Σpending 流控/尺寸闸复检/pagehide flush/docBytes 遥测。
// 装置承 t6/cache.spec（fakeHocuspocusProvider+真 Y.Doc+fake timers）+fakeIndexedDb（内存 IDB stub）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { CANVAS_DOC_SCHEMA_VERSION, FRAME_ALLOWANCE_BYTES, QUOTA_DEFAULTS } from '@flowweb/shared';
import { useCanvasStore } from './canvasStore';
import { canEdit } from './syncStatus';
import * as runtime from './canvasCollabRuntime';
import { getUndoManager, Origin } from './canvasUndo';
import { buildLocalCacheKey } from '@/collab/local-cache-key';
import { LOCAL_CACHE_MAX_DOC_BYTES, type LocalCacheRecord } from '@/collab/local-collab-cache';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';
import { getRecentCollabDiag, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';
import { _resetUnloadGuardForTest } from '@/utils/unloadGuard';
import { toDocLike } from '@/collab/ydocBuilder';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

/** spec 修复 1b：exportLocalBackup opts 透传观测（t6.spec M2 同款 importOriginal 包裹转发——
 * 行为零改动,仅记录 tag 面——jsdom 文件名不可断言,观测收参侧） */
const exportOptsLog: Array<{ tag?: string }> = [];
vi.mock('@/collab/canvas-local-backup', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    exportLocalBackup: (d: unknown, opts?: { tag?: string }) => {
      exportOptsLog.push(opts ?? {});
      return (orig.exportLocalBackup as (d: unknown, opts?: { tag?: string }) => unknown)(d, opts);
    },
  };
});

/** jsdom 无 URL.createObjectURL——静态方法注入（t6.spec 同款；测后删除还原） */
function stubBlobUrls(): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: () => 'blob:mock',
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
}
function restoreBlobUrls(): void {
  delete (URL as any).createObjectURL;
  delete (URL as any).revokeObjectURL;
}

const META = { collabGeneration: 3, collabSchemaVersion: 2, viewerUid: 'u1' };
const KEY = buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 2 });
const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const reloadSpy = vi.fn();

let kit: FakeIndexedDbFactory;

const resetStore = () => useCanvasStore.setState({
  connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle',
  collabReadOnly: true, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
  connReadOnly: false, quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0,
  quotaSoftLimitBytes: 0, quotaResidueBytes: undefined, lastDocStatusRev: 0,
  localDocBytes: 0, localDelta: 0, pendingGenerationReload: 0, wsQuotaTerminal: null,
  localCacheReady: false, canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false, pendingBacklog: false,
});

/** 快照构造：单节点+schemaVersion 盖戳（真快照源自服务端盖戳 doc——DEV 版本门拒无戳） */
function snapshotOf(build: (d: Y.Doc) => void): Uint8Array {
  const d = new Y.Doc();
  d.getMap('meta').set('schemaVersion', CANVAS_DOC_SCHEMA_VERSION);
  build(d);
  return Y.encodeStateAsUpdate(d);
}
/** 播种节点构造（docShape 合形——type+position+最小 data；quota.spec remoteUpdate 同款+position）：
 *  裸 id 节点 doc 侧无 type/position 而 hydrate 侧恒补（cs position 必填+type 回落 videoGen）——
 *  checkProjectionInvariant 两侧失配=invariant_violation stderr 噪音（计数被污染）。 */
const seedNode = (dataEntries: Array<[string, unknown]> = []): Y.Map<any> => new Y.Map<any>([
  ['type', 'textInput'],
  ['position', new Y.Map([['x', 0], ['y', 0]])],
  ['data', new Y.Map(dataEntries)],
]);
const REC = (over: Partial<LocalCacheRecord> = {}): LocalCacheRecord => ({
  snapshot: snapshotOf((d) => { d.getMap('nodes').set('seed-a', seedNode()); }),
  unsyncedDirty: false, diverged: false, at: 1_000, ...over,
});
const localEdit = (d: Y.Doc, key = 'n-t8', payload: unknown = 1): void => {
  d.transact(() => { d.getMap('m').set(key, payload); }, Origin.LocalUser);
};

async function driveToSynced(pid = 'p1', meta: runtime.CollabSessionMeta = META) {
  const done = runtime.initCollab(pid, meta);
  await vi.advanceTimersByTimeAsync(0);
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

beforeEach(() => {
  vi.useFakeTimers();
  (HocuspocusProvider as any).instances.length = 0;
  _resetCollabDiagForTest();
  _resetUnloadGuardForTest();
  resetStore();
  reloadSpy.mockClear();
  kit = createFakeIndexedDb();
  vi.stubGlobal('indexedDB', kit.fake);
  vi.stubGlobal('navigator', {
    ...navigator,
    onLine: true,
    storage: { persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ usage: 1, quota: 1_000_000 })) },
  });
  vi.stubGlobal('location', { reload: reloadSpy });
});

afterEach(async () => {
  await runtime.destroyCollab();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flushedRecord = () => kit.data.get(KEY)?.get('snapshot') as LocalCacheRecord | undefined;

// ══════════ boot 回放+能力位（裁定 24⑦/裁定 21） ══════════
describe('T8 boot 回放与能力位', () => {
  it('boot：seeded 快照回放进 doc（装载后 undoManager.clear——缓存装载非用户编辑）+whenSynced(本地库加载)真值→localCacheReady=true（不抬 hydration 门——渲染门仍=服务端 synced）', async () => {
    kit.data.set(KEY, new Map([['snapshot', REC()]]));
    const p = await driveToSynced();
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('seed-a');   // 本地副本已渲染
    expect(useCanvasStore.getState().hydration).toBe('ready');                            // 渲染门由服务端 synced 抬
    expect(getUndoManager()?.undoStack.length ?? -1).toBe(0);                             // 回放不进撤销栈
    expect(useCanvasStore.getState().localCacheReady).toBe(true);                         // 能力位翻转
    void p;
  });

  it('编辑→trailing 1s 落盘（unsyncedDirty=true——T6 单源同值随快照存）+onFlushed 能力位', async () => {
    const p = await driveToSynced();
    const d = runtime.getDoc()!;
    localEdit(d);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushedRecord()?.unsyncedDirty).toBe(true);
    expect(useCanvasStore.getState().localCacheReady).toBe(true);
    void p;
  });

  it('结构性变更（增删节点）提前到期：无前序编辑（无 pending timer）→总窗 <1s 已落盘+盘上快照含新节点（孤立结构性事务 observe 先于 update 到达——兜底排 150ms）', async () => {
    await driveToSynced();
    const d = runtime.getDoc()!;
    expect(flushedRecord()).toBeUndefined();   // 前置锚：无前缀落盘（真实判据——旧断言 JSON.stringify(0)="0" 恒真=伪覆盖）
    d.transact(() => { d.getMap('nodes').set('n-struct', seedNode()); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(150);   // 总窗 <1s（trailing 1s 窗内）——红：observe 先到无 pending timer→no-op→等满 1s
    const rec = flushedRecord();
    expect(rec).toBeTruthy();   // 150ms 内已写
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, rec!.snapshot);
    expect([...decoded.getMap('nodes').keys()]).toContain('n-struct');   // 盘上快照含新节点（非旧记录残留）
    expect(rec!.unsyncedDirty).toBe(true);
  });

  it('★E36 不可达性断言【出口⑫b】：快照编码≤闸 ⇒ 回放后整量 SS2 帧真实 byteLength<服务端闸（maxDocBytes+ALLOWANCE——4404 结构性恒过的同源闸）', async () => {
    // 贴闸快照（编码≤LOCAL_CACHE_MAX_DOC_BYTES 的最坏合法形态）
    const blob = 'x'.repeat(LOCAL_CACHE_MAX_DOC_BYTES - 100_000);
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: snapshotOf((d) => { d.getMap('nodes').set('big', seedNode([['blob', blob]])); }) })]]));
    await driveToSynced();
    const encoded = Y.encodeStateAsUpdate(runtime.getDoc()!);
    expect(encoded.byteLength).toBeLessThanOrEqual(LOCAL_CACHE_MAX_DOC_BYTES);   // 同源闸：快照编码≤闸
    // SS2 帧线形（y-protocols sync 协议）：[0][varString docName][1][varUint len][update]
    const varint = (n: number) => { const out: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n > 0) b |= 0x80; out.push(b); } while (n > 0); return out; };
    const name = [...'project:p1'].map((c) => c.charCodeAt(0));
    const frame = new Uint8Array([0, ...varint(name.length), ...name, 1, ...varint(encoded.byteLength), ...encoded]);
    expect(frame.byteLength).toBeLessThan(QUOTA_DEFAULTS.maxDocBytes + FRAME_ALLOWANCE_BYTES);   // 结构性恒过（4404 不可达）
  }, 20_000);

  it('离线冷启动恒只读：hydration failed ∧ localCacheReady ∧有缓存→applyDocToStore 渲染本地副本+canEdit=false（谓词零改动——hydration!=="ready" 天然拦；E5 授权语义）', async () => {
    kit.data.set(KEY, new Map([['snapshot', REC()]]));
    const done = runtime.initCollab('p1', META);   // 不发 synced——10s 死线
    await vi.advanceTimersByTimeAsync(0);
    expect(useCanvasStore.getState().hydration).toBe('pending');   // 本地副本就位不抬门
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    const s = useCanvasStore.getState();
    expect(s.hydration).toBe('failed');
    expect(s.nodes.map((n: any) => n.id)).toContain('seed-a');   // 本地副本已渲染
    expect(s.localCacheReady).toBe(true);
    expect(canEdit(s)).toBe(false);                              // 只读由谓词结构性保证
  });

  it('尺寸闸不过（boot 快照超闸）→能力位保持 false 维持「未保存」档（「本地已缓存」诚实分支）', async () => {
    const big = snapshotOf((d) => { d.getMap('nodes').set('big', seedNode([['blob', 'x'.repeat(LOCAL_CACHE_MAX_DOC_BYTES)]])); });
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: big })]]));
    await driveToSynced();
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
  }, 20_000);

  it('IDB 全交互降级：open 失败→initCollab 正常完成+ws_status reason="local-cache-degraded" 遥测+localCacheReady=false（协作主链零影响——异常冒泡=协作初始化失败禁发生）', async () => {
    kit.failNextOpen();
    const p = await driveToSynced('p1', META);   // 不抛=主链无恙
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
    void p;
  });

  it('★⑫a 贯通【spec 修复 3-1】：编辑→落盘→新会话 boot 回放→synced 后复合（两阶段 fake 会话驱动——未上行编辑跨会话存活,SV 差分上行待确认）', async () => {
    // 阶段一（会话 A）：read-write 编辑（结构性节点）→trailing 落盘（unsyncedDirty 随快照存）
    await driveToSynced();
    const dA = runtime.getDoc()!;
    dA.transact(() => { dA.getMap('nodes').set('rt-1', seedNode()); }, Origin.LocalUser);
    await vi.advanceTimersByTimeAsync(1_000);   // trailing 落盘窗（结构性 150ms 提前到期同窗覆盖）
    expect(flushedRecord()?.unsyncedDirty).toBe(true);   // 前置锚：盘上有未确认编辑
    await runtime.destroyCollab();   // 会话终点=硬刷新形态（timer/连接/doc 全拆）
    // 阶段二（会话 B）：boot 回放→服务端 synced 后复合
    await driveToSynced();
    expect(runtime.getDoc()!.getMap('nodes').get('rt-1')).toBeTruthy();   // 回放进 doc
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).toContain('rt-1');   // 投影复合
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);   // boot unsyncedDirty 保留——SS2 差分上行待确认
  });
});

// ══════════ diverged 闩锁（裁定 23⑨——出口⑳） ══════════
describe('T8 diverged 持久化闩锁', () => {
  it('★diverged boot：盘上 diverged 记录→不自动回放（doc 无该内容=已拒内容复活根除）+canvasDiverged 置位+单源保守武装（横幅二选一）', async () => {
    const divergedSnapshot = snapshotOf((d) => { d.getMap('nodes').set('div-b', seedNode()); });
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: divergedSnapshot, unsyncedDirty: true, diverged: true })]]));
    const p = await driveToSynced();
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id)).not.toContain('div-b');   // 未回放
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);                                   // 保守武装（tick 不自动清 diverged）
    void p;
  });

  it('★diverged 会话写抑制：回放被抑（suppressCacheWrites）——pagehide 强制 flush 不得用空快照覆盖盘上 diverged 唯一副本', async () => {
    const divergedSnapshot = snapshotOf((d) => { d.getMap('nodes').set('div-b', seedNode()); });
    const onDisk = REC({ snapshot: divergedSnapshot, unsyncedDirty: true, diverged: true });
    kit.data.set(KEY, new Map([['snapshot', onDisk]]));
    await driveToSynced();
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(kit.data.get(KEY)!.get('snapshot')).toEqual(onDisk);   // 原样保留（非空快照覆盖）
  });

  it('★发散闩锁回归【出口⑳】：放弃→清持久条目+reload（恢复自动缓存；顺序锚=discard 完成才 reload）', async () => {
    const divergedSnapshot = snapshotOf((d) => { d.getMap('nodes').set('div-b', seedNode()); });
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: divergedSnapshot, unsyncedDirty: true, diverged: true })]]));
    await driveToSynced();
    runtime.discardLocalDiverged();
    await vi.advanceTimersByTimeAsync(0);
    expect(kit.data.has(KEY)).toBe(false);      // 条目清空——刷新后不再 diverged
    expect(reloadSpy).toHaveBeenCalledTimes(1); // purge 完成→reload（闩锁可退出）
  });

  it('readOnly 期本地编辑→落盘标注 diverged（T6 判据同源——canvasDiverged 电平随快照存）', async () => {
    const p = await driveToSynced();
    useCanvasStore.setState({ collabReadOnly: true });
    localEdit(runtime.getDoc()!);
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);   // T6 单源置位
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flushedRecord()?.diverged).toBe(true);
    expect(flushedRecord()?.unsyncedDirty).toBe(true);
    void p;
  });

  it('★闩锁不被 3s tick 自动解除【spec 修复 1a】：seed diverged→boot→在线 synced+read-write（exit-③ 三键全真）→advance 3.5s→canvasDiverged 仍 true+dirty 未清（healthySync 恒真=前提虚成立——diverged 编辑不在 doc,服务端最终接受对 boot-diverged 不可达）', async () => {
    const divergedSnapshot = snapshotOf((d) => { d.getMap('nodes').set('div-b', seedNode()); });
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: divergedSnapshot, unsyncedDirty: true, diverged: true })]]));
    const p = await driveToSynced();
    // exit-③ 三键全真：canvasDiverged✓+readOnly 解除（authenticated read-write 后 connReadOnly=false）✓
    // +healthySync（isSynced+unsyncedChanges=0）✓——三键全真仍不得清（前提对 boot-diverged 虚成立）
    expect(useCanvasStore.getState().collabReadOnly).toBe(false);   // 前置锚：三键成立
    p.isSynced = true;
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(3_500);   // 越过一个 3s tick
    expect(useCanvasStore.getState().canvasDiverged).toBe(true);   // 闩锁仍锁（现状红：tick 清 diverged——横幅 3s 自消）
    expect(runtime.hasUnsyncedCanvasChanges()).toBe(true);         // dirty 未被清（现状红：tick 清 dirty）
  });

  it('★diverged 导出=盘上记录非内存 doc【spec 修复 1b】：boot-diverged 会话导出→产物含盘上节点（div-b）不含内存节点（srv-only——内存 doc 是服务端版本/空）+tag=diverged 文件名标注', async () => {
    const divergedSnapshot = snapshotOf((d) => { d.getMap('nodes').set('div-b', seedNode()); });
    kit.data.set(KEY, new Map([['snapshot', REC({ snapshot: divergedSnapshot, unsyncedDirty: true, diverged: true })]]));
    const p = await driveToSynced();
    // 内存 doc 混入服务端内容（origin=provider——远端 apply 语义,不置脏）:模拟服务端 synced 版本
    const d = runtime.getDoc()!;
    d.transact(() => { d.getMap('nodes').set('srv-only', seedNode()); }, p);
    stubBlobUrls();
    exportOptsLog.length = 0;
    try {
      const artifact = runtime.exportDivergedContent();
      expect(artifact?.nodeCount).toBe(1);   // 盘上单节点（div-b）——误用内存 doc 则为 2（含 srv-only）
      expect(exportOptsLog.at(-1)).toEqual({ tag: 'diverged' });   // 文件名标注（opts 收参侧可观测）
    } finally {
      restoreBlobUrls();
    }
  });
});

// ══════════ Σpending 流控（裁定 23⑷ 吸收——E36 又一道保险） ══════════
describe('T8 Σpending 流控', () => {
  it('未上行增量>1MB→forceSync()+pendingBacklog 置位（永不阻塞输入）；确认归零自动消', async () => {
    const p = await driveToSynced();
    expect(useCanvasStore.getState().pendingBacklog).toBe(false);
    p.unsyncedChanges = 1;   // 断连形态：确认帧不到——dirty 悬置
    p.isSynced = false;
    localEdit(runtime.getDoc()!, 'blob', 'x'.repeat(1_048_577));   // >UNSYNCED_MAX_BYTES(1MB)
    await vi.advanceTimersByTimeAsync(5_000);
    expect(p.forceSync).toHaveBeenCalled();
    expect(useCanvasStore.getState().pendingBacklog).toBe(true);
    // 确认归零：3s tick 清 dirty（Σpending 累计器同亡）→5s tick 消档
    p.isSynced = true;
    p.unsyncedChanges = 0;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(useCanvasStore.getState().pendingBacklog).toBe(false);
  });
});

// ══════════ 尺寸闸周期复检（T7 5s interval 复用——零新定时器） ══════════
describe('T8 尺寸闸周期复检', () => {
  it('localDocBytes 超闸（Q-I 校准点测量值——零新增 encode）→local-cache-degraded+localCacheReady=false+canvasOversized 置位（停止缓存更新）；回落→恢复', async () => {
    const p = await driveToSynced();
    useCanvasStore.setState({ localDocBytes: LOCAL_CACHE_MAX_DOC_BYTES + 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-degraded')).toBe(true);
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
    expect(useCanvasStore.getState().canvasOversized).toBe(true);
    // 回落→复检恢复（瘦身/vacuum 路径）——oversized 档自动消
    useCanvasStore.setState({ localDocBytes: 100 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(useCanvasStore.getState().canvasOversized).toBe(false);
    void p;
  });
});

// ══════════ flush 触发+docBytes 遥测 ══════════
describe('T8 flush 触发与遥测', () => {
  it('pagehide 强制一次（best-effort——不等 1s 去抖）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushedRecord()?.unsyncedDirty).toBe(true);
  });

  it('visibilitychange→hidden 强制（T2 遥测 pagehide flush 同款结构——两者并存互不干扰）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushedRecord()?.unsyncedDirty).toBe(true);
  });

  it('yjs_client_doc_bytes：doc 字节随 ws_status 批量上送（E33 指定的 E26 重建触发源——最近快照尺寸，字节面变化才发）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);
    await vi.advanceTimersByTimeAsync(1_000);   // flush 落盘
    await vi.advanceTimersByTimeAsync(5_000);   // 5s 节律上送
    const events = getRecentCollabDiag().filter((e) => e.type === 'ws_status' && typeof (e.detail as any)?.docBytes === 'number');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events.at(-1)!.detail as any).docBytes).toBe(flushedRecord()!.snapshot.byteLength);
  });

  it('★dirty 守卫遥测（出口㉖多标签）：他标签 pagehide 落盘 dirty 快照→本会话干净态 pagehide flush 被 skip 不覆盖（遥测在案+A 的未上行编辑仍在）', async () => {
    await driveToSynced();   // 本会话干净 boot（无盘上记录——缓存装载体=pagehide 强制档）
    // 模拟标签 A pagehide 落盘 dirty 快照（绕本会话——直写底层数据；写入既有 Map——
    // 连接闭包捕获 open 时的 Map 引用，整体替换=写进旧引用不可见的平行宇宙）
    const dirtySnapshot = snapshotOf((d) => { d.getMap('nodes').set('foreign', seedNode()); });
    const onDisk = REC({ snapshot: dirtySnapshot, unsyncedDirty: true });
    kit.data.get(KEY)!.set('snapshot', onDisk);
    // 标签 B 干净态 pagehide → flushNow 写 clean 快照 → 守卫拦
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(getRecentCollabDiag().some((e) => e.type === 'ws_status' && (e.detail as any)?.reason === 'local-cache-preserved-foreign-dirty')).toBe(true);
    expect(kit.data.get(KEY)!.get('snapshot')).toEqual(onDisk);   // A 的未上行编辑仍在
  });

  it('★visibilitychange 可见向不 flush【spec 修复 2】：切回标签页（hidden=false）零 flushNow——防冗余全量 encode+虚假 foreign-dirty 遥测（现状红：双向都 flushNow）', async () => {
    await driveToSynced();
    localEdit(runtime.getDoc()!);   // 置脏（1s 去抖挂起——本用例窗内不到期）
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise<void>((r) => queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => r()))));   // drain flushNow 的 async put（若有——fake IDB promise 链）
    hiddenSpy.mockRestore();
    expect(flushedRecord()).toBeUndefined();   // 可见向零 flush——盘上无记录（现状红：双向都 flushNow 即刻落盘）
  });

  it('★容量监控进本地 ring【spec 修复 3-2】：estimate 占比>0.8→ws_status reason=local-cache-quota-high 一条（used/quota 数值随行——ring-only 本地诊断,不入遥测批）', async () => {
    (navigator.storage.estimate as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ usage: 850, quota: 1_000 }));
    await driveToSynced();
    await vi.advanceTimersByTimeAsync(5_000);   // 5s interval→evictForTotalQuota 首查（60s 节流首查即过）
    const ev = getRecentCollabDiag().find((e) => (e.detail as any)?.reason === 'local-cache-quota-high');
    expect(ev).toBeTruthy();
    expect(ev!.type).toBe('ws_status');
    expect((ev!.detail as any).used).toBe(850);
    expect((ev!.detail as any).quota).toBe(1_000);
  });
});

// ══════════ cacheDisabled fail-closed 零回归（T5 语义——T8 不越界） ══════════
describe('T8 fail-closed', () => {
  it('meta 缺失（cacheDisabled）→零 IDB 交互（零 open——本地缓存整体旁路）', async () => {
    const openSpy = vi.spyOn(kit.fake, 'open');
    await driveToSynced('p1', {} as runtime.CollabSessionMeta);   // 三元缺失=cacheDisabled（默认参数陷阱：传 undefined 会落 META 默认）
    expect(openSpy).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().localCacheReady).toBe(false);
  });
});
