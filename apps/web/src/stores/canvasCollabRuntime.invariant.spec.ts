// apps/web/src/stores/canvasCollabRuntime.invariant.spec.ts
// 批4a 安全网组（红1-不变量 + quiescence 判据）：
// 不变量 = applyRemote 周期末尾（含 S1 补跑）projectionFromDoc(doc) ≡ storeProjection()——
//   两侧同过双重归一：normalizeCanvasRecord（读侧 readCanvasFromDoc 归一/写侧 projectCanvasNodes）
//   + normalizeLoadedCanvas（加载几何归一）+ 两侧显式过滤 /^shadow-/。两个设计内分叉源必须双侧
//   同变换后才可断言（单侧/缺层则恒假、安全网失效）：
//   ① shadow- 影子（批5 删信箱前 doc 仍含影子而 store 投影天然无）；
//   ② 组几何补缺（S1 契约：normalizeLoadedCanvas 补缺每轮内存重建、不写 doc——doc 无几何而
//     store 有，属设计内分叉——组场景 quiescence 用例实证过：before==after ⇒ S1 零回写）。
// 非恒真式 = 变异实验：doc 摆 store 没有的非影子节点（不走 apply 周期——走了会被 store 吸收恢复等价）
//   → checkProjectionInvariant 必 false，证明断言不是恒真式（安全网有效性）。
// quiescence = 双端（本端=真 runtime 链：bindBridge+onRemote 去抖+S1；对端=裸 doc 直写）burst 后
//   静止窗口零新写（无乒乓）+ 两 doc 收敛 + store/doc 相等。
// 装置：mock provider（conn.spec 同款契约锁）驱动真 initCollab——onRemote/桥/S1 全链真实接线，
//   仅网络层以 Y.applyUpdate 双向转发模拟（对端 B 的写经 network origin 入 A——触发真实去抖链）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { fillDoc } from '@/collab/ydocBuilder';
import { getCollabDiagCounters, _resetCollabDiagForTest } from '@/utils/collabDiagnostics';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    isAttached = true;
    unsyncedChanges = 0;
    handlers: Record<string, Array<(payload: any) => void>> = {};
    configuration: any;
    awareness: any;
    constructor(cfg: any = {}) {
      MockProvider.instances.push(this);
      const clientId = cfg?.document?.clientID ?? 0;
      this.awareness = {
        clientID: clientId,
        meta: new Map<number, { clock: number; lastUpdated: number }>(),
        localState: null as any,
        setLocalState: vi.fn((s: any) => { this.awareness.localState = s; }),
        getLocalState: () => this.awareness.localState,
      };
      this.configuration = { websocketProvider: { shouldConnect: true, connect: vi.fn() } };
    }
    get hasUnsyncedChanges() { return this.unsyncedChanges > 0; }
    on(event: string, cb: (payload: any) => void) { (this.handlers[event] ??= []).push(cb); }
    off(event: string, cb: (payload: any) => void) {
      const arr = this.handlers[event];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
    emit(event: string, payload: any) { for (const cb of [...this.handlers[event] ?? []]) cb(payload); }
    async destroy() { this.handlers = {}; }
  }
  return { HocuspocusProvider: MockProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
/** flush initCollab 入口 teardownSession 的微任务链（provider 构造完成）——
 *  fake timers 下真 setTimeout 永挂，用 advanceTimersByTimeAsync(0)（timer+微任务双 flush） */
const tick = () => vi.advanceTimersByTimeAsync(0);

/** rw 会话完整健康序（authenticated read-write → collabReadOnly=false → 可编辑） */
async function driveToSyncedRw(pid = 'p1') {
  const done = runtime.initCollab(pid);
  await tick();
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

/** 对端编辑形状（B doc 直写一个普通 textInput 节点，origin 标记对端本地） */
function bWriteNode(B: Y.Doc, id: string, x: number) {
  B.transact(() => {
    const existing = B.getMap('nodes').get(id) as Y.Map<any> | undefined;
    if (existing) { existing.get('position').set('x', x); return; }
    const m = new Y.Map(); m.set('type', 'textInput');
    const pos = new Y.Map(); pos.set('x', x); pos.set('y', 0); m.set('position', pos);
    m.set('data', new Y.Map());
    B.getMap('nodes').set(id, m);
  }, 'b-edit');
}

describe('批4a：doc⇄store 投影不变量（applyRemote 周期末尾，含 S1 补跑）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    _resetCollabDiagForTest();
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.useRealTimers();
  });

  it('本地写→远端 apply 周期末尾：投影不变量成立（rw 会话，零误报）', async () => {
    await driveToSyncedRw('p1');
    expect(useCanvasStore.getState().hydration).toBe('ready');
    expect(useCanvasStore.getState().collabReadOnly).toBe(false);
    // 本地写（真 bindBridge → syncStoreToDoc）
    useCanvasStore.setState({
      nodes: [{ id: 'a1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const doc = runtime.getDoc()!;
    expect(doc.getMap('nodes').get('a1')).toBeTruthy();
    // 远端帧：对端写普通节点（network origin 触发真实 onRemote 去抖链）
    const B = new Y.Doc();
    bWriteNode(B, 'b1', 9);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(B), 'network');
    await vi.advanceTimersByTimeAsync(60); // 50ms 去抖 → apply 周期（applyDocToStore+S1+周期末尾断言）
    expect(doc.getMap('nodes').get('b1')).toBeTruthy();
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id).sort()).toEqual(['a1', 'b1']);
    expect(runtime.checkProjectionInvariant(doc)).toBe(true);
    expect(getCollabDiagCounters().get('invariant_violation')).toBeUndefined(); // 零误报
  });

  it('非恒真式验证（变异实验）：doc 摆 store 没有的非影子节点 → 断言红', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    expect(runtime.checkProjectionInvariant(doc)).toBe(true); // 基线绿（空画布两侧相等）
    // 变异：doc 独有非影子节点。origin=network 只为触发形状真实；不推进去抖 timer——
    // 一旦走 apply 周期 store 会吸收该节点恢复等价（applyDocToStore 全量重建是吸收器，
    // 变异必须在周期外直测断言函数本身）
    doc.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', 0); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      doc.getMap('nodes').set('ghost-1', m);
    }, 'network');
    expect(runtime.checkProjectionInvariant(doc)).toBe(false); // 断言非恒真——变异必被抓
  });

  it('影子排除条款：doc 含 shadow- 节点 → 不变量不误报（双侧显式过滤）', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    doc.transact(() => {
      doc.getMap('nodes').set('shadow-video-1', new Y.Map());
    }, 'network');
    expect(runtime.checkProjectionInvariant(doc)).toBe(true); // 影子被两侧过滤——安全网不因批5 前的影子恒假
  });

  it('接线锚：onRemote 去抖周期内 applyDocToStore 之后真调用检查（源码文本——防"函数在、接线无"假绿）', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'canvasCollabRuntime.ts'), 'utf8');
    const m = src.match(/remoteApplyTimer = setTimeout\(\(\) => \{[\s\S]*?\}, 50\)/);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('applyDocToStore(doc!)');
    expect(m![0]).toContain('checkProjectionInvariant');
    // 周期末尾语义：检查在 apply 之后（S1 补跑已含在 applyDocToStore 内）
    expect(m![0].indexOf('applyDocToStore(doc!)')).toBeLessThan(m![0].indexOf('checkProjectionInvariant'));
  });

  it('applyRemote 期间桥回调零 doc 写（latch 锚——applyingRemote 短路既有机制）', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    useCanvasStore.setState({
      nodes: [{ id: 'a1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    const B = new Y.Doc();
    bWriteNode(B, 'b1', 9);
    const localWrites: unknown[] = [];
    doc.on('afterTransaction', (tr) => { if (tr.origin === Origin.LocalUser) localWrites.push(tr); });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(B), 'network');
    await vi.advanceTimersByTimeAsync(60); // apply 周期：applyDocToStore 全量重建 store——若 latch 失效桥会回写 doc
    expect(localWrites).toHaveLength(0);
  });
});

