// apps/web/src/stores/mediaFacts.test.ts —— Y1b T16：pendingFacts 纯模块红绿——
// fact 先到暂存/fileId 到达即消费/factVersion 旧忽略/TTL 过期丢弃/切项目清空/重连全量拉。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { collectMediaIds } from '@flowweb/shared';

vi.mock('@/api/mediaApi', () => ({
  fetchMediaFacts: vi.fn(async () => []),
}));
vi.mock('@/stores/teamStore', () => ({
  useTeamStore: { getState: () => ({ currentTeamId: 't1' }) },
}));

import {
  mergeFactRows, stagePendingFact, consumePendingFacts, factVersionNewer, parseFactRow,
  PENDING_FACTS_TTL_MS, type MediaFactEntry,
} from './mediaFacts';
import { useNodeStore } from './nodeStore';
import { resetMediaFacts, onDocRefsChanged, pullMediaFactsFull, pullMediaFactsForIds } from './mediaFactsRuntime';
import { fetchMediaFacts } from '@/api/mediaApi';
import { toDocLike } from '@/collab/ydocBuilder';

const fact = (version: string, state: MediaFactEntry['state'], extra: Partial<MediaFactEntry> = {}): MediaFactEntry =>
  ({ factVersion: version, state, receivedAt: 1_000, ...extra });

describe('T16 mediaFacts 纯模块', () => {
  it('factVersionNewer：单调比较（数值非字典序——"10">"9"；等值/旧忽略；非法串最老）', () => {
    expect(factVersionNewer('1', undefined)).toBe(true);
    expect(factVersionNewer('10', '9')).toBe(true);
    expect(factVersionNewer('9', '10')).toBe(false);
    expect(factVersionNewer('2', '2')).toBe(false);   // 等值重放忽略（at-least-once 幂等）
    expect(factVersionNewer('junk', '1')).toBe(false);
    expect(factVersionNewer('1', 'junk')).toBe(true); // stored 非法=最老——新合法版本可覆盖
  });

  it('parseFactRow：state 类透传（errorCode/error）；natural 类/坏 status 忽略', () => {
    expect(parseFactRow({ factVersion: '1', factType: 'state', payload: { status: 'failed', errorCode: 'MATERIALIZE_FAILED', error: 'x' } }))
      .toMatchObject({ state: 'failed', errorCode: 'MATERIALIZE_FAILED' });
    expect(parseFactRow({ factVersion: '1', factType: 'natural', payload: { naturalWidth: 1 } })).toBeNull();
    expect(parseFactRow({ factVersion: '1', factType: 'state', payload: { status: 'weird' } })).toBeNull();
  });

  it('mergeFactRows：批内升序末者胜+跨 mediaId 独立+旧忽略', () => {
    const m = mergeFactRows(new Map(), [
      { mediaId: 'm1', facts: [
        { factVersion: '0', factType: 'state', payload: { status: 'processing' } },
        { factVersion: '1', factType: 'state', payload: { status: 'completed' } },
      ] },
      { mediaId: 'm2', facts: [{ factVersion: '5', factType: 'state', payload: { status: 'failed', errorCode: 'E' } }] },
    ]);
    expect(m.get('m1')?.state).toBe('completed');
    expect(m.get('m2')?.state).toBe('failed');
    // 旧 fact 重放（重连全量拉再收同批）——不回退
    const m2 = mergeFactRows(m, [{ mediaId: 'm1', facts: [{ factVersion: '0', factType: 'state', payload: { status: 'processing' } }] }]);
    expect(m2.get('m1')?.state).toBe('completed');
  });

  it('fact 先到暂存（pendingFacts TTL Map）+fileId 到达即消费', () => {
    let pending = stagePendingFact(new Map(), 'm-late', fact('0', 'processing'), 1_000);
    expect(pending.size).toBe(1);
    // fileId 未达（doc 引用集空）——零消费
    let r = consumePendingFacts(pending, new Set(), new Map(), 1_500);
    expect(r.consumed).toBeNull();
    expect(r.pending.size).toBe(1);
    // fileId 到达——消费迁入+pending 移除
    r = consumePendingFacts(pending, new Set(['m-late']), new Map(), 1_600);
    expect(r.pending.size).toBe(0);
    expect(r.consumed?.get('m-late')?.state).toBe('processing');
    pending = r.pending;
  });

  it('TTL 过期丢弃（「忽略未知 mediaId」=丢到下次重连——非缓存承诺）', () => {
    let pending = stagePendingFact(new Map(), 'm-x', fact('0', 'processing'), 1_000);
    const r = consumePendingFacts(pending, new Set(['m-x']), new Map(), 1_000 + PENDING_FACTS_TTL_MS + 1);
    expect(r.consumed).toBeNull();          // 过期不消费
    expect(r.pending.size).toBe(0);         // 顺带清扫
    pending = r.pending;
    expect(pending.size).toBe(0);
  });

  it('暂存重复到达：新版本覆盖（TTL 续期）；旧/等值不覆盖', () => {
    let pending = stagePendingFact(new Map(), 'm1', fact('0', 'processing'), 1_000);
    pending = stagePendingFact(pending, 'm1', fact('1', 'completed'), 2_000);
    expect(pending.get('m1')?.entry.state).toBe('completed');
    expect(pending.get('m1')?.expiresAt).toBe(2_000 + PENDING_FACTS_TTL_MS);
    pending = stagePendingFact(pending, 'm1', fact('0', 'processing'), 3_000);   // 旧重放
    expect(pending.get('m1')?.entry.state).toBe('completed');
    expect(pending.get('m1')?.expiresAt).toBe(2_000 + PENDING_FACTS_TTL_MS);      // TTL 不续期
  });
});

