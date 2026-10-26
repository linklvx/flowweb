// apps/web/src/stores/runtimeStore.t22.spec.ts
// Y1c T22 G5 客户端半链（红②③+六语料）：reducer（升序去重/缺口/旧代隔离/游标失效两档/换代
// doc.vacuumed→全量快照信号——#10）+execStatusView 数据源切换（nodeStore.execStatus ← runtime
// 投影——红③：doc.exec 停读后 projectRuntimeExecToNodeStore 唯一源）+新鲜度三态+IDB 往返
// +feed-hint 处理（h≤cursor 忽略）+产物事件 sink（尺寸回写链删除后的 facts 触发面）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildFeedFaultCorpus } from '@flowweb/shared';
import type { RuntimeProjection } from '@flowweb/shared';
import {
  applyEventsToProjection, useRuntimeFeedStore, projectRuntimeExecToNodeStore,
  runtimeMediaIdOf, runtimeFreshness, handleFeedHint, setRuntimeArtifactSinkDirect,
  persistProjectionToIdb, loadProjectionFromIdb, clearProjectionInIdb,
  runtimeFeedFetchers, resetRuntimeFeed,
} from './runtimeStore';
import type { RuntimeEventWireRow } from './runtimeFeedTypes';
import { useNodeStore } from './nodeStore';
import { createFakeIndexedDb, type FakeIndexedDbFactory } from '@/test/fakeIndexedDb';

const proj = (over: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
  projectId: 'p1', generation: 3, feedSeq: '0', pgSeq: '0', nodes: {}, ...over,
});

/** corpus 事件 → wire 行（fixture bigint→string；payload 补 kind 面）。 */
const toWire = (e: { feedSeq: bigint; generation: number; kind: string; payload: Record<string, unknown> }): RuntimeEventWireRow => ({
  id: `e${e.feedSeq}`, feedSeq: String(e.feedSeq), generation: e.generation, kind: e.kind,
  payload: e.payload as RuntimeEventWireRow['payload'], docSeq: null, createdAtMs: 0,
});

const cursor = (feedSeq: string) => ({ historyId: 'h-2026-10-24-a', generation: 3, feedSeq });

