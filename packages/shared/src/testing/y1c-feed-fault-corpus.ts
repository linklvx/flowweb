// packages/shared/src/testing/y1c-feed-fault-corpus.ts
// Y1c T5b：feed 故障语料（plan v1.7 Task 5/T5b——spec §7；形态对照 testing/y1c-wal-fault-corpus.ts）。
// **声明式**（事件流输入+客户端 cursor+期望处置）——T22（feed 投递/reducer）/T31（故障演练）消费；
// 本语料不持 reducer 实现（消费卡实现后按 expect 逐条对账）。
// 六形态：乱序到达（升序应用+去重）/缺口（从 cursor 重取）/旧代（隔离不崩）/游标失效两档
// （historyId 不匹配→全量快照+清投影；cursor<minRetainedSeq→全量快照）/feedSeq 提交顺序交错
// （锁内分配=分配序≡提交序——读者永不见假缺口）/反向锁序负控（40P01 受控死锁——heavy 不进 PR）。
import type { RuntimeEventKind, RuntimeEventPayload } from '../collab/runtime-event';

/** 事件 fixture（物化行面——payload v:1 形状由类型收编） */
export interface FeedEventFixture {
  feedSeq: bigint;
  generation: number;
  kind: RuntimeEventKind;
  payload: RuntimeEventPayload;
  /** 事件对应的 pgSeq 下界（缺省=不携带——应用规则归 T22 reducer） */
  docSeq?: bigint;
}

/** 客户端 cursor 三元（v5.4⑦——historyId/generation/feedSeq；BigInt wire string 化） */
export interface FeedCursorFixture {
  historyId: string;
  generation: number;
  feedSeq: bigint;
}

/** 期望客户端处置（verdict 收敛枚举——T22 reducer 对账面） */
export type FeedFaultVerdict =
  /** 乱序/重复到达→升序应用+按 (projectId,feedSeq) 去重（applied=去重后升序清单） */
  | { verdict: 'apply-ascending'; applied: bigint[] }
  /** 返回不连续=缺口→从 cursor 重取（再不连续→全量快照——reducer 两段式归 T22） */
  | { verdict: 'gap-refetch-from-cursor' }
  /** 旧 generation 事件隔离（不应用不崩；feedSeq 跨代不重置故按 generation 过滤） */
  | { verdict: 'isolate-stale-generation' }
  /** cursor.historyId≠当前 SystemHistory→全量快照+清投影（minRetainedSeq 仅同 historyId 内有效） */
  | { verdict: 'full-snapshot-history-mismatch' }
  /** cursor<minRetainedSeq 或保留期已过→全量快照 */
  | { verdict: 'full-snapshot-cursor-expired' }
  /** 提交顺序交错：upsert 行锁持有至提交⇒分配序≡提交序——读者永不见「后号已提交前号未提交」假缺口 */
  | { verdict: 'no-gap-locked-allocation' }
  /** 反向锁序负控（counter→业务行）：期望 40P01 死锁检测——受控死锁用例标 heavy 不进 PR */
  | { verdict: 'deadlock-negative-control-heavy' };

export interface FeedFaultCase {
  name: string;
  /** 到达序事件流（物化序——乱序/重复由列表次序自身表达） */
  events: FeedEventFixture[];
  cursor: FeedCursorFixture;
  /** 服务端当前 SystemHistory.historyId（首连 RR 快照回执值——cursor 比对基准） */
  historyId: string;
  minRetainedSeq: bigint;
  expect: FeedFaultVerdict;
  /** heavy 档（受控死锁——不进 PR 常规验证；静态锁序 lint+正常序压力替代） */
  heavy?: boolean;
  /** 场景注记（交错/负控的时序描述） */
  note?: string;
}

const statusPayload = (feedSeq: bigint, nodeVersion: string): RuntimeEventPayload => ({
  v: 1, kind: 'exec.status', nodeId: 'node-a', status: 'SUCCEEDED', attempts: 1, nodeVersion,
});
const tombstonePayload = (lifecycleSeq: string, nodeVersion: string): RuntimeEventPayload => ({
  v: 1, kind: 'node.deleted', nodeId: 'node-b', lifecycleSeq, nodeVersion,
});
const vacuumedPayload = (generation: number): RuntimeEventPayload => ({ v: 1, kind: 'doc.vacuumed', generation });