describe('T16 mediaFactsRuntime（会话编排——mock API）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMediaFacts();
    useNodeStore.setState({ mediaFacts: new Map() });
  });
  afterEach(() => { resetMediaFacts(); useNodeStore.setState({ mediaFacts: new Map() }); });

  const makeDoc = (fileId?: string): Y.Doc => {
    const doc = new Y.Doc();
    if (fileId) {
      const n = new Y.Map();
      const data = new Y.Map();
      data.set('fileId', fileId);
      n.set('type', 'imageGen');
      n.set('data', data);
      doc.getMap('nodes').set('n1', n);
    }
    return doc;
  };

  it('重连全量拉：doc mediaId 集分批 POST+响应直入消费 Map（factVersion string wire）', async () => {
    (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { mediaId: 'm1', facts: [{ factVersion: '0', factType: 'state', payload: { status: 'processing' } }] },
    ]);
    pullMediaFactsFull(makeDoc('m1'));
    await vi.waitFor(() => {
      expect(useNodeStore.getState().mediaFacts.get('m1')?.state).toBe('processing');
    });
    expect(fetchMediaFacts).toHaveBeenCalledWith(['m1'], 't1');
  });

  it('fileId 到达判定：新见 mediaId 触发 lazy 拉取（2s 去抖后）+pending 命中即消费零拉取', async () => {
    vi.useFakeTimers();
    try {
      // 先全量拉建立基线（doc 空——fact 先到场景经响应暂存）
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const empty = makeDoc();
      pullMediaFactsFull(empty);
      await vi.advanceTimersByTimeAsync(10);
      // fact 先于 fileId：直接暂存（模拟重连拉回的未知 mediaId fact）
      const staged = stagePendingFact(new Map(), 'm-late', fact('0', 'processing'), Date.now());
      // 经模块内 pending 消费路径：onDocRefsChanged 在 fileId 到达时消费 pending
      // （pending 是模块态——此处经 reset 后由消费函数直测；runtime 路径=全量拉 ingest 暂存）
      const r = consumePendingFacts(staged, new Set(['m-late']), new Map(), Date.now() + 1);
      expect(r.consumed?.get('m-late')?.state).toBe('processing');

      // 新见 mediaId → lazy 队列去抖拉取
      const doc = makeDoc('m-new');
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockClear();
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      onDocRefsChanged(doc);
      expect(fetchMediaFacts).not.toHaveBeenCalled();   // 去抖窗内零调用
      await vi.advanceTimersByTimeAsync(2_100);
      expect(fetchMediaFacts).toHaveBeenCalledWith(['m-new'], 't1');
      // 同 doc 再触发——零新引用零拉取（knownMediaIds 基线）
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockClear();
      onDocRefsChanged(doc);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(fetchMediaFacts).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('切项目清空：resetMediaFacts 清消费 Map（旧项目事实不跨会话）+定向补拉直通', async () => {
    useNodeStore.setState({ mediaFacts: new Map([['m1', fact('1', 'completed')]]) });
    (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { mediaId: 'm1', facts: [{ factVersion: '2', factType: 'state', payload: { status: 'failed', errorCode: 'MATERIALIZE_FAILED' } }] },
    ]);
    resetMediaFacts();
    expect(useNodeStore.getState().mediaFacts.size).toBe(0);
    pullMediaFactsForIds(['m1']);
    await vi.waitFor(() => {
      expect(useNodeStore.getState().mediaFacts.get('m1')?.state).toBe('failed');
    });
  });

  it('collectMediaIds（shared 单源）经 web toDocLike 读 Y.Doc 七键', () => {
    const doc = makeDoc('m-file');
    expect([...collectMediaIds(toDocLike(doc))]).toEqual(['m-file']);
  });
});
