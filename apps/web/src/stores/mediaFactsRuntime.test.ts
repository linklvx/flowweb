// apps/web/src/stores/mediaFactsRuntime.test.ts —— F3（用户裁定③）video processing 自动刷新：
// 会话级退避补拉 watcher——仅「当前 doc 引用集 ∩ store processing 态」媒体；终态退出/引用消失即停；
// 切项目（resetMediaFacts 会话纪元）丢弃在飞响应不 ingest 不续调度。确定性：fake timers+mock fetch，
// 禁真实定时器。①②③既有驱动回归护栏归 mediaFacts.test.ts（'T16 mediaFactsRuntime' describe：
// 重连全量拉/lazy 去抖/切项目清空+pending 消费——本文件不重复，同套件共跑即护栏）。
// 定时边界纪律：advanceTimersByTimeAsync 在窗末有 ±1ms 触发松弛——断言窗口禁 ±1ms 切片，统一
// ≥100ms 安全边距（未到=due-100 处断言零调用；跨档=due+100 处断言已调）。
// 双评审收口：P1 teardown 停轮 / P2-1 活引用集（本地 origin 盲窗）/ P2-2+P2-3 在飞调度不变量
// （单轮单拉+不跳档）/ epoch 判别（新会话后旧响应直钉）/ 停后重启专项。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

vi.mock('@/api/mediaApi', () => ({
  fetchMediaFacts: vi.fn(async () => []),
}));
vi.mock('@/stores/teamStore', () => ({
  useTeamStore: { getState: () => ({ currentTeamId: 't1' }) },
}));
// P1：destroyCollab（teardownSession 清理链）验证面——collab spec 同款装置（裁定 24⑪⑤ fake 载体）
vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

import { useNodeStore } from './nodeStore';
import { resetMediaFacts, onDocRefsChanged, pullMediaFactsFull, pullMediaFactsForIds } from './mediaFactsRuntime';
import { destroyCollab } from './canvasCollabRuntime';
import { fetchMediaFacts } from '@/api/mediaApi';
import type { MediaFactEntry } from './mediaFacts';

const fetchMock = fetchMediaFacts as ReturnType<typeof vi.fn>;

const fact = (version: string, state: MediaFactEntry['state']): MediaFactEntry =>
  ({ factVersion: version, state, receivedAt: 1_000 });

/** state 单行响应（FactsResponseRow 最小形态——payload.status 驱动 watcher 终判）。 */
const stateRow = (
  mediaId: string, version: string, status: 'processing' | 'completed' | 'failed', extra: Record<string, unknown> = {},
) => ({ mediaId, facts: [{ factVersion: version, factType: 'state', payload: { status, ...extra } }] });

/** referenceVideo 引用形态 doc（P1#1 键——collectMediaIds 九键扫描集）。 */
const makeRefVideoDoc = (...mediaIds: string[]): Y.Doc => {
  const doc = new Y.Doc();
  mediaIds.forEach((id, i) => {
    const n = new Y.Map();
    const data = new Y.Map();
    data.set('referenceVideo', id);
    n.set('type', 'videoGen');
    n.set('data', data);
    doc.getMap('nodes').set(`n${i + 1}`, n);
  });
  return doc;
};

