// apps/web/src/stores/canvasCollabRuntime.invariant.spec.ts
// 批4a 安全网组（红1-不变量 + quiescence 判据）：
// 不变量 = applyRemote 周期末尾 projectionFromDoc(doc) ≡ storeProjection()——
//   O0b-0 格式批：doc=abs 空间，两侧同空间（doc readCanvasFromDoc 直出 abs / store 侧
//   projectCanvasNodes 经 toDocRecords 同变换出 abs）直接深等（无归一层）：
//   ① shadow- 过滤条款已随批5 删信箱移除——doc 出现 /^shadow-/ 改由 DEV 巡检抛出（判据⑥），
//     不变量对 doc/store 分叉如实报告；
//   ② S1 停写（O0b-0）：恢复链零回写——组几何由 reconcile 写 cs 面承接（doc 不被回写）。
// 非恒真式 = 变异实验：doc 摆 store 没有的节点（不走 apply 周期——走了会被 store 吸收恢复等价）
//   → checkProjectionInvariant 必 false，证明断言不是恒真式（安全网有效性）。
// quiescence = 双端（本端=真 runtime 链：intent 漏斗+onRemote 去抖；对端=裸 doc 直写）burst 后
//   静止窗口零新写（无乒乓）+ 两 doc 收敛 + store/doc 相等。
// 装置：mock provider（conn.spec 同款契约锁）驱动真 initCollab——onRemote 全链真实接线，
//   仅网络层以 Y.applyUpdate 双向转发模拟（对端 B 的写经 network origin 入 A——触发真实去抖链）。
//   批4b-2：本地写驱动改 action（addNode/onNodesChange——bindBridge 退役后唯一写路径=dispatch）。
//   O0b-0：doc 夹具显式 stampDocSchema（fillDoc 不写 meta——读侧版本门要求 v2 戳）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import * as runtime from './canvasCollabRuntime';
import { Origin } from './canvasUndo';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema } from '@flowweb/shared';
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

/** rw 会话完整健康序（authenticated read-write → collabReadOnly=false → 可编辑）。
 *  O0b-0：done 后显式 stamp（mock provider 无真 loadDocument 自愈——读侧版本门要求 v2 戳）。 */
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
  stampDocSchema(toDocLike(runtime.getDoc()!));
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

