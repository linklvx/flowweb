// apps/web/src/stores/canvasCollabRuntime.viewer.spec.ts
// 批2-2 VIEWER 第一层（doc 硬门）——spec VIEWER 组/canEdit 门组三类入口之 cs 拖拽 + 恢复链面：
// 判据：readOnly 会话（authenticated scope='readonly' → collabReadOnly 粘滞 true）⇒ doc 零写
//   ①cs 拖拽形态（store 直写 nodes——批4b-2 后无翻译层恒零写；真拖拽路径在 ⑤）
//   ②ns 数据变更形态 → doc 零写（ns 写点已全量换芯 intent，dispatch 门拦截）
//   ③S1 停写（O0b-0）：恢复链零回写——cs 与 doc 同持服务端原值（无几何修正无回写）
//   ④断连窗口仍只读（粘滞锚——onClose 不清 collabReadOnly）
//   ⑤read-write 回归锚：拖拽（onNodesChange 真路径）照常同步 doc + 恢复链同样零回写（门不过度拦截）
//   ⑥单路径结构锚：远端应用窗口零本地 doc 写（bindBridge/applyingRemote 随批4b-2 退役）
// 装置照 conn.spec：mock provider 手写 handlers 表（真 Y.Doc 经 runtime.getDoc() 直驱）；
// doc 写零判据 = update 事件计数（origin 为字符串的事务 = 本地代码发起的写；fixture 种子写 origin=null 不计）。
// O0b-0：夹具 fillDoc 后显式 stampDocSchema（fillDoc 已不写 meta——戳源唯一化；读侧版本门要求 v2 戳）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import * as runtime from './canvasCollabRuntime';
import { fillDoc, toDocLike } from '@/collab/ydocBuilder';
import { stampDocSchema } from '@flowweb/shared';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    static instances: MockProvider[] = [];
    isAuthenticated = false;
    isSynced = false;
    isAttached = true;
    unsyncedChanges = 0;
    destroyCalls = 0;
    destroyGate: Promise<void> | null = null;
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
    async destroy() {
      this.destroyCalls++;
      if (this.destroyCalls === 1 && this.destroyGate) await this.destroyGate;
      this.handlers = {};
      const cur = this.awareness.meta.get(this.awareness.clientID)?.clock ?? 0;
      this.awareness.meta.set(this.awareness.clientID, { clock: cur + 2, lastUpdated: Date.now() });
    }
  }
  return { HocuspocusProvider: MockProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 健康会话建立（scope 决定 collabReadOnly 终态——readonly=VIEWER / read-write=编辑者） */
async function driveToReady(pid: string, scope: 'readonly' | 'read-write') {
  const done = runtime.initCollab(pid);
  await tick();
  const p = lastInstance();
  p.emit('status', { status: 'connected' });
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  p.emit('message', {});
  return p;
}

/** 本地代码发起的 doc 写计数（origin 为字符串=本端事务；fixture 种子 origin=null 不计） */
function countLocalDocWrites(d: Y.Doc): () => number {
  let n = 0;
  d.on('update', (_u: Uint8Array, origin: unknown) => { if (typeof origin === 'string') n++; });
  return () => n;
}

const nodePos = (d: Y.Doc, id: string) => (d.getMap('nodes').get(id) as Y.Map<any>).get('position')?.toJSON();
const nodeData = (d: Y.Doc, id: string) => (d.getMap('nodes').get(id) as Y.Map<any>).get('data')?.toJSON();

describe('批2-2 第一层：doc 硬门（readOnly 会话 doc 零写——含 system intent）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle', collabReadOnly: true, wsAuthNotice: null });
    useNodeStore.setState({ nodes: {}, execStatus: new Map(), execAligned: new Map() });
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('①cs 拖拽：readOnly → bindBridge cs 回调短路，doc 零写', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    // 种子：服务端 doc 已有 n1（origin=null——种子写不计入本地写计数）
    fillDoc(runtime.getDoc()!, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    const writes = countLocalDocWrites(runtime.getDoc()!);
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'readonly' }); // VIEWER
    p.isSynced = true;
    p.emit('synced', {});
    await done0;
    expect(useCanvasStore.getState().hydration).toBe('ready'); // 会话就绪（只读不影响水合）
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);

    // 拖拽形态：React Flow 受控路径写 cs.nodes 新位置
    useCanvasStore.setState({ nodes: [{ id: 'n1', type: 'textInput', position: { x: 100, y: 0 }, data: {} } as any] });
    expect(nodePos(runtime.getDoc()!, 'n1')).toEqual({ x: 0, y: 0 }); // doc 零写——硬门短路
    expect(writes()).toBe(0);
  });

  it('②ns 数据变更：readOnly → bindBridge ns 回调短路，doc 零写', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    fillDoc(runtime.getDoc()!, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'server' } } as any], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    const writes = countLocalDocWrites(runtime.getDoc()!);
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'readonly' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;

    useNodeStore.setState((s) => ({
      nodes: { ...s.nodes, n1: { ...s.nodes.n1, data: { ...s.nodes.n1.data, content: 'viewer-edit' } } },
    }));
    expect(nodeData(runtime.getDoc()!, 'n1').content).toBe('server'); // doc 零写
    expect(writes()).toBe(0);
  });

  it('③S1 停写（O0b-0）：readOnly → 无几何修正亦无回写——cs 与 doc 同持服务端原值', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    // 组 fixture：g1 携带"错"框（违反不变量——历史 S1 会 refit 修复），子 c1 doc abs(500,500)
    fillDoc(runtime.getDoc()!, [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 100, height: 100, data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 500, y: 500 }, data: {} } as any,
    ], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    const writes = countLocalDocWrites(runtime.getDoc()!);
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'readonly' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;

    // cs 侧：无几何修正（S1 停写——恢复链零回写），g1=doc 原值
    const g1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 'g1') as any;
    expect(g1.position).toEqual({ x: 0, y: 0 });
    expect(g1.width).toBe(100);
    expect(g1.height).toBe(100);
    // c1 rel=abs−origin=(500,500)——reconcile 写域②直拷（只写 cs 不写 doc）
    const c1 = useCanvasStore.getState().nodes.find((n: any) => n.id === 'c1') as any;
    expect(c1.position).toEqual({ x: 500, y: 500 });
    // doc 侧：零写——组框保持服务端原值
    const dg = runtime.getDoc()!.getMap('nodes').get('g1') as Y.Map<any>;
    expect(dg.get('position').toJSON()).toEqual({ x: 0, y: 0 });
    expect(dg.get('width')).toBe(100);
    expect(dg.get('height')).toBe(100);
    expect(writes()).toBe(0);
  });

  it('④粘滞锚：readonly 断连窗口（status disconnected，onClose 不清）→ 拖拽仍零 doc 写', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    fillDoc(runtime.getDoc()!, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    const writes = countLocalDocWrites(runtime.getDoc()!);
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'readonly' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;
    p.emit('status', { status: 'disconnected' }); // 断连——collabReadOnly 粘滞不清（fail-closed）
    expect(useCanvasStore.getState().collabReadOnly).toBe(true);

    useCanvasStore.setState({ nodes: [{ id: 'n1', type: 'textInput', position: { x: 200, y: 0 }, data: {} } as any] });
    expect(nodePos(runtime.getDoc()!, 'n1')).toEqual({ x: 0, y: 0 });
    expect(writes()).toBe(0);
  });

  it('⑤rw 回归锚：read-write 拖拽照常同步 doc（门不过度拦截——批4b-2 真拖拽路径=onNodesChange→intent）', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    fillDoc(runtime.getDoc()!, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: {} } as any], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;
    expect(useCanvasStore.getState().collabReadOnly).toBe(false);

    useCanvasStore.getState().onNodesChange([
      { type: 'position', id: 'n1', position: { x: 100, y: 0 } },
      // B4'-2 后无 session 常规几何路径=叶子 resize（position 并入 envelope 三键——门判据②分型）；
      // 拖动批=手势期零 intent（session 驱动）。本锚验证 rw 门不过度拦截 intent 漏斗。
      { type: 'dimensions', id: 'n1', setAttributes: true, resizing: true, dimensions: { width: 320, height: 180 } },
    ]);
    expect(nodePos(runtime.getDoc()!, 'n1')).toEqual({ x: 100, y: 0 }); // 编辑会话照常同步
  });

  it('⑤rw 回归锚：S1 停写（O0b-0）——rw 会话恢复链同样零回写（无 Geometry origin 事务）', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    const origins: string[] = [];
    runtime.getDoc()!.on('update', (_u: Uint8Array, origin: unknown) => { if (typeof origin === 'string') origins.push(origin); });
    fillDoc(runtime.getDoc()!, [
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, width: 100, height: 100, data: { groupType: 'normal' } } as any,
      { id: 'c1', type: 'imageGen', parentId: 'g1', position: { x: 500, y: 500 }, data: {} } as any,
    ], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;

    // S1 停写：恢复链零 Geometry 回写事务（doc g1 保持原值）
    expect(origins.filter((o) => o === 'geometry-repair')).toEqual([]);
    const dg = runtime.getDoc()!.getMap('nodes').get('g1') as Y.Map<any>;
    expect(dg.get('position').toJSON()).toEqual({ x: 0, y: 0 });
    expect(dg.get('width')).toBe(100);
    expect(dg.get('height')).toBe(100);
  });

  it('⑥单路径结构锚：rw 远端应用窗口内零本地 doc 写（批4b-2——store 重建无翻译层，回声路径不存在）', async () => {
    const done0 = runtime.initCollab('p1');
    await tick();
    const p = lastInstance();
    fillDoc(runtime.getDoc()!, [{ id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: 'server' } } as any], []);
    stampDocSchema(toDocLike(runtime.getDoc()!));
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done0;

    const writes = countLocalDocWrites(runtime.getDoc()!);
    // 远端帧（origin=null——不属 LOCAL_ORIGINS）→ onRemote 50ms 重建窗口内 applyDocToStore 的
    // 双 store 写无翻译层可回 doc（bindBridge/applyingRemote 随批4b-2 退役——回声结构性不存在）
    const dataMap = (runtime.getDoc()!.getMap('nodes').get('n1') as Y.Map<any>).get('data') as Y.Map<any>;
    dataMap.set('content', 'remote-v2');
    await new Promise<void>((r) => setTimeout(r, 100)); // 推进过 50ms 重建 timer
    expect((useNodeStore.getState().nodes.n1.data as any).content).toBe('remote-v2'); // 远端应用照旧
    expect(nodeData(runtime.getDoc()!, 'n1').content).toBe('remote-v2'); // doc 仍持远端值
    expect(writes()).toBe(0); // 窗口内零本地 doc 写
  });
});
