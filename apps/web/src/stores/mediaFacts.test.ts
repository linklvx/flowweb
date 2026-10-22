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
  mergeFactRows, stagePendingFact, stagePendingFactRows, consumePendingFacts, factVersionNewer, parseFactRow,
  PENDING_FACTS_TTL_MS, PENDING_FACTS_CAP, type MediaFactEntry,
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

  it('parseFactRow：state 类透传（errorCode/error）；T17 登记收口：natural 类进消费面（width/height/rotation）；坏 payload 忽略', () => {
    expect(parseFactRow({ factVersion: '1', factType: 'state', payload: { status: 'failed', errorCode: 'MATERIALIZE_FAILED', error: 'x' } }))
      .toMatchObject({ state: 'failed', errorCode: 'MATERIALIZE_FAILED' });
    expect(parseFactRow({ factVersion: '2', factType: 'natural', payload: { naturalWidth: 1920, naturalHeight: 1080, naturalRotation: 90 } }))
      .toMatchObject({ natural: { width: 1920, height: 1080, rotation: 90 } });   // T17 登记收口（改前红=natural 一律 null）
    expect(parseFactRow({ factVersion: '1', factType: 'state', payload: { status: 'weird' } })).toBeNull();
    expect(parseFactRow({ factVersion: '1', factType: 'natural', payload: { naturalWidth: 0, naturalHeight: 10 } })).toBeNull();   // 非法尺寸
  });

  it('T17 登记收口：mergeFactRows 两类行 union 进同 mediaId 条目（state 先到/natural 补入；纯 natural 不建条目）', () => {
    const m = mergeFactRows(new Map(), [
      { mediaId: 'm1', facts: [
        { factVersion: '3', factType: 'state', payload: { status: 'completed' } },
        { factVersion: '3', factType: 'natural', payload: { naturalWidth: 1280, naturalHeight: 720 } },
      ] },
    ]);
    expect(m.get('m1')?.state).toBe('completed');
    expect(m.get('m1')?.natural).toEqual({ width: 1280, height: 720, rotation: null });
    // 纯 natural 行（state 未到——retention 窗罕见形态）不建条目（state 必需）
    const m2 = mergeFactRows(new Map(), [
      { mediaId: 'm2', facts: [{ factVersion: '5', factType: 'natural', payload: { naturalWidth: 1, naturalHeight: 2 } }] },
    ]);
    expect(m2.get('m2')).toBeUndefined();
    // natural 后到补入「无 natural 的既有 state 条目」（等值版本正交补充豁免——严格单调门会吞）
    const mStateOnly = mergeFactRows(new Map(), [
      { mediaId: 'm1', facts: [{ factVersion: '3', factType: 'state', payload: { status: 'completed' } }] },
    ]);
    const m3 = mergeFactRows(mStateOnly, [{ mediaId: 'm1', facts: [{ factVersion: '3', factType: 'natural', payload: { naturalWidth: 800, naturalHeight: 600 } }] }]);
    expect(m3.get('m1')?.natural).toEqual({ width: 800, height: 600, rotation: null });
    expect(m3.get('m1')?.state).toBe('completed');   // state 面不被 natural-only 行覆盖
    // 等值版本且 base 已有 natural——重放忽略（幂等：同版本不可变）
    const m4 = mergeFactRows(m, [{ mediaId: 'm1', facts: [{ factVersion: '3', factType: 'natural', payload: { naturalWidth: 800, naturalHeight: 600 } }] }]);
    expect(m4.get('m1')?.natural).toEqual({ width: 1280, height: 720, rotation: null });
  });

  it('T16 登记收口（T19）：stagePendingFactRows 两类行 union 暂存+容量帽（超帽逐出最早到期——静止会话防滞留）', () => {
    // 两类行 union 暂存（改前红=只 stage state 行——natural 丢失）
    let pending = stagePendingFactRows(new Map(), 'm1', [
      { factVersion: '1', factType: 'state', payload: { status: 'processing' } },
      { factVersion: '1', factType: 'natural', payload: { naturalWidth: 640, naturalHeight: 480 } },
    ], 1_000);
    expect(pending.get('m1')?.entry.state).toBe('processing');
    expect(pending.get('m1')?.entry.natural).toEqual({ width: 640, height: 480, rotation: null });

    // 容量帽：PENDING_FACTS_CAP+1 条新暂存 → 最早到期者被逐
    for (let i = 0; i < PENDING_FACTS_CAP; i += 1) {
      pending = stagePendingFact(pending, `cap-${i}`, fact(`${i}`, 'processing'), 2_000 + i);
    }
    expect(pending.size).toBe(PENDING_FACTS_CAP);   // m1（expiresAt=1000+TTL 最早）被逐
    expect(pending.has('m1')).toBe(false);
    expect(pending.size).toBeLessThanOrEqual(PENDING_FACTS_CAP);
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

  const makeRefVideoDoc = (mediaId: string): Y.Doc => {
    const doc = new Y.Doc();
    const n = new Y.Map();
    const data = new Y.Map();
    data.set('referenceVideo', mediaId);   // P1#1：AddNodeMenu 上传视频引用形态（updateConfig→data）
    n.set('type', 'videoGen');
    n.set('data', data);
    doc.getMap('nodes').set('n1', n);
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

  it('P2#4 全链路（模块态非纯函数）：全量拉回未知 mediaId fact→暂存 pending→fileId 到达即消费（零二次拉取）', async () => {
    vi.useFakeTimers();
    try {
      // ①会话起点：doc 含 m-late 引用发起全量拉——响应到达前 doc 已失引用（投影滞后/副本删除竞态窗：
      // 请求集按拉取时 doc 快照、响应 ingest 按当时 doc 现值判——fact 先于 fileId 到达的真实形态）
      let resolveFetch!: (v: unknown) => void;
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockImplementationOnce(
        () => new Promise((res) => { resolveFetch = res; }),
      );
      const doc1 = makeDoc('m-late');
      pullMediaFactsFull(doc1);
      await vi.advanceTimersByTimeAsync(10);
      expect(fetchMediaFacts).toHaveBeenCalledWith(['m-late'], 't1');
      // 拉取在飞窗：doc 删引用（响应未达——此窗的 fact 即「先于 fileId 到达」）
      doc1.getMap('nodes').delete('n1');
      onDocRefsChanged(doc1);
      resolveFetch([
        { mediaId: 'm-late', facts: [{ factVersion: '0', factType: 'state', payload: { status: 'processing' } }] },
      ]);
      await vi.advanceTimersByTimeAsync(10);
      // 暂存态：nodeStore.mediaFacts 空（doc 未引用——不消费，仅 pending TTL Map 暂存）
      expect(useNodeStore.getState().mediaFacts.size).toBe(0);

      // ②fileId 到达（新 doc 引用就位——投影 poller 交付/副本 paste 形态）→ 消费暂存 fact 入 store
      const doc2 = makeDoc('m-late');
      onDocRefsChanged(doc2);
      const entry = useNodeStore.getState().mediaFacts.get('m-late');
      expect(entry?.state).toBe('processing');   // fileId 到达即消费（pending 命中）
      expect(entry?.factVersion).toBe('0');

      // ③消费后 lazy 队列仍会去抖补拉（拉取通道对账——pending 消费与 lazy 补拉独立不互斥）
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockClear();
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(fetchMediaFacts).toHaveBeenCalledWith(['m-late'], 't1');

      // ④旧 factVersion 重放（补拉返回同版本）——不回退（单调门）
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockClear();
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { mediaId: 'm-late', facts: [{ factVersion: '0', factType: 'state', payload: { status: 'processing' } }] },
      ]);
      pullMediaFactsForIds(['m-late']);
      await vi.advanceTimersByTimeAsync(10);
      expect(useNodeStore.getState().mediaFacts.get('m-late')?.state).toBe('processing');
      expect(useNodeStore.getState().mediaFacts.get('m-late')?.factVersion).toBe('0');
      // 新版本到达——推进
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockClear();
      (fetchMediaFacts as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { mediaId: 'm-late', facts: [{ factVersion: '1', factType: 'state', payload: { status: 'completed' } }] },
      ]);
      pullMediaFactsForIds(['m-late']);
      await vi.advanceTimersByTimeAsync(10);
      expect(useNodeStore.getState().mediaFacts.get('m-late')?.state).toBe('completed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('collectMediaIds（shared 单源）经 web toDocLike 读 Y.Doc 九键（P1#1 后含 referenceVideo/referenceAudio）', () => {
    const doc = makeDoc('m-file');
    expect([...collectMediaIds(toDocLike(doc))]).toEqual(['m-file']);
    expect([...collectMediaIds(toDocLike(makeRefVideoDoc('m-rv')))]).toEqual(['m-rv']);   // P1#1 键入集
  });
});