describe('批4a：doc⇄store 投影不变量（applyRemote 周期末尾）', () => {
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
    // 本地写（真意图漏斗：action→dispatch doc 直写+投影回填）
    useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const a1 = useCanvasStore.getState().nodes[0].id;
    const doc = runtime.getDoc()!;
    expect(doc.getMap('nodes').get(a1)).toBeTruthy();
    // 远端帧：对端写普通节点（network origin 触发真实 onRemote 去抖链）
    const B = new Y.Doc();
    bWriteNode(B, 'b1', 9);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(B), 'network');
    await vi.advanceTimersByTimeAsync(60); // 50ms 去抖 → apply 周期（applyDocToStore+周期末尾断言）
    expect(doc.getMap('nodes').get('b1')).toBeTruthy();
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id).sort()).toEqual([a1, 'b1'].sort());
    expect(runtime.checkProjectionInvariant(doc)).toBe(true);
    expect(getCollabDiagCounters().get('invariant_violation')).toBeUndefined(); // 零误报
  });

  it('非恒真式验证（变异实验）：doc 摆 store 没有的节点 → 断言红', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    expect(runtime.checkProjectionInvariant(doc)).toBe(true); // 基线绿（空画布两侧相等）
    // 变异：doc 独有节点。origin=network 只为触发形状真实；不推进去抖 timer——
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

  it('B7-1（O0b-5 接线）变异实验：doc 节点 position 非有限（NaN）→ assertAllPositionsFinite 挂点如实报 false', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    expect(runtime.checkProjectionInvariant(doc)).toBe(true); // 基线绿
    doc.transact(() => {
      const m = new Y.Map(); m.set('type', 'textInput');
      const pos = new Y.Map(); pos.set('x', Number.NaN); pos.set('y', 0); m.set('position', pos);
      m.set('data', new Y.Map());
      doc.getMap('nodes').set('nan-1', m);
    }, 'network');
    // NaN 坐标=不变量破坏（除零/脏数据传播终点）——挂点首行捕获，不再依赖深等的 NaN≠NaN 巧合
    expect(runtime.checkProjectionInvariant(doc)).toBe(false);
  });

  it('批5 判据⑥ dev 巡检：doc 含 shadow- 节点 → applyDocToStore DEV 抛 + 不变量不再双侧过滤（违例如实报告）', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    doc.transact(() => {
      doc.getMap('nodes').set('shadow-video-1', new Y.Map());
    }, 'network');
    // 巡检（DEV 断言）：影子信箱已删——doc 出现 /^shadow-/ 即结构性违例，抛出而非静默吸收
    expect(() => runtime.applyDocToStore(doc)).toThrowError(/shadow-/);
    // 过滤条款随信箱删除：shadow 节点进 doc 侧投影而 store 无 → 不变量如实报 false
    expect(runtime.checkProjectionInvariant(doc)).toBe(false);
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
    // 周期末尾语义：检查在 apply 之后（applyDocToStore 内收尾）
    expect(m![0].indexOf('applyDocToStore(doc!)')).toBeLessThan(m![0].indexOf('checkProjectionInvariant'));
  });

  it('applyRemote 期间零本地 doc 写（单路径结构锚——store 重建无订阅翻译层，回声路径不存在）', async () => {
    await driveToSyncedRw('p1');
    const doc = runtime.getDoc()!;
    useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const B = new Y.Doc();
    bWriteNode(B, 'b1', 9);
    const localWrites: unknown[] = [];
    doc.on('afterTransaction', (tr) => { if (tr.origin === Origin.LocalUser) localWrites.push(tr); });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(B), 'network');
    await vi.advanceTimersByTimeAsync(60); // apply 周期：applyDocToStore 全量重建 store——批4b-2 起 store 写无翻译层（bindBridge 退役）
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
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));   // O0b-0：对端自 server 载入（A 已有 meta 戳——两 doc 同源）
    // 双向网络：A↔B 互通（applyUpdate 幂等——无新内容的回流不再产生 update，无转发循环）
    A.on('update', (u) => Y.applyUpdate(B, u, 'network'));
    B.on('update', (u) => Y.applyUpdate(A, u, 'network'));

    // 双端各先落一个节点（A 经意图漏斗 action→dispatch；B 直写 doc）+ 首轮 apply 收敛
    useCanvasStore.getState().addNode('text', { x: 0, y: 0 });
    const a1 = useCanvasStore.getState().nodes[0].id;
    bWriteNode(B, 'b1', 100);
    await vi.advanceTimersByTimeAsync(60); // 首轮 apply（b1 进 A store）
    expect(useCanvasStore.getState().nodes.map((n: any) => n.id).sort()).toEqual([a1, 'b1'].sort());

    // burst：A 端 5 次本地编辑（真拖拽路径 onNodesChange position→moveNode intent）+ B 端 5 次编辑
    //（doc 直写）——两端并发互 apply。批4b-2：意图只触碰目标成员——A 端无需"保住 b1"（无删除扫描）
    for (let i = 1; i <= 5; i++) {
      useCanvasStore.getState().onNodesChange([
        { type: 'position', id: a1, position: { x: i, y: 0 }, dragging: true },
      ]);
    }
    for (let i = 1; i <= 5; i++) bWriteNode(B, 'b1', 100 + i);
    await vi.advanceTimersByTimeAsync(60); // burst 后 apply 周期（applyDocToStore+周期末尾断言）

    // 计数锚点：静止窗口起点
    let aLocalWrites = 0;
    let bInbound = 0;
    A.on('afterTransaction', (tr) => {
      if (tr.origin === Origin.LocalUser || tr.origin === Origin.Geometry) aLocalWrites++;
    });
    B.on('update', () => { bInbound++; });

    await vi.advanceTimersByTimeAsync(500); // 静止窗口 N ms（>50ms 防抖+去抖余量；<3s 心跳不触发）

    // 无乒乓：A 零新本地写（若 apply 幂等性破——回写反复触发，此处>0）+ B 零新入站（链静止）
    expect(aLocalWrites).toBe(0);
    expect(bInbound).toBe(0);
    // 收敛：两 doc 状态向量相等（见过同一操作集）+ 内容相等
    expect(Y.encodeStateVector(A)).toEqual(Y.encodeStateVector(B));
    expect(A.getMap('nodes').toJSON()).toEqual(B.getMap('nodes').toJSON());
    // 本端 quiescence：store/doc 相等（不变量在静止后仍成立）
    expect(runtime.checkProjectionInvariant(A)).toBe(true);
  });

  it('组节点场景 quiescence：恢复链零回写（S1 停写——B 端 auto 组 apply 后零几何回写）', async () => {
    await driveToSyncedRw('p1');
    const A = runtime.getDoc()!;
    const B = new Y.Doc();
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A));   // O0b-0：对端自 server 载入（A 已有 meta 戳——两 doc 同源）
    A.on('update', (u) => Y.applyUpdate(B, u, 'network'));
    B.on('update', (u) => Y.applyUpdate(A, u, 'network'));

    // 对端建 auto 组（O0 键集形态：组无 width/height，子 c1 parentId=g1、doc abs 坐标）
    B.transact(() => {
      fillDoc(B, [
        { id: 'g1', type: 'group', data: {} },
        { id: 'c1', type: 'textInput', parentId: 'g1', position: { x: 10, y: 10 }, data: {} },
      ] as any, []);
      stampDocSchema(toDocLike(B));   // O0b-0：v2 戳随 update 传播到 A
    }, 'b-edit');
    await vi.advanceTimersByTimeAsync(60); // apply 周期：恢复链零回写（S1 停写）

    // 静止判据：非几何远端帧触发下一轮 apply——恢复链结构上零 Geometry 事务（S1 停写）
    let geoWrites = 0;
    A.on('afterTransaction', (tr) => { if (tr.origin === Origin.Geometry) geoWrites++; });
    B.transact(() => {
      const c1 = B.getMap('nodes').get('c1') as Y.Map<any>;
      const data = c1.get('data') as Y.Map<any>;
      data.set('text', 'edited');
    }, 'b-edit');
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(500);
    expect(geoWrites).toBe(0); // 恢复链零几何回写（S1 停写——结构性）
    expect(Y.encodeStateVector(A)).toEqual(Y.encodeStateVector(B));
    expect(runtime.checkProjectionInvariant(A)).toBe(true);
  });
});
