// apps/web/src/stores/runtimeStore.d1.spec.ts —— Y3 Task 6（spec §3 D1：余额信号恰一次）。
// 先红→绿。断言分组（对应 plan 钉死的七断言①-⑤与调用点实证）：
// ①init 零派发：initRuntimeFeed 首次快照（'init'）不发 credits:update（负控——红判别力由
//   源码调用点断言承载：修前 init 调用点不传 'init'）。
// ②四回落各一次：游标低水位/historyId 不符/doc.vacuumed/缺口——各恰一次 'resync' 派发（detail 空）。
// ③增量整批一次：终态标记跨轮累加、一次函数调用只派发一次（多轮合成+轮次用尽两形态）；
//   触发档位=exec.status done/error 或 exec.artifact；loading/skipped/删除/换代不触发。
// ④缺口转快照被弃批不另算：只由该次 'resync' 派发、被弃批内终态不追加、标记清掉。
// ⑤loading/skipped 不触发（全 loading 批追平零派发——负控）。
// ⑥⑦（silent 三不改+旧响应迟归不覆盖）见 creditsStore.test.ts；CanvasTopBar 空事件收号见
//   CanvasTopBar.test.tsx。
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchRuntimeSnapshot, initRuntimeFeed, resetRuntimeFeed, syncRuntimeFeed,
  runtimeFeedFetchers, setRuntimeIdbEnabled, useRuntimeFeedStore,
} from './runtimeStore';
import type { RuntimeEventWireRow } from './runtimeFeedTypes';

const proj0 = { projectId: 'p1', generation: 0, feedSeq: '0', pgSeq: '0', nodes: {} };

const snapEnvelop = (feedSeq: string) => ({
  snapshot: { ...proj0, feedSeq }, cursor: { historyId: 'h', generation: 0, feedSeq },
  minRetainedSeq: '0', historyId: 'h',
});

const ev = (feedSeq: string, payload: Record<string, unknown>, kind: string): RuntimeEventWireRow =>
  ({ id: `e${feedSeq}`, feedSeq, generation: 0, kind, payload: { v: 1, ...payload }, docSeq: null, createdAtMs: 0 });

const status = (feedSeq: string, st: string): RuntimeEventWireRow =>
  ev(feedSeq, { kind: 'exec.status', nodeId: `n${feedSeq}`, status: st, attempts: 0, nodeVersion: feedSeq }, 'exec.status');

/** 逐用例挂 credits:update 监听（afterEach 统一摘除——顺序断言不受串扰）。 */
const activeHandlers: Array<(e: Event) => void> = [];
function creditsListener(): { calls: unknown[] } {
  const calls: unknown[] = [];
  const h = (e: Event): void => { calls.push((e as CustomEvent).detail); };
  activeHandlers.push(h);
  window.addEventListener('credits:update', h);
  return { calls };
}

const seedCursor = (feedSeq: string, minRetainedSeq = '0') => {
  useRuntimeFeedStore.setState({
    projectId: 'p1', cursor: { historyId: 'h', generation: 0, feedSeq },
    minRetainedSeq, projection: { ...proj0, feedSeq }, fetchedAtMs: Date.now(), syncing: false,
  });
};

