// apps/web/src/stores/canvasCollabRuntime.execView.spec.ts
// 批1-6（B2 合并视图）：执行状态客户端半边（Y1c T32：execAligned/intents 恢复对齐链随 doc.exec
// 删除清单退役——断连/刷新恢复=Runtime Store 投影承载〔IDB 持久化+feed 重连追平〕，本 spec 收窄至
// doc.exec 停读（T22 红③）+execStatusOf 合并视图（exec 投影 → data.status）+客户端零 exec 接触静态锚）。
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

// Y1c T22 收口批（C-1）：生产接线后 armSession 会拉 feed 首连快照（真 apiFetch→global fetch）——
// collabApi 模块界 stub（生产接线本身不掩盖——wiring 断言独立锁在 runtimeFeedWiring.spec）。
vi.mock('@/api/collabApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/collabApi')>();
  return {
    ...actual,
    fetchRuntimeFeedSnapshot: async () => ({
      snapshot: { projectId: 'p1', generation: 0, feedSeq: '0', pgSeq: '0', nodes: {} },
      cursor: { historyId: 'h', generation: 0, feedSeq: '0' }, minRetainedSeq: '0', historyId: 'h',
    }),
    fetchRuntimeFeedEvents: async () => ({ events: [], latestFeedSeq: '0', minRetainedSeq: '0', historyId: 'h' }),
  };
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

const loadingNode = (id: string, type = 'imageGen') => ({
  id, type, data: { status: 'loading' } as any,
});

const resetStores = () => {
  useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], connUi: 'ok', hydration: 'idle' });
  useNodeStore.setState({ nodes: {}, execStatus: new Map() });
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

describe('批1-6：execStatusOf 合并视图（exec 投影 → data.status）', () => {
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, execStatus: new Map() });
  });

  it('exec[id]=done 且 data.status=loading → done（exec 投影优先）', () => {
    useNodeStore.setState({
      nodes: { n1: loadingNode('n1') as any },
      execStatus: new Map([['n1', { status: 'done' }]]),
    });
    expect(execStatusOf('n1')).toBe('done');
  });

  it('无 exec 投影 → data.status（默认路径回归）', () => {
    useNodeStore.setState({
      nodes: { n1: { id: 'n1', type: 'imageGen', data: { status: 'error' } as any } },
    });
    expect(execStatusOf('n1')).toBe('error');
    expect(execStatusOf('ghost')).toBe('idle');
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