describe('Y1c T22 G5：客户端 reducer 六语料（shared y1c-feed-fault-corpus 对账）', () => {
  const corpus = buildFeedFaultCorpus();
  const byVerdict = (v: string) => corpus.find((c) => c.expect.verdict === v)!;

  it('乱序+重复（[3,1,2,1]）→升序应用+按 feedSeq 去重（applied=3；槽位=末事件胜）', () => {
    const c = byVerdict('apply-ascending');
    const r = applyEventsToProjection(proj(), cursor('0'), c.events.map(toWire));
    expect(r.appliedSeq).toBe('3');
    expect(r.gap).toBe(false);
    expect(r.projection.nodes['node-a']?.execStatus?.status).toBe('SUCCEEDED');
  });
  it('缺口（cursor=3 返回 [5,6] 缺 4）→gap=true（调用方从 cursor 重取——再缺=全量快照）', () => {
    const c = byVerdict('gap-refetch-from-cursor');
    const r = applyEventsToProjection(proj({ feedSeq: '3' }), cursor('3'), c.events.map(toWire));
    expect(r.gap).toBe(true);   // 首应用事件 5≠3+1
    expect(r.appliedSeq).toBe('6');
  });
  it('旧代（generation 2 事件）→隔离不崩（槽位零写；水位推进防重放风暴）', () => {
    const c = byVerdict('isolate-stale-generation');
    const r = applyEventsToProjection(proj(), cursor('8'), c.events.map(toWire));
    expect(r.projection.nodes['node-b']).toBeUndefined();   // 旧代槽位零写
    expect(r.appliedSeq).toBe('10');
  });
  it('换代 doc.vacuumed →needsSnapshot=true（#10 全量快照——清投影重建）', () => {
    const c = byVerdict('full-snapshot-history-mismatch');
    const events: RuntimeEventWireRow[] = [{ id: 'x', feedSeq: '6', generation: 3, kind: 'doc.vacuumed', payload: { v: 1, kind: 'doc.vacuumed', generation: 3 }, docSeq: null, createdAtMs: 0 }, ...c.events.map(toWire)];
    const r = applyEventsToProjection(proj(), cursor('5'), events);
    expect(r.needsSnapshot).toBe(true);
  });
  it('unknown kind 忽略+计数（不崩——unknown_event_total 客户端面）', () => {
    const events: RuntimeEventWireRow[] = [{ id: 'u1', feedSeq: '1', generation: 3, kind: 'future.kind', payload: { v: 1 }, docSeq: null, createdAtMs: 0 }];
    const r = applyEventsToProjection(proj(), cursor('0'), events);
    expect(r.unknown).toBe(1);
    expect(Object.keys(r.projection.nodes)).toHaveLength(0);
  });
  it('墓碑→复活：node.deleted 高版本清槽；node.restored ≥墓碑版本失活（undo 重建回渲染面）', () => {
    const ev = (feedSeq: string, payload: Record<string, unknown>, kind: string): RuntimeEventWireRow =>
      ({ id: `e${feedSeq}`, feedSeq, generation: 3, kind, payload: { v: 1, ...payload }, docSeq: null, createdAtMs: 0 });
    const r = applyEventsToProjection(proj(), cursor('0'), [
      ev('1', { kind: 'exec.status', nodeId: 'nX', status: 'done', attempts: 1, nodeVersion: '1' }, 'exec.status'),
      ev('2', { kind: 'node.deleted', nodeId: 'nX', lifecycleSeq: '3', nodeVersion: '2' }, 'node.deleted'),
    ]);
    expect(r.projection.nodes.nX?.execStatus).toBeUndefined();   // 墓碑胜——清槽
    const r2 = applyEventsToProjection(r.projection, { historyId: 'h', generation: 3, feedSeq: '2' }, [
      ev('3', { kind: 'node.restored', nodeId: 'nX', lifecycleSeq: '4', nodeVersion: '3' }, 'node.restored'),
    ]);
    expect(r2.projection.nodes.nX?.restored?.lifecycleSeq).toBe('4');   // 复活槽
  });
});

describe('Y1c T22 G5：execStatusView 数据源切换（红③——doc.exec 停读后唯一源=runtime 投影）', () => {
  beforeEach(() => {
    useNodeStore.setState({ execStatus: new Map() });
    resetRuntimeFeed();
  });
  it('投影 execStatus/artifact 槽 → nodeStore.execStatus（status 白名单+fileId=artifact.mediaId）', () => {
    useRuntimeFeedStore.setState({
      projectId: 'p1',
      cursor: { historyId: 'h', generation: 0, feedSeq: '5' },
      projection: {
        projectId: 'p1', generation: 0, feedSeq: '5', pgSeq: '1',
        nodes: {
          n1: {
            execStatus: { status: 'done', attempts: 2, nodeVersion: '5' },
            artifact: { mediaId: 'm-done', artifactRev: 1, nodeVersion: '5' },
          },
          n2: { execStatus: { status: 'illegal-status', nodeVersion: '4' } },   // 白名单外——过滤
        },
      },
      fetchedAtMs: Date.now(),
    });
    projectRuntimeExecToNodeStore();
    const m = useNodeStore.getState().execStatus;
    expect(m.get('n1')).toMatchObject({ status: 'done', attempts: 2, fileId: 'm-done' });   // fileId=artifact 槽
    expect(m.has('n2')).toBe(false);
  });
  it('runtimeMediaIdOf：artifact 槽 overlay 读径（data.fileId 服务端停写后产物身份）', () => {
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: { historyId: 'h', generation: 0, feedSeq: '2' },
      projection: { projectId: 'p1', generation: 0, feedSeq: '2', pgSeq: '0', nodes: { nA: { artifact: { mediaId: 'm-a', artifactRev: 1, nodeVersion: '2' } } } },
      fetchedAtMs: Date.now(),
    });
    expect(runtimeMediaIdOf('nA')).toBe('m-a');
    expect(runtimeMediaIdOf('nB')).toBeUndefined();
  });
});