const event = (feedSeq: bigint, generation: number, payload: RuntimeEventPayload): FeedEventFixture => ({
  feedSeq, generation, kind: payload.kind, payload, docSeq: feedSeq + 100n,
});

/** feed 故障语料全集（确定性——无 Date.now/随机；期望处置与 spec §7 逐条对齐） */
export function buildFeedFaultCorpus(): FeedFaultCase[] {
  const cursor = (over: Partial<FeedCursorFixture> = {}): FeedCursorFixture => ({
    historyId: 'h-2026-10-24-a', generation: 3, feedSeq: 0n, ...over,
  });
  return [
    {
      name: '乱序到达+重复（fetch 批 [3,1,2,1]）→升序应用+按 (projectId,feedSeq) 去重',
      events: [
        event(3n, 3, statusPayload(3n, '3')),
        event(1n, 3, statusPayload(1n, '1')),
        event(2n, 3, statusPayload(2n, '2')),
        event(1n, 3, statusPayload(1n, '1')),   // 重复帧（重试重发）
      ],
      cursor: cursor(), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'apply-ascending', applied: [1n, 2n, 3n] },
      note: '两通道（hint/心跳）都不交付数据只有 cursor 有序——到达序无关紧要，应用序只认 feedSeq 升序',
    },
    {
      name: '缺口（cursor=3 后返回 [5,6] 缺 4）→从 cursor 重取（再不连续→全量快照）',
      events: [event(5n, 3, statusPayload(5n, '5')), event(6n, 3, statusPayload(6n, '6'))],
      cursor: cursor({ feedSeq: 3n }), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'gap-refetch-from-cursor' },
      note: '返回不连续=缺口——GET after=cursor 重取；通知在业务事务提交后发故「查不到≠缺口」（重试即可）',
    },
    {
      name: '旧代（generation 2 事件抵达 cursor generation 3）→隔离不崩（feedSeq 跨代不重置故按 generation 过滤）',
      events: [event(9n, 2, statusPayload(9n, '9')), event(10n, 2, tombstonePayload('4', '10'))],
      cursor: cursor({ feedSeq: 8n }), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'isolate-stale-generation' },
    },
    {
      name: '游标失效（historyId 不匹配——PITR 后旧 cursor）→全量快照+清投影',
      events: [event(1n, 3, vacuumedPayload(3))],
      cursor: cursor({ historyId: 'h-2026-01-01-old', feedSeq: 5n }), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'full-snapshot-history-mismatch' },
      note: 'minRetainedSeq 仅同 historyId 内有效——跨 epoch 游标一律全量；snapshot=全量替换+统一 cursor',
    },
    {
      name: '游标过期（cursor=2 < minRetainedSeq=5）→全量快照',
      events: [event(7n, 3, statusPayload(7n, '7'))],
      cursor: cursor({ feedSeq: 2n }), historyId: 'h-2026-10-24-a', minRetainedSeq: 5n,
      expect: { verdict: 'full-snapshot-cursor-expired' },
      note: '保留期 7 天或 100k 条/项目先到为准——清理 worker 已回收 cursor 之前的事件',
    },
    {
      name: 'feedSeq 提交顺序交错（T1 分配 3 持锁未提交，T2 排队等锁）→T1 提交后 T2 才见 4——读者永不见假缺口',
      events: [event(1n, 3, statusPayload(1n, '1')), event(2n, 3, statusPayload(2n, '2')),
        event(3n, 3, statusPayload(3n, '3')), event(4n, 3, statusPayload(4n, '4'))],
      cursor: cursor(), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'no-gap-locked-allocation' },
      note: 'upsert 行锁持有至提交⇒分配序=提交序（游标推进不漏未提交事件）；无锁分配反例=读者见 [..,4] 缺 3 假缺口',
    },
    {
      name: '反向锁序负控（先 UPDATE RuntimeFeedCursor 再锁业务行——违反「业务行→counter」）→期望 40P01',
      events: [event(1n, 3, statusPayload(1n, '1'))],
      cursor: cursor(), historyId: 'h-2026-10-24-a', minRetainedSeq: 0n,
      expect: { verdict: 'deadlock-negative-control-heavy' },
      heavy: true,
      note: '受控死锁用例标 heavy 不进 PR——常规避证=静态锁序 lint+正常序压力（N 次无 40P01）+「去 counter」负控（期望重复/缺口）',
    },
  ];
}