describe('F3 mediaFactsRuntime processing watcher（会话级退避补拉）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMediaFacts();
    useNodeStore.setState({ mediaFacts: new Map() });
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetMediaFacts();
    useNodeStore.setState({ mediaFacts: new Map() });
    vi.useRealTimers();
  });

  it('processing→completed 自动刷新：watcher 首档 4s 携引用 mediaId 拉取→completed 入 store→终态退出不再调度', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);                                   // ①驱动入 processing 态（ingest 落 store 即调度）
    await vi.advanceTimersByTimeAsync(10);                     // t=10：arm@4s → due=4010
    expect(useNodeStore.getState().mediaFacts.get('m1')?.state).toBe('processing');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce([stateRow('m1', '1', 'completed')]);
    await vi.advanceTimersByTimeAsync(3_900);                  // t=3910（due-100）
    expect(fetchMock).not.toHaveBeenCalled();                  // 首档 4s 窗内零拉取
    await vi.advanceTimersByTimeAsync(200);                    // t=4110（due+100）——轮次到点
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(['m1'], 't1');
    expect(useNodeStore.getState().mediaFacts.get('m1')?.state).toBe('completed');

    fetchMock.mockClear();                                     // 终态退出——无下一轮
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processing→failed 自动刷新：终态失败（errorCode 透传）入 store 后停止', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce([stateRow('m1', '1', 'failed', { errorCode: 'MATERIALIZE_FAILED', error: 'source expired' })]);
    await vi.advanceTimersByTimeAsync(4_200);                  // t=4210——轮次到点（due=4010）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const entry = useNodeStore.getState().mediaFacts.get('m1');
    expect(entry?.state).toBe('failed');
    expect(entry?.errorCode).toBe('MATERIALIZE_FAILED');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('退避增长 4s→8s→16s→帽 30s；集合新增 processing 成员→退避重置回首档', async () => {
    const doc = makeRefVideoDoc('m1', 'm2');
    fetchMock.mockResolvedValueOnce([                           // m2 引用中但 completed——不进拉取集
      stateRow('m1', '0', 'processing'),
      stateRow('m2', '0', 'completed'),
    ]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);                      // t=10：集={m1}，arm@4s（due=4010）

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);                            // 空响应——store 保持 processing（轮次继续）
    await vi.advanceTimersByTimeAsync(3_900);
    expect(fetchMock).toHaveBeenCalledTimes(0);                 // 首档 4s 未到
    await vi.advanceTimersByTimeAsync(200);                     // t=4110：tick①（due=4010）
    expect(fetchMock).toHaveBeenCalledTimes(1);                 // 下一档 8s（due=12010）
    await vi.advanceTimersByTimeAsync(7_800);
    expect(fetchMock).toHaveBeenCalledTimes(1);                 // 8s 档未到（t=11910）
    await vi.advanceTimersByTimeAsync(200);                     // t=12110：tick②
    expect(fetchMock).toHaveBeenCalledTimes(2);                 // 下一档 16s（due=28010）
    await vi.advanceTimersByTimeAsync(15_800);
    expect(fetchMock).toHaveBeenCalledTimes(2);                 // 16s 档未到（t=27910）
    await vi.advanceTimersByTimeAsync(200);                     // t=28110：tick③
    expect(fetchMock).toHaveBeenCalledTimes(3);                 // 下一档 32 帽 30s（due=58010；未帽=60010）
    await vi.advanceTimersByTimeAsync(29_800);
    expect(fetchMock).toHaveBeenCalledTimes(3);                 // t=57910：帽 30 档未到（due=58010；两世界皆绿——非判别点）
    await vi.advanceTimersByTimeAsync(200);                     // t=58110：tick④——帽 30 生效判别点（未帽 due=60010→仍 3 次，红）
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(29_800);
    expect(fetchMock).toHaveBeenCalledTimes(4);                 // t=87910：帽保持 30s（due=88010）
    await vi.advanceTimersByTimeAsync(200);                     // t=88110：tick⑤
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // m2 转 processing（集合新成员）→重置回首档 4s（零新见引用——无 lazy 队列干扰，纯调度点）
    const facts = useNodeStore.getState().mediaFacts;
    useNodeStore.setState({ mediaFacts: new Map([...facts, ['m2', fact('1', 'processing')]]) });
    onDocRefsChanged(doc);                                     // ②尾挂调度点（fresh 空——零 lazy 拉取；due=92110）
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(3_900);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);                     // t=92210：重置首档到点
    const ids = fetchMock.mock.calls.at(-1)?.[0] as string[];
    expect(ids.slice().sort()).toEqual(['m1', 'm2']);
  });

  it('停止条件：doc 引用集中无 processing（引用媒体 completed）→零 watcher 拉取', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'completed')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    onDocRefsChanged(doc);                                     // 调度点现取——引用集∩processing=∅
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('项目切换丢弃：watcher 拉取在飞时 resetMediaFacts →响应到达不 ingest+不再调度', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);

    let resolveFetch!: (v: unknown) => void;                   // watcher 轮次在飞（fetch 挂起）
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() => new Promise((res) => { resolveFetch = res; }));
    await vi.advanceTimersByTimeAsync(4_200);                  // t=4210——轮次到点发起拉取（due=4010）
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetMediaFacts();                                         // 切项目——会话纪元自增
    resolveFetch([stateRow('m1', '2', 'completed')]);          // 旧会话响应迟到
    await vi.advanceTimersByTimeAsync(10);
    expect(useNodeStore.getState().mediaFacts.size).toBe(0);   // 零写入（不 ingest）

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();                  // 不再调度
  });

  it('仅当前引用：store 有 processing fact 但 doc 已不引用该 mediaId →不拉', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'completed')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    useNodeStore.setState({ mediaFacts: new Map([['m-gone', fact('0', 'processing')]]) });
    onDocRefsChanged(doc);                                     // m-gone 不在引用集——拉取集空
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ═══ 双评审收口（P1/P2-1/P2-2/P2-3/护栏补齐） ═══

  it('P1：destroyCollab（teardownSession 清理链）后 watcher 停——离画布零后台续拉', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);                     // watcher {m1} 运行中（自续排定时器在途）

    await destroyCollab();                                     // 离开画布/登出——teardown 清理链（旧实现漏 resetMediaFacts：红）
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(120_000);                // 跨多个 30s 帽周期——旧实现后台续拉永续（红）
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useNodeStore.getState().mediaFacts.size).toBe(0);   // 会话态全清（消费 Map+pending+lazy+watcher）
  });

  it('P2-1 活引用集：本地新增引用（零驱动调用——LOCAL_ORIGINS 盲窗）下一轮即携新成员（欠拉消除）', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);                     // watcher {m1}（轮①due=4010）

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(4_200);                  // t=4210：轮①（空响应）→同集翻倍 8s（due=12010）
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 本地 origin 引用写：yjs 自身 update 不回环 onRemote——②驱动不触发（快照实现盲窗窗体）
    const n2 = new Y.Map();
    const d2 = new Y.Map();
    d2.set('referenceVideo', 'm2');
    n2.set('type', 'videoGen');
    n2.set('data', d2);
    doc.getMap('nodes').set('n2', n2);
    useNodeStore.setState({ mediaFacts: new Map([...useNodeStore.getState().mediaFacts, ['m2', fact('0', 'processing')]]) });

    await vi.advanceTimersByTimeAsync(7_700);                  // t=11910（due-100）：零新拉
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);                    // t=12110：轮②——活引用集现取
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls.at(-1)?.[0] as string[]).slice().sort()).toEqual(['m1', 'm2']);   // 快照实现=仍只拉 m1（红）
  });

  it('P2-1 活引用集：本地删引用（零驱动调用）后下一轮不再携该成员（过拉消除）', async () => {
    const doc = makeRefVideoDoc('m1', 'm2');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing'), stateRow('m2', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);                     // watcher {m1,m2}

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(4_200);                  // 轮①携 {m1,m2}
    expect((fetchMock.mock.calls.at(-1)?.[0] as string[]).slice().sort()).toEqual(['m1', 'm2']);

    doc.getMap('nodes').delete('n2');                          // 本地删引用（盲窗——快照仍含 m2）
    await vi.advanceTimersByTimeAsync(7_700);                  // t=11910（due-100）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);                    // 轮②——活引用集 {m1}
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls.at(-1)?.[0] as string[]).slice().sort()).toEqual(['m1']);   // 快照实现=仍携 m2（红）
  });

  it('P2-2/P2-3：在飞轮次内集合变化——在飞期零二排（单轮单拉）；轮尾带新集合回首档不跳档', async () => {
    const doc = makeRefVideoDoc('m1', 'm2');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing'), stateRow('m2', '0', 'completed')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);                     // watcher {m1}（due=4010）

    let resolveWatch!: (v: unknown) => void;                   // 轮①在飞（慢 fetch 挂起）
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() => new Promise((res) => { resolveWatch = res; }));
    await vi.advanceTimersByTimeAsync(4_200);                  // t=4210：轮①发起（在飞）
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 在飞窗内 m2 转 processing（集合变化）——在飞期零 arm（旧实现 changed 分支 arm@4s→下窗双轮并发：红）
    useNodeStore.setState({ mediaFacts: new Map([...useNodeStore.getState().mediaFacts, ['m2', fact('1', 'processing')]]) });
    onDocRefsChanged(doc);                                     // 调度点（fresh 空——零 lazy 干扰）
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(30_000);                 // 悬置 30s——仍单轮在飞零新拉
    expect(fetchMock).not.toHaveBeenCalled();

    resolveWatch([]);                                          // 轮①尾：带新集合重排回首档 4s
    await vi.advanceTimersByTimeAsync(10);                     // flush 轮尾续排（due≈34220+4000）
    await vi.advanceTimersByTimeAsync(3_900);
    expect(fetchMock).not.toHaveBeenCalled();                  // 首档 4s 未到
    await vi.advanceTimersByTimeAsync(200);
    expect((fetchMock.mock.calls.at(-1)?.[0] as string[]).slice().sort()).toEqual(['m1', 'm2']);

    // 不跳档：下一轮 8s（P2-2——旧实现轮尾对已重置档位再翻倍→16s，8s 档零拉：红）
    await vi.advanceTimersByTimeAsync(7_700);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);                // 8s 档到点（若 16s 档则此处仍 1——红）
  });

  it('在飞轮次内同集合同步 ingest——不二排不双拉（轮尾单续 8s 档）', async () => {
    const doc = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);

    let resolveWatch!: (v: unknown) => void;                   // 轮①在飞（慢 fetch 挂起）
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() => new Promise((res) => { resolveWatch = res; }));
    await vi.advanceTimersByTimeAsync(4_200);                  // t=4210：轮①发起
    // 同集合同步 ingest（「刷新状态」按钮路径——等值重放：集合不变）：在飞期零 arm
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsForIds(['m1']);
    await vi.advanceTimersByTimeAsync(10);                     // 按钮 ingest 完成（调度→在飞不改排）
    resolveWatch([]);                                          // 轮①尾：同集→翻倍 8s 续排
    await vi.advanceTimersByTimeAsync(10);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(7_900);                  // 8s 档 due-100 前（若在飞窗二排@4s 此窗已拉：红）
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);                // 8s 档单轮——节奏未被打断
  });

  it('epoch 判别（P3-3）：新会话建立后旧响应到达——旧版本 fact 不入新 store（直钉非 pending 路径）', async () => {
    const doc1 = makeRefVideoDoc('m1');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc1);
    await vi.advanceTimersByTimeAsync(10);

    let resolveOld!: (v: unknown) => void;                     // 旧会话 watcher 轮在飞
    fetchMock.mockClear();
    fetchMock.mockImplementationOnce(() => new Promise((res) => { resolveOld = res; }));
    await vi.advanceTimersByTimeAsync(4_200);

    resetMediaFacts();                                         // 切项目（纪元++）
    const doc2 = makeRefVideoDoc('m1');                        // 新会话同 mediaId 新引用
    fetchMock.mockResolvedValueOnce([stateRow('m1', '1', 'processing')]);
    pullMediaFactsFull(doc2);
    await vi.advanceTimersByTimeAsync(10);
    expect(useNodeStore.getState().mediaFacts.get('m1')?.factVersion).toBe('1');

    resolveOld([stateRow('m1', '9', 'completed')]);            // 旧会话 v9 迟到——无守卫则新 doc 已引用 m1→直入覆盖（红）
    await vi.advanceTimersByTimeAsync(10);
    const entry = useNodeStore.getState().mediaFacts.get('m1');
    expect(entry?.factVersion).toBe('1');                      // v9 弃（守卫先于 ingest）
    expect(entry?.state).toBe('processing');
  });

  it('完全停止后新 processing 到达——确定重启（P3-4 专项）', async () => {
    const doc = makeRefVideoDoc('m1', 'm2');
    fetchMock.mockResolvedValueOnce([stateRow('m1', '0', 'processing')]);
    pullMediaFactsFull(doc);
    await vi.advanceTimersByTimeAsync(10);
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce([stateRow('m1', '1', 'completed')]);
    await vi.advanceTimersByTimeAsync(4_200);                  // m1 completed→watcher 全停（watchIds 空/档位 null）
    expect(useNodeStore.getState().mediaFacts.get('m1')?.state).toBe('completed');

    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce([stateRow('m2', '0', 'processing')]);
    pullMediaFactsForIds(['m2']);                              // 新 processing 经 ingest 调度点到达（doc 已引用 m2）
    await vi.advanceTimersByTimeAsync(10);
    expect(useNodeStore.getState().mediaFacts.get('m2')?.state).toBe('processing');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(3_900);                  // 重启首档 4s 未到
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);                // 重启确定生效
    expect((fetchMock.mock.calls.at(-1)?.[0] as string[]).slice().sort()).toEqual(['m2']);
  });
});