describe('Y1c T22 G5：新鲜度/feed-hint/产物 sink', () => {
  beforeEach(() => { resetRuntimeFeed(); setRuntimeArtifactSinkDirect(null); });
  it('新鲜度：无投影=unknown（执行禁用 fail-closed 判据）；在线未过期=fresh', () => {
    expect(runtimeFreshness()).toBe('unknown');   // 从未收到过——unknown≠idle
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: { historyId: 'h', generation: 0, feedSeq: '1' },
      projection: proj({ feedSeq: '1' }), fetchedAtMs: Date.now(),
    });
    expect(runtimeFreshness()).toBe('fresh');
  });
  it('feed-hint：h≤cursor 忽略零拉取；h>cursor 触发 sync（fetchers 注入缝计数）', async () => {
    const eventsFn = vi.fn(async () => ({ events: [], latestFeedSeq: '1', minRetainedSeq: '0', historyId: 'h' }));
    runtimeFeedFetchers.events = eventsFn as never;
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: { historyId: 'h', generation: 0, feedSeq: '1' },
      projection: proj({ feedSeq: '1' }), fetchedAtMs: Date.now(), syncing: false,
    });
    handleFeedHint('1');   // h≤cursor——忽略
    await new Promise((r) => setTimeout(r, 10));
    expect(eventsFn).not.toHaveBeenCalled();
    handleFeedHint('5');
    await new Promise((r) => setTimeout(r, 10));
    expect(eventsFn).toHaveBeenCalled();   // h>cursor——拉取
    runtimeFeedFetchers.events = null;
  });
  it('产物事件 sink：exec.artifact 携 mediaId → sink 派发（尺寸回写链删除后的 facts 触发面）', async () => {
    const sink = vi.fn();
    setRuntimeArtifactSinkDirect(sink);
    runtimeFeedFetchers.events = (async () => ({
      events: [
        { id: 'e1', feedSeq: '1', generation: 0, kind: 'exec.artifact', payload: { v: 1, kind: 'exec.artifact', nodeId: 'n1', mediaId: 'm-art', artifactRev: 1, nodeVersion: '1' }, docSeq: null, createdAtMs: 0 },
      ],
      latestFeedSeq: '1', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    useRuntimeFeedStore.setState({
      projectId: 'p1', cursor: { historyId: 'h', generation: 0, feedSeq: '0' },
      projection: proj(), fetchedAtMs: Date.now(), syncing: false,
    });
    handleFeedHint('1');
    await new Promise((r) => setTimeout(r, 10));
    expect(sink).toHaveBeenCalledWith(['m-art']);
    runtimeFeedFetchers.events = null;
  });
});

describe('Y1c T22 G5：IDB 投影持久化（{projectId,generation,feedSeq,pgSeq,projection,fetchedAt}）', () => {
  let kit: FakeIndexedDbFactory;
  beforeEach(async () => {
    kit = createFakeIndexedDb();
    vi.stubGlobal('indexedDB', kit.fake);   // jsdom 无内建 IDB——local-collab-cache.test 同款 stub
    await clearProjectionInIdb('p-idb');
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('持久化往返（load 值等）+TTL 过期弃用', async () => {
    const record = {
      projectId: 'p-idb', generation: 2, feedSeq: '9', pgSeq: '4',
      projection: proj({ projectId: 'p-idb', generation: 2, feedSeq: '9', pgSeq: '4', nodes: { n: { execStatus: { status: 'done', nodeVersion: '9' } } } }),
      fetchedAt: Date.now(),
    };
    await persistProjectionToIdb(record);
    const loaded = await loadProjectionFromIdb('p-idb');
    expect(loaded?.feedSeq).toBe('9');
    expect(loaded?.projection.nodes.n?.execStatus?.status).toBe('done');
    // TTL 过期档
    await persistProjectionToIdb({ ...record, fetchedAt: Date.now() - 8 * 24 * 3600_000 });
    expect(await loadProjectionFromIdb('p-idb')).toBeNull();
    await clearProjectionInIdb('p-idb');
  });
});
