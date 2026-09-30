// apps/web/src/stores/canvasCollabRuntime.execView.spec.ts
// 批1-6（B2 合并视图）：执行状态恢复客户端半边。
// 红=exec 监听投影缺失 / execStatusOf 合并视图缺失 / 读点仍直读 data.status /
//   恢复对齐（connect 边沿 + visibilitychange）缺失 / 客户端零 exec 写静态锚失败。
// 绿=runtime exec 投影（observeDeep 浅 Map 重建）+ nodeStore 两源投影
//   （execStatus=doc 投影 / execAligned=intents 对齐）+ selectExecStatus 合并视图
//   （exec 投影 → 对齐 → data.status；终态优先不回退）+ alignExecFromIntents（只读对齐，零 doc 写）。
// 装置照 conn.spec：mock provider 手写 handlers 表（真 Y.Doc 经 runtime.getDoc() 直驱）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore, execStatusOf } from './nodeStore';
import * as runtime from './canvasCollabRuntime';

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

async function beginCollab(pid: string): Promise<{ done: Promise<void>; p: any }> {
  const done = runtime.initCollab(pid);
  await tick();
  return { done, p: lastInstance() };
}

async function driveToSynced(pid = 'p1') {
  const { done, p } = await beginCollab(pid);
  p.emit('status', { status: 'connected' });
  p.emit('status', { status: 'connected' });
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  p.emit('message', {});
  return p;
}

/** fetch 全程接管（apiFetch 信封 {code:0,data}）；默认空行——connect 边沿对齐零副作用 */
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, data }), { status: 200 });
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok([]));
const intentRow = (status: string, extra: Record<string, unknown> = {}) => ({
  intentId: 'i-1', kind: 'image', status, resultRef: null, error: null, ...extra,
});

const loadingNode = (id: string, type = 'imageGen') => ({
  id, type, data: { status: 'loading' } as any,
});

const resetStores = () => {
  useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle' });
  useNodeStore.setState({ nodes: {}, execStatus: new Map(), execAligned: new Map() });
};

describe('批1-6：exec 监听投影（真 Y.Doc 直驱——exec map 服务端唯一写者的展示投影）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    resetStores();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('initCollab 后写 exec 条目 → useNodeStore.execStatus 收到 {status,jobId,intentId}', async () => {
    await driveToSynced('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'loading');
    m.set('jobId', 'j1');
    m.set('intentId', 'i1');
    d.getMap('exec').set('n1', m);
    expect(useNodeStore.getState().execStatus.get('n1')).toEqual({ status: 'loading', jobId: 'j1', intentId: 'i1' });
  });

  it('初始投影：synced 前已存在的 exec 条目在 initCollab 完成时已投影（非仅增量监听）', async () => {
    const { done, p } = await beginCollab('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'done');
    m.set('fileId', 'f1');
    d.getMap('exec').set('n1', m);
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    p.isAuthenticated = true;
    p.emit('authenticated', { scope: 'read-write' });
    p.isSynced = true;
    p.emit('synced', {});
    await done;
    expect(useNodeStore.getState().execStatus.get('n1')).toEqual({ status: 'done', fileId: 'f1' });
  });

  it('条目内层键变更（observeDeep 覆盖）→ 投影更新', async () => {
    await driveToSynced('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'loading');
    d.getMap('exec').set('n1', m);
    m.set('status', 'done'); // 内层键写——非顶层 set/delete
    expect(useNodeStore.getState().execStatus.get('n1')?.status).toBe('done');
  });

  it('exec 条目删除（GC）→ 投影移除 → 回落 data.status', async () => {
    await driveToSynced('p1');
    // hydration 后落位（applyDocToStore 会整替 nodeStore.nodes——装置须在其后写）
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'done');
    d.getMap('exec').set('n1', m);
    expect(execStatusOf('n1')).toBe('done');
    d.getMap('exec').delete('n1');
    expect(useNodeStore.getState().execStatus.has('n1')).toBe(false);
    expect(execStatusOf('n1')).toBe('loading'); // 回落 data.status
  });
});

describe('批1-6：execStatusOf 合并视图（终态优先不回退）', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, execStatus: new Map(), execAligned: new Map() });
  });

  it('exec[id]=done 且 data.status=loading → done（exec 投影优先）', () => {
    useNodeStore.setState({
      nodes: { n1: loadingNode('n1') as any },
      execStatus: new Map([['n1', { status: 'done' }]]),
    });
    expect(execStatusOf('n1')).toBe('done');
  });

  it('exec 投影 loading 压过 aligned done（服务端新鲜度优先——重跑接管对齐结果）', () => {
    useNodeStore.setState({
      nodes: { n1: loadingNode('n1') as any },
      execStatus: new Map([['n1', { status: 'loading', jobId: 'j2' }]]),
      execAligned: new Map([['n1', { status: 'done' }]]),
    });
    expect(execStatusOf('n1')).toBe('loading');
  });

  it('无 exec 投影但有对齐终态 → done（断连恢复查表结果参与合并视图）', () => {
    useNodeStore.setState({
      nodes: { n1: loadingNode('n1') as any },
      execAligned: new Map([['n1', { status: 'done', intentId: 'i-1' }]]),
    });
    expect(execStatusOf('n1')).toBe('done');
  });

  it('两源均无 → data.status（默认路径回归）', () => {
    useNodeStore.setState({
      nodes: { n1: { id: 'n1', type: 'imageGen', data: { status: 'error' } as any } },
    });
    expect(execStatusOf('n1')).toBe('error');
    expect(execStatusOf('ghost')).toBe('idle');
  });
});

