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

// Y0b-5 T3：mock 收敛——唯一载体 @/test/fixtures/fakeHocuspocusProvider（裁定 24⑪⑤）。
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
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

describe('Y1c T22 G5（红③收口）：exec 监听投影退役——doc.exec 停读（数据源=Runtime Store 投影）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    resetStores();
  });
  afterEach(async () => {
    await runtime.destroyCollab();
  });

  it('initCollab 后写 doc exec 条目 → nodeStore.execStatus 零变化（doc.exec 停读——旧源恒 stale 已退役）', async () => {
    await driveToSynced('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'loading');
    m.set('jobId', 'j1');
    m.set('intentId', 'i1');
    d.getMap('exec').set('n1', m);
    expect(useNodeStore.getState().execStatus.get('n1')).toBeUndefined();   // T22：doc exec 写不进投影（服务端已停写——遗留写仅历史残留）
  });

  it('初始投影退役：synced 前已存在的 exec 条目不再投影（armSession 只做 runtime 投影复位）', async () => {
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
    expect(useNodeStore.getState().execStatus.get('n1')).toBeUndefined();   // T22：零 doc exec 读
  });

  it('条目内层键变更零投影（observeDeep 源已拆——exec map 零接触）', async () => {
    await driveToSynced('p1');
    const d = runtime.getDoc()!;
    const m = new Y.Map();
    m.set('status', 'loading');
    d.getMap('exec').set('n1', m);
    m.set('status', 'done');
    expect(useNodeStore.getState().execStatus.get('n1')).toBeUndefined();
  });

  it('投影移除回落语义保持：runtime 投影清空 → 回落 data.status（execStatusOf 合并视图不变）', async () => {
    await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    useNodeStore.setState({ execStatus: new Map([['n1', { status: 'done' }]]) });
    expect(execStatusOf('n1')).toBe('done');
    useNodeStore.setState({ execStatus: new Map() });   // 投影清（如 feed 换代全量重建前窗）
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

  it('exec 投影已有条目（服务端已接管——T22 源=Runtime Store）→ 不查表不重复对齐', async () => {
    const p = await driveToSynced('p1');
    // T22：doc.exec 停读——「服务端已接管」判据=runtime 投影条目（nodeStore.execStatus 由其投影）
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    useNodeStore.setState({ execStatus: new Map([['n1', { status: 'loading', jobId: 'j1' }]]) });
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
    // Y0b-5 T2：collabDiagnostics visibilitychange flush 同事件触发——jsdom 无 sendBeacon 会落
    // fetch 降级路径污染"零 fetch"断言；吸收遥测 beacon（真浏览器走 sendBeacon 不经 fetch）
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(fetchSpy).not.toHaveBeenCalled();
    hiddenSpy.mockRestore();
  });

  it('Y0b-2 T6（Z78 激活验收）：VOIDED 最新行 → 不写不回退（保持 loading——资金已退，终态未定）', async () => {
    const p = await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('VOIDED', { error: '回收' })]));
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(useNodeStore.getState().execAligned.has('n1')).toBe(false);
    expect(execStatusOf('n1')).toBe('loading');
  });

  it('Y0b-2 T6（T5 deferred 行形态）：FAILED 行带 attempts → 对齐投影 attempts 随行（重试文案判据单源）', async () => {
    const p = await driveToSynced('p1');
    useNodeStore.setState({ nodes: { n1: loadingNode('n1') as any } });
    fetchSpy.mockImplementation(async () => ok([intentRow('FAILED', { error: 'boom', attempts: 2 })]));
    p.emit('status', { status: 'disconnected' });
    p.emit('status', { status: 'connected' });
    await tick();
    expect(useNodeStore.getState().execAligned.get('n1')).toMatchObject({ status: 'error', error: 'boom', attempts: 2 });
  });
});

describe('批1-6+Y1c T22：客户端零 exec 接触（静态锚——doc.exec 停读后读监听面随 D9 退役）', () => {
  it("getMap('exec') 生产代码零命中（T22：读投影/监听源已切 Runtime Store——canvasCollabRuntime 零接触）", async () => {
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
    expect(hits).toEqual([]);   // T22：doc.exec 读监听面退役（数据源=runtimeStore 投影）
    expect(writeHits).toEqual([]);                            // 写侧零命中（F2 维持）
  });
});