describe('批4a：双端 quiescence（burst 后无乒乓 + 两 doc 收敛）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (HocuspocusProvider as any).instances.length = 0;
    _resetCollabDiagForTest();
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    vi.useRealTimers();
  });

  it('两端各 5 次写互 apply → 静止窗口零新写（无乒乓）+ 两 doc 收敛 + store/doc 相等', async () => {
    await driveToSyncedRw('p1');
    const A = runtime.getDoc()!;
    const B = new Y.Doc();
    // 双向网络：A↔B 互通（applyUpdate 幂等——无新内容的回流不再产生 update，无转发循环）
    A.on('update', (u) => Y.applyUpdate(B, u, 'network'));
    B.on('update', (u) => Y.applyUpdate(A, u, 'network'));

    // 双端各先落一个节点（A 经真桥 store→doc；B 直写 doc）+ 首轮 apply 收敛
    useCanvasStore.setState({
      nodes: [{ id: 'a1', type: 'textInput', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    bWriteNode(B, 'b1', 100);
    await vi.advanceTimersByTimeAsync(60); // 首轮 apply（b1 进 A store，基线立起）
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id).sort()).toEqual(['a1', 'b1']);

    // burst：A 端 5 次本地编辑（真桥）+ B 端 5 次编辑（doc 直写）——两端并发互 apply
    for (let i = 1; i <= 5; i++) {
      useCanvasStore.setState({
        nodes: [
          { id: 'a1', type: 'textInput', position: { x: i, y: 0 }, data: {} },
          { id: 'b1', type: 'textInput', position: { x: 100, y: 0 }, data: {} }, // 保住已吸收的 b1（在删除基线内）
        ],
        edges: [],
      });
    }
    for (let i = 1; i <= 5; i++) bWriteNode(B, 'b1', 100 + i);
    await vi.advanceTimersByTimeAsync(60); // burst 后 apply 周期（applyDocToStore+S1+周期末尾断言）

    // 计数锚点：静止窗口起点
    let aLocalWrites = 0;
    let bInbound = 0;
    A.on('afterTransaction', (tr) => {
      if (tr.origin === Origin.LocalUser || tr.origin === Origin.Geometry) aLocalWrites++;
    });
    B.on('update', () => { bInbound++; });

    await vi.advanceTimersByTimeAsync(500); // 静止窗口 N ms（>50ms 防抖+去抖余量；<3s 心跳不触发）

    // 无乒乓：A 零新本地写（若 apply 幂等性破——S1 回写反复触发，此处>0）+ B 零新入站（链静止）
    expect(aLocalWrites).toBe(0);
    expect(bInbound).toBe(0);
    // 收敛：两 doc 状态向量相等（见过同一操作集）+ 内容相等
    expect(Y.encodeStateVector(A)).toEqual(Y.encodeStateVector(B));
    expect(A.getMap('nodes').toJSON()).toEqual(B.getMap('nodes').toJSON());
    // 本端 quiescence：store/doc 相等（不变量在静止后仍成立）
    expect(runtime.checkProjectionInvariant(A)).toBe(true);
  });

  it('组节点场景 quiescence：S1 补几何一轮回写后静止（写放大判据——refit/normalizeLoadedCanvas 幂等）', async () => {
    await driveToSyncedRw('p1');
    const A = runtime.getDoc()!;
    const B = new Y.Doc();
    A.on('update', (u) => Y.applyUpdate(B, u, 'network'));
    B.on('update', (u) => Y.applyUpdate(A, u, 'network'));

    // 对端建"缺几何组"（子相对坐标形态——normalizeLoadedCanvas 守恒归位的目标形状）：
    // 组 g1 无 width/height，子 c1 parentId=g1、rel 坐标
    B.transact(() => {
      fillDoc(B, [
        { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: {} },
        { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 10, y: 10 }, data: {} },
      ] as any, []);
    }, 'b-edit');
    await vi.advanceTimersByTimeAsync(60); // apply 周期：补几何 → S1 回写一轮（Origin.Geometry）

    // S1 回写后下一轮静止判据：非几何远端帧触发下一轮 apply——几何已收敛（g1 有 width/height →
    // normalizeLoadedCanvas continue、refit 幂等），零几何回写即无写放大
    let geoWrites = 0;
    A.on('afterTransaction', (tr) => { if (tr.origin === Origin.Geometry) geoWrites++; });
    B.transact(() => {
      const c1 = B.getMap('nodes').get('c1') as Y.Map<any>;
      const data = c1.get('data') as Y.Map<any>;
      data.set('text', 'edited');
    }, 'b-edit');
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(500);
    expect(geoWrites).toBe(0); // 第二轮起零几何回写（无写放大——位置帧会合法触发新一轮 S1，故用 data 帧）
    expect(Y.encodeStateVector(A)).toEqual(Y.encodeStateVector(B));
    expect(runtime.checkProjectionInvariant(A)).toBe(true);
  });
});