describe('批1-6：恢复对齐 alignExecFromIntents（connect 边沿 + visibilitychange；只读对齐零 doc 写）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    resetStores();
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(async () => ok([]));
  });
  afterEach(async () => {
    await runtime.destroyCollab();
    // 注意：不得 vi.restoreAllMocks()——会把模块级 fetch spy 还原成原生 fetch，
    // 后续用例对齐走真 fetch（catch 吞错）→ fetch 计数恒 0（批1-6 实测装置坑）
    fetchSpy.mockClear();
    fetchSpy.mockImplementation(async () => ok([]));
  });

  it('connect 边沿：loading 态节点且无 exec 条目 → GET intents → SUCCEEDED → UI done（execAligned）', async () => {
    const p = await driveToSynced('p1'); // 此时 store 无 loading 节点——首连边沿零查询
    fetchSpy.mockClear();
    // 刷新/断连后形态：节点 data.status=loading、exec map 无条目（服务端从未写/未达）
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('SUCCEEDED', { resultRef: 'f-done' })]));
    // 重连边沿（connected 双发库契约——仅第一发是边沿）
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(1); // 双发只触发一次（边沿判定锚）
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/execution/intents?projectId=p1&nodeId=n1');
    expect(useNodeStore.getState().execAligned.get('n1')).toEqual({ status: 'done', intentId: 'i-1', fileId: 'f-done' });
    expect(execStatusOf('n1')).toBe('done');
    // 只读对齐：doc exec map 不被写回（F2 客户端零 exec 写）
    expect(runtime.getDoc()!.getMap('exec').size).toBe(0);
  });

  it('FAILED → error + error 文案进对齐投影', async () => {
    const p = await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('FAILED', { error: 'boom' })]));
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(useNodeStore.getState().execAligned.get('n1')).toEqual({ status: 'error', intentId: 'i-1', error: 'boom' });
    expect(execStatusOf('n1')).toBe('error');
  });

  it('最新意图行 RUNNING → 不写不回退（保持 loading）', async () => {
    const p = await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('RUNNING')]));
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(useNodeStore.getState().execAligned.has('n1')).toBe(false);
    expect(execStatusOf('n1')).toBe('loading');
  });

  it('exec 投影已有条目（服务端已接管）→ 不查表不重复对齐', async () => {
    const p = await driveToSynced('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'loading');
    m.set('jobId', 'j1');
    d.getMap('exec').set('n1', m);
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(execStatusOf('n1')).toBe('loading');
  });

  it('visibilitychange 回前台 → 触发一次（新增 loading 节点被对齐）', async () => {
    await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n2: loadingNode('n2') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('SUCCEEDED')]));
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('nodeId=n2');
    expect(execStatusOf('n2')).toBe('done');
  });

  it('去抖=单飞：fetch 在飞时连发两次 visibilitychange → 只查一次；完成后终态落位', async () => {
    await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n3: loadingNode('n3') as any } });
    let release!: (r: Response) => void;
    fetchSpy.mockImplementationOnce(() => new Promise<Response>((res) => { release = res; }));
    document.dispatchEvent(new Event('visibilitychange')); // 启动（in-flight）
    document.dispatchEvent(new Event('visibilitychange')); // in-flight 早退
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    release(ok([intentRow('SUCCEEDED')]));
    await tick();
    expect(execStatusOf('n3')).toBe('done');
  });

  it('页面隐藏（visibilitychange 但 document.hidden）→ 不查表', async () => {
    await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n4: loadingNode('n4') as any } });
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    hiddenSpy.mockRestore();
  });
});

describe('批1-6：客户端零 exec 写（静态锚）', () => {
  it("getMap('exec') 生产代码仅 canvasCollabRuntime（读投影/监听），写侧零命中", async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { dirname, join, relative } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [p] : [];
      });
    const hits: string[] = [];
    const writeHits: string[] = [];
    for (const f of walk(srcRoot)) {
      const src = readFileSync(f, 'utf8');
      const rel = relative(srcRoot, f).split('\\').join('/');
      if (src.includes("getMap('exec')")) hits.push(rel);
      if (/getMap\(['"]exec['"]\)\s*\.\s*set\s*\(/.test(src)) writeHits.push(rel);
    }
    expect(hits).toEqual(['stores/canvasCollabRuntime.ts']); // 读监听仅 runtime 一处文件
    expect(writeHits).toEqual([]);                            // 写侧零命中（F2）
  });
});
