// apps/api/src/modules/collab/read-canvas-routing.spec.ts —— Y0b-2 T3 红用例主件
// 四主题：①isPersistedComplete 谓词四合一（documents/inFlight/pending/spool 任一非空→false——
// PG 完整性判定=快照读缓存门）；②SnapshotDocCache TTL 单飞（并发 N 次底层解码恰 1 次；
// TTL 过期重新解码）；③谓词不满足→fallback 活读（非陈旧快照——快照不可信定义性不使用）
// +yjs_snapshot_fallback_total 计数；④谓词满足→快照缓存出口（两次读恰一次解码）。
// 单元池纪律：无 PG/DATABASE_URL——gateway 直构（mock spool）/service 直构（mock gateway+repo）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as Y from 'yjs';
import { CollabGateway } from './collab.gateway';
import { CollabDocumentService } from './collab-document.service';
import { SnapshotDocCache, type DecodedSnapshot } from './snapshot-doc-cache';
import { yjsSnapshotFallbackTotal, unregisterPendingCollector } from './store.metrics';
import { stampDocSchema, type DocLike, type DocMapLike } from '@flowweb/shared';

/** 测试内 Y.Doc→DocLike 适配（collab-document.service.spec 同款手法——夹具盖章用） */
function toDocLike(doc: Y.Doc): DocLike {
  return {
    getMap: (name) => doc.getMap(name) as unknown as DocMapLike,
    createMap: () => new Y.Map() as unknown as DocMapLike,
  };
}

/** 已盖章单节点 doc 的快照 state（decodeSnapshot 夹具——生产快照恒有戳） */
function stampedState(): Buffer {
  const doc = new Y.Doc();
  stampDocSchema(toDocLike(doc));
  doc.getMap('nodes').set('n1', new Y.Map(Object.entries({ type: 'textInput' })));
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/** gateway 直构（谓词四态可操纵）：spool 走 mock（hasFrames 由帧集驱动——零磁盘 IO）；
 *  构造器副作用=registerPendingCollector（afterEach 反注册保卫生）+new Server（不 listen）。 */
function makeGateway(spoolFrames: Set<string>) {
  return new CollabGateway({} as any, new EventEmitter2() as any, {} as any, {} as any, { resolve: vi.fn() } as any,
    undefined, undefined, undefined, undefined,
    { hasFrames: (id: string) => spoolFrames.has(id) } as any);
}

const fallbackCount = async () =>
  (await yjsSnapshotFallbackTotal.get()).values.reduce((s, v) => s + v.value, 0);

afterEach(() => { unregisterPendingCollector(); });

describe('Y0b-2 T3：isPersistedComplete 谓词+SnapshotDocCache', () => {
  it('谓词四合一（documents/inFlight/pending/spool 任一非空→false；全空→true）', () => {
    // 基线：四态全空 → true
    const frames = new Set<string>();
    const g = makeGateway(frames) as any;
    expect(g.isPersistedComplete('p1')).toBe(true);

    // 态①：documents 常驻（doc 在内存——编辑在途，PG 可能滞后）
    g.server.hocuspocus.documents.set('project:p1', {} as any);
    expect(g.isPersistedComplete('p1')).toBe(false);
    g.server.hocuspocus.documents.delete('project:p1');

    // 态②：in-flight store（取批未落定）
    expect(g.isPersistedComplete('p1')).toBe(true);   // 复位语义锚（①清理后回 true）
    g.inFlightProjects.add('p1');
    expect(g.isPersistedComplete('p1')).toBe(false);
    g.inFlightProjects.delete('p1');

    // 态③：pending 队列非空（去抖窗内未 store）；空数组条目不阻塞（无在途批）
    g.pendingQueues.set('p1', []);
    expect(g.isPersistedComplete('p1')).toBe(true);
    g.pendingQueues.set('p1', [new Uint8Array([1])]);
    expect(g.isPersistedComplete('p1')).toBe(false);
    g.pendingQueues.set('p1', []);

    // 态④：spool 有帧（store 故障期台账未回灌）
    frames.add('p1');
    expect(g.isPersistedComplete('p1')).toBe(false);
    frames.delete('p1');

    // 全空复位 → true
    expect(g.isPersistedComplete('p1')).toBe(true);
  });

  it('TTL 窗内并发 N 次 → 底层解码恰 1 次（单飞）；TTL 过期重新解码；命中窗内不重解码', async () => {
    vi.useFakeTimers();
    try {
      const cache = new SnapshotDocCache(1_000);
      let calls = 0;
      let release!: (v: DecodedSnapshot) => void;
      const loader = () => new Promise<DecodedSnapshot>((res) => { calls += 1; release = res; });

      // 并发 3 次（loader 挂起窗内）→ 共享同一 in-flight Promise
      const all = Promise.all([
        cache.get('p1', loader),
        cache.get('p1', loader),
        cache.get('p1', loader),
      ]);
      release({ nodes: [], edges: [] });
      await all;
      expect(calls).toBe(1);                          // 单飞：并发 N 次底层恰 1 次

      // TTL 命中窗内：再读不重解码
      await cache.get('p1', loader);
      expect(calls).toBe(1);

      // TTL 过期：重新解码
      vi.advanceTimersByTime(1_001);
      const again = cache.get('p1', loader);
      release({ nodes: [], edges: [] });
      await again;
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('谓词不满足 → fallback 活读（非陈旧快照）+snapshotFallbackTotal.inc 计数', async () => {
    const gateway = { isPersistedComplete: vi.fn(() => false) };
    const repo = { readSnapshotOnly: vi.fn() };
    const service = new CollabDocumentService(gateway as any, repo as any);
    const liveSpy = vi.spyOn(service, 'readCanvas').mockResolvedValue({ nodes: [{ id: 'live' }], edges: [] });

    const before = await fallbackCount();
    const out = await service.readCanvasSnapshotCached('p1');

    expect(liveSpy).toHaveBeenCalledWith('p1');       // 活读承接（快照不可信定义性不使用）
    expect(repo.readSnapshotOnly).not.toHaveBeenCalled();   // 快照读未发生
    expect(out.nodes).toEqual([{ id: 'live' }]);
    expect((await fallbackCount()) - before).toBe(1); // 计数观测（Z108 接线点）
  });

  it('谓词满足 → 走快照缓存出口（两次读恰一次解码）', async () => {
    const state = stampedState();
    const repo = { readSnapshotOnly: vi.fn(async () => ({ state, updates: [], stateSeq: 1n })) };
    const gateway = { isPersistedComplete: vi.fn(() => true) };
    const service = new CollabDocumentService(gateway as any, repo as any);

    const out1 = await service.readCanvasSnapshotCached('p1');
    const out2 = await service.readCanvasSnapshotCached('p1');

    expect(repo.readSnapshotOnly).toHaveBeenCalledTimes(1);   // decodeSnapshot 单源+TTL 缓存
    expect(out1.nodes.map((n: any) => n.id)).toEqual(['n1']);
    expect(out2).toEqual(out1);                        // 缓存命中返回同一投影
  });
});