describe('Y3 Task6 D1：余额信号恰一次（runtimeStore 派发面）', () => {
  beforeEach(() => {
    resetRuntimeFeed();
    runtimeFeedFetchers.snapshot = null;
    runtimeFeedFetchers.events = null;
    setRuntimeIdbEnabled(false);   // init 档不触 IDB（jsdom 无实现——持久化语义不进本批判据）
  });
  afterEach(() => {
    runtimeFeedFetchers.snapshot = null;
    runtimeFeedFetchers.events = null;
    for (const h of activeHandlers) window.removeEventListener('credits:update', h);
    activeHandlers.length = 0;
  });

  it('①init 零派发：initRuntimeFeed 首连恒快照（传 init）不发 credits:update', async () => {
    const { calls } = creditsListener();
    runtimeFeedFetchers.snapshot = vi.fn(async () => snapEnvelop('0'));
    await initRuntimeFeed('p1');
    expect(calls).toEqual([]);   // 负控（红判别力由「五调用点实证」的 init 计数承载）
  });

  it('①类型面：fetchRuntimeSnapshot 用途参数必填无默认——缺参调用编译期拒收', async () => {
    // @ts-expect-error purpose 必填（实现后此处必有错=tsc 门过；若日后加默认值则本行变未用豁免=tsc 门红）
    await fetchRuntimeSnapshot('p1');
  });

  it('②回落×游标低于水位：resync 恰派发一次（detail 空）', async () => {
    const { calls } = creditsListener();
    const snap = vi.fn(async () => snapEnvelop('9'));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => ({ events: [], latestFeedSeq: '9', minRetainedSeq: '5', historyId: 'h' })) as never;
    seedCursor('2', '5');   // cursor 2 < 水位 5——保留期已回收
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([null]);   // 修前零派发=红
  });

  it('②回落×historyId 不符：resync 恰派发一次', async () => {
    const { calls } = creditsListener();
    const snap = vi.fn(async () => ({ ...snapEnvelop('0'), historyId: 'h-new', cursor: { historyId: 'h-new', generation: 0, feedSeq: '0' } }));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => ({ events: [], latestFeedSeq: '0', minRetainedSeq: '0', historyId: 'h-new' })) as never;
    seedCursor('2');   // cursor 旧纪元 h ≠ 信封 h-new
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([null]);
  });

  it('②回落×doc.vacuumed：resync 恰派发一次（换代本身不另算）', async () => {
    const { calls } = creditsListener();
    const snap = vi.fn(async () => snapEnvelop('9'));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => ({
      events: [ev('3', { v: 1, kind: 'doc.vacuumed', generation: 0 }, 'doc.vacuumed')],
      latestFeedSeq: '3', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    seedCursor('2');
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([null]);
  });

  it('②回落×缺口：resync 恰派发一次', async () => {
    const { calls } = creditsListener();
    const snap = vi.fn(async () => snapEnvelop('9'));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => ({
      events: [status('5', 'done')],   // 缺 3、4
      latestFeedSeq: '5', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    seedCursor('2');
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([null]);
  });

  it('②resync 直调：fetchRuntimeSnapshot(p1, resync) 派发一次', async () => {
    const { calls } = creditsListener();
    runtimeFeedFetchers.snapshot = vi.fn(async () => snapEnvelop('9'));
    await fetchRuntimeSnapshot('p1', 'resync');
    expect(calls).toEqual([null]);
  });

  it('③档位：同批 loading/skipped/删除零信号、done/error/exec.artifact 合成一次', async () => {
    const { calls } = creditsListener();
    runtimeFeedFetchers.events = vi.fn(async () => ({
      events: [
        status('1', 'loading'),
        status('2', 'skipped'),
        ev('3', { kind: 'node.deleted', nodeId: 'nx', lifecycleSeq: '1', nodeVersion: '3' }, 'node.deleted'),
        status('4', 'done'),
        status('5', 'error'),
        ev('6', { kind: 'exec.artifact', nodeId: 'n6', mediaId: 'm1', artifactRev: 1, nodeVersion: '6' }, 'exec.artifact'),
      ],
      latestFeedSeq: '6', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    seedCursor('0');
    await syncRuntimeFeed();
    expect(calls).toEqual([null]);   // 三触发档同批只派发一次（修前零派发=红）
  });

  it('③多轮合成：终态标记跨轮累加、一次函数调用只派发一次（两轮三终态）', async () => {
    const { calls } = creditsListener();
    let round = 0;
    const batches: RuntimeEventWireRow[][] = [
      [status('1', 'done'), status('2', 'done')],   // 第一轮两个终态、latest=3 未追平
      [status('3', 'done')],                          // 第二轮又一终态、追平
    ];
    runtimeFeedFetchers.events = vi.fn(async () => {
      const events = batches[Math.min(round, batches.length - 1)]!;
      const env = { events, latestFeedSeq: round === 0 ? '3' : '3', minRetainedSeq: '0', historyId: 'h' };
      round += 1;
      return env;
    }) as never;
    seedCursor('0');
    await syncRuntimeFeed();
    expect(round).toBe(2);
    expect(calls).toEqual([null]);   // 三条 done 跨两轮只派发一次（修前零派发=红）
  });

  it('③轮次用尽（10 轮未追平）同样结束时恰一次派发', async () => {
    const { calls } = creditsListener();
    let round = 0;
    runtimeFeedFetchers.events = vi.fn(async () => {
      round += 1;
      return { events: [status(String(round), 'done')], latestFeedSeq: String(round + 1), minRetainedSeq: '0', historyId: 'h' };
    }) as never;
    seedCursor('0');
    await syncRuntimeFeed();
    expect(round).toBe(10);   // 每轮 latest 恒高于 applied——10 轮用尽
    expect(calls).toEqual([null]);
  });

  it('④缺口转快照被弃批不另算：只由该次 resync 派发一次（批内 done 不追加）', async () => {
    const { calls } = creditsListener();
    const snap = vi.fn(async () => snapEnvelop('9'));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => ({
      events: [status('5', 'done')],   // 缺 3、4——整批被弃
      latestFeedSeq: '5', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    seedCursor('2');
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([null]);
  });

  it('④前轮累加的终态标记随中途快照清掉：后续纯 loading 增量零追加派发', async () => {
    const { calls } = creditsListener();
    let phase = 0;
    const snap = vi.fn(async () => snapEnvelop('9'));
    runtimeFeedFetchers.snapshot = snap as never;
    runtimeFeedFetchers.events = vi.fn(async () => {
      if (phase === 0) return { events: [status('5', 'done')], latestFeedSeq: '5', minRetainedSeq: '0', historyId: 'h' };   // gap 页含终态→快照弃批
      return { events: [status('10', 'loading')], latestFeedSeq: '10', minRetainedSeq: '0', historyId: 'h' };
    }) as never;
    seedCursor('2');
    await syncRuntimeFeed();
    expect(calls).toEqual([null]);   // resync 一次
    phase = 1;
    seedCursor('9');   // 快照统一 cursor 后纯 loading 增量
    await syncRuntimeFeed();
    expect(snap).toHaveBeenCalledTimes(1);   // 第二段零快照回落
    expect(calls).toEqual([null]);   // 标记已清——零追加
  });

  it('⑤负控：全 loading 增量追平零派发（loading/skipped 不触发）', async () => {
    const { calls } = creditsListener();
    runtimeFeedFetchers.events = vi.fn(async () => ({
      events: [status('1', 'loading'), status('2', 'loading')],
      latestFeedSeq: '2', minRetainedSeq: '0', historyId: 'h',
    })) as never;
    seedCursor('0');
    await syncRuntimeFeed();
    expect(calls).toEqual([]);   // 负控（修前同绿——红判别力由②③④承载）
  });
});

describe('Y3 Task6 D1：五调用点实证（init 一+回落四——用途参数化后恰五）', () => {
  it('fetchRuntimeSnapshot 生产调用点恰五：initRuntimeFeed 一 + syncRuntimeFeed 回落四，全带用途参数', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/stores/runtimeStore.ts'), 'utf8');   // vitest cwd=apps/web（jsdom 重写 import.meta.url 不可直读）
    const callLines = src.split('\n').filter((l) => l.includes('fetchRuntimeSnapshot(') && !l.includes('function fetchRuntimeSnapshot('));
    expect(callLines).toHaveLength(5);   // 修前：initRuntimeFeed 一处不带 'init'+回落四处不带 'resync'（红）
    expect(callLines.filter((l) => l.includes("'init'"))).toHaveLength(1);
    expect(callLines.filter((l) => l.includes("'resync'"))).toHaveLength(4);
    expect(callLines.filter((l) => l.includes("'init'") || l.includes("'resync'"))).toHaveLength(5);   // 无裸调用
  });
});
