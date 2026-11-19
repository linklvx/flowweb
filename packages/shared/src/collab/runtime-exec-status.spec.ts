// packages/shared/src/collab/runtime-exec-status.spec.ts
// Y3 Task 1（plan 2026-11-19-y3-protocol-retirement 第一笔——spec §3 S2/词表表）：shared 组装器+
// 投影函数+封闭句常量的契约测试。先红→绿。
// - assembleExecStatusPayload：允许键恰八（status/attempts/execSeq/errorCode/artifactRev/
//   intentId/rearmable/error）；必填键定死（status 抛错档/attempts 恒写/execSeq 十进制 string 档）；
//   error 封闭句等值检查（表内原样/表外整段「生成失败」不截断）。
// - feedError：Feed error 唯一出口——rearmable 按码与有无行（无行 false 不写身份键/
//   TEXT_PROVIDER_UNKNOWN 恒 true/其余 attempts<3）。
// - FEED_SENTENCES：封闭句表单源（TEXT_UNKNOWN_HELD/UNMARKED、REAPER 两句、EDIT_FAILED、
//   EXEC_GENERIC、FUNDS_HELD、扣费五码、EXEC_DEADLINE、PLAN_MISSING、FROZEN_INPUT_MISSING）。
// - execStatusSlotOfPayload：payload→Fact 八键+nodeVersion；缺合法 nodeVersion→null。
// - 受理四档联合类型：replayed:false/delivered/voided/deduped 形状。
// - mergeSlot execStatus execSeq 代际规则：两边都有十进制 execSeq 大者胜（BigInt 非字符串——
//   "10" vs "9"）；相同比 nodeVersion；任一边缺仍只比 nodeVersion（execStatus 槽专用）。
import { describe, expect, it } from 'vitest';
import {
  FEED_SENTENCES, FeedSentenceId, FeedIntentRow, assembleExecStatusPayload, execStatusSlotOfPayload,
  feedError, reserveFailSentence, ExecStatusPayloadPatch, AdmissionOutcome,
} from './runtime-exec-status';
import { RuntimeProjection, mergeRuntimeProjection } from './runtime-projection';

// ── fixture：意图行最小接口（GenerationIntent 消费面列型——execSeq=BigInt wire 消费侧 string）═══
const row = (over: Partial<FeedIntentRow> = {}): FeedIntentRow => ({
  intentId: 'intent-token-1', attempts: 2, execSeq: 42n, ...over,
});

describe('Y3 Task1 契约冻结：assembleExecStatusPayload（八键恰+必填键定死+封闭句等值检查）', () => {
  it('① 八键全值载荷恰含八键（fileId/jobId/reason/nodeVersion/v/kind 传入也不出现）', () => {
    const p = assembleExecStatusPayload({
      status: 'error', attempts: 2, execSeq: '42', errorCode: 'CREDIT_INSUFFICIENT',
      artifactRev: 3, intentId: 'intent-token-1', rearmable: true, error: '积分不足',
      // 全部禁写键——传入也不得出现
      fileId: 'f1', jobId: 'j1', reason: 'NODE_BUSY', nodeVersion: '99', v: 1, kind: 'exec.status',
    } as ExecStatusPayloadPatch);
    expect(Object.keys(p).sort()).toEqual(
      ['artifactRev', 'attempts', 'error', 'errorCode', 'execSeq', 'intentId', 'rearmable', 'status'],
    );
    expect(p).toEqual({
      status: 'error', attempts: 2, execSeq: '42', errorCode: 'CREDIT_INSUFFICIENT',
      artifactRev: 3, intentId: 'intent-token-1', rearmable: true, error: '积分不足',
    });
  });

  it('② 必填键档：status 空串/非字符串→抛错；attempts 缺→0 始终在；execSeq 数字/非十进制串→键不出现', () => {
    expect(() => assembleExecStatusPayload({ status: '', attempts: 1 })).toThrow();
    expect(() => assembleExecStatusPayload({ status: 42 as unknown as string, attempts: 1 })).toThrow();
    // attempts 缺→0 且始终写入（最小载荷两键）
    expect(assembleExecStatusPayload({ status: 'loading' })).toEqual({ status: 'loading', attempts: 0 });
    // attempts 非有限数字（NaN/Infinity）→0 档
    expect(assembleExecStatusPayload({ status: 'loading', attempts: Number.NaN })).toEqual({ status: 'loading', attempts: 0 });
    // execSeq 仅 /^\d+$/ 字符串才写入——数字/非十进制串一律不出现（wire 纪律 BigInt 一律 string）
    expect(assembleExecStatusPayload({ status: 'loading', attempts: 1, execSeq: 9 as unknown as string }))
      .toEqual({ status: 'loading', attempts: 1 });
    expect(assembleExecStatusPayload({ status: 'loading', attempts: 1, execSeq: '9x' }))
      .toEqual({ status: 'loading', attempts: 1 });
    expect(assembleExecStatusPayload({ status: 'loading', attempts: 1, execSeq: '' }))
      .toEqual({ status: 'loading', attempts: 1 });
  });

  it('③ error 封闭句等值检查：表内「积分不足」原样通过／表外任意句整段换「生成失败」（不截断）／非字符串与空白→键不存在', () => {
    // 表内句原样通过
    expect(assembleExecStatusPayload({ status: 'error', attempts: 1, error: '积分不足' }).error).toBe('积分不足');
    // 表外任意句——URL/超长/长前缀+尾部 URL——全档整段换「生成失败」（不截断不保留残段）
    for (const bad of ['see https://x', '好'.repeat(300), 'x'.repeat(210) + ' https://evil']) {
      const p = assembleExecStatusPayload({ status: 'error', attempts: 1, error: bad });
      expect(p.error).toBe('生成失败');
      expect((p.error as string).length).toBe('生成失败'.length);   // 不截断——整段替换非前缀保留
    }
    // 非字符串与空白→键不存在
    expect('error' in assembleExecStatusPayload({ status: 'error', attempts: 1 })).toBe(false);
    expect('error' in assembleExecStatusPayload({ status: 'error', attempts: 1, error: 123 as unknown as string })).toBe(false);
    expect('error' in assembleExecStatusPayload({ status: 'error', attempts: 1, error: '   ' })).toBe(false);
    // 首尾空白 trim 后等值表内句→原样通过（trim 档）
    expect(assembleExecStatusPayload({ status: 'error', attempts: 1, error: ' 积分不足 ' }).error).toBe('积分不足');
  });

  it('⑦ 禁写键全档不出现：fileId/jobId/reason/nodeVersion/v/kind（七组独立负控）', () => {
    const p = assembleExecStatusPayload({
      status: 'done', attempts: 1, fileId: 'f', jobId: 'j', reason: 'r', nodeVersion: '7', v: 2, kind: 'x',
    } as ExecStatusPayloadPatch);
    expect(Object.keys(p).sort()).toEqual(['attempts', 'status']);
  });
});

describe('Y3 Task1 契约冻结：FEED_SENTENCES 封闭句表+feedError（Feed error 唯一出口）', () => {
  it('⑤ 句子 id 全枚举断言+五码词表逐字+未命中码兜底（reserveFailSentence）', () => {
    // 封闭句表 id 集（closed——spec §3 词表表+reaper 两句+EXEC_DEADLINE）
    expect(Object.keys(FEED_SENTENCES).sort()).toEqual([
      'CREDIT_INSUFFICIENT', 'EDIT_FAILED', 'EXEC_DEADLINE', 'EXEC_GENERIC', 'FROZEN_INPUT_MISSING',
      'FUNDS_HELD', 'NOT_MEMBER', 'PLAN_MISSING', 'QUOTA_EXCEEDED', 'REAPER_DEADLINE', 'REAPER_STALE',
      'RESERVE_GATE_LOST', 'TEAM_BALANCE_MISSING', 'TEXT_UNKNOWN_HELD', 'TEXT_UNKNOWN_UNMARKED',
    ]);
    // 扣费五码逐字（controller ruling：grep 现有词表逐字搬——spec 表四句+兜底句）
    expect(FEED_SENTENCES.CREDIT_INSUFFICIENT).toBe('积分不足');
    expect(FEED_SENTENCES.QUOTA_EXCEEDED).toBe('本月额度已用尽');
    expect(FEED_SENTENCES.NOT_MEMBER).toBe('不在该团队，无法扣费');
    expect(FEED_SENTENCES.TEAM_BALANCE_MISSING).toBe('团队积分账户不存在');
    expect(FEED_SENTENCES.RESERVE_GATE_LOST).toBe('扣费失败，请重试');
    // 其余句子逐字（spec 表+现句迁移）
    expect(FEED_SENTENCES.EDIT_FAILED).toBe('AI 处理失败');
    expect(FEED_SENTENCES.EXEC_GENERIC).toBe('生成失败');
    expect(FEED_SENTENCES.FUNDS_HELD).toBe('生成结果暂缓交付（资金核销异常，待对账处理）');
    expect(FEED_SENTENCES.EXEC_DEADLINE).toBe('生成已被系统回收（超时）——产物未投递');
    expect(FEED_SENTENCES.PLAN_MISSING).toBe('节点缺少定价快照');
    expect(FEED_SENTENCES.FROZEN_INPUT_MISSING).toBe('节点缺少冻结输入');
    // TEXT_UNKNOWN 两句（无 err.message 前缀——封闭句正文恰此形态）
    expect(FEED_SENTENCES.TEXT_UNKNOWN_HELD).toBe('可能重复生成、不会重复扣费（请稍后查询或重试）');
    expect(FEED_SENTENCES.TEXT_UNKNOWN_UNMARKED).toBe('外呼结果不明，扣费状态待对账（请稍后查询或重试）');
    // reaper 两句维持现句（intent-reconcile.service.ts:535 逐字）
    expect(FEED_SENTENCES.REAPER_DEADLINE).toBe('生成超时已被系统回收');
    expect(FEED_SENTENCES.REAPER_STALE).toBe('生成心跳失联已被系统回收（进程/调度异常）');
    // reserveFailSentence：五码→词表句；未命中码→「扣费失败，请重试」
    expect(reserveFailSentence('CREDIT_INSUFFICIENT')).toBe('积分不足');
    expect(reserveFailSentence('QUOTA_EXCEEDED')).toBe('本月额度已用尽');
    expect(reserveFailSentence('NOT_MEMBER')).toBe('不在该团队，无法扣费');
    expect(reserveFailSentence('TEAM_BALANCE_MISSING')).toBe('团队积分账户不存在');
    expect(reserveFailSentence('RESERVE_GATE_LOST')).toBe('扣费失败，请重试');
    expect(reserveFailSentence('SOMETHING_ELSE')).toBe('扣费失败，请重试');
    expect(reserveFailSentence('RESERVE_FAILED')).toBe('扣费失败，请重试');
  });

  it('④ feedError 无行档：attempts 0+rearmable false+无 intentId/execSeq 键（八键恰）', () => {
    const p = feedError('PLAN_MISSING', 'PLAN_MISSING', null);
    expect(p).toEqual({ status: 'error', attempts: 0, errorCode: 'PLAN_MISSING', rearmable: false, error: '节点缺少定价快照' });
    expect(Object.keys(p).sort()).toEqual(['attempts', 'error', 'errorCode', 'rearmable', 'status']);
    // 无行档不写身份键——intentId/execSeq 不出现（rearmable:false 面板铸新付费手势）
    const frozen = feedError('FROZEN_INPUT_MISSING', 'FROZEN_INPUT_MISSING', null);
    expect(frozen).toEqual({ status: 'error', attempts: 0, errorCode: 'FROZEN_INPUT_MISSING', rearmable: false, error: '节点缺少冻结输入' });
  });

  it('④ 有行档 rearmable 按码：TEXT_UNKNOWN_HELD attempts=3→恒 true；EXEC_GENERIC attempts=2→true；FUNDS_HELD→false；INTENT_EXHAUSTED→false', () => {
    // TEXT_PROVIDER_UNKNOWN 恒 true（attempts=3 档也 true——UNKNOWN 不进 reaper、冻结靠同 token rearm 释放）
    const held = feedError('TEXT_PROVIDER_UNKNOWN', 'TEXT_UNKNOWN_HELD', row({ attempts: 3 }));
    expect(held.rearmable).toBe(true);
    expect(held).toEqual({
      status: 'error', attempts: 3, errorCode: 'TEXT_PROVIDER_UNKNOWN', intentId: 'intent-token-1',
      execSeq: '42', rearmable: true, error: '可能重复生成、不会重复扣费（请稍后查询或重试）',
    });
    // TEXT_UNKNOWN_UNMARKED 同恒 true
    expect(feedError('TEXT_PROVIDER_UNKNOWN', 'TEXT_UNKNOWN_UNMARKED', row({ attempts: 3 })).rearmable).toBe(true);
    // 节点执行通用失败：实际码缺省 EXECUTION_FAILED 档——attempts<3→true
    expect(feedError('EXECUTION_FAILED', 'EXEC_GENERIC', row({ attempts: 2 })).rearmable).toBe(true);
    expect(feedError('EXECUTION_FAILED', 'EXEC_GENERIC', row({ attempts: 3 })).rearmable).toBe(false);
    // 资金不变量：恒 false（重试=新代 claim 会 void 旧冻结绕过对账裁决面）
    expect(feedError('FUNDS_INVARIANT_VIOLATION', 'FUNDS_HELD', row({ attempts: 1 })).rearmable).toBe(false);
    // INTENT_EXHAUSTED：服务端上限——恒 false
    expect(feedError('INTENT_EXHAUSTED', 'EXEC_GENERIC', row({ attempts: 1 })).rearmable).toBe(false);
    // 其余有行码：attempts<3
    expect(feedError('CREDIT_INSUFFICIENT', 'CREDIT_INSUFFICIENT', row({ attempts: 2 })).rearmable).toBe(true);
    expect(feedError('CREDIT_INSUFFICIENT', 'CREDIT_INSUFFICIENT', row({ attempts: 3 })).rearmable).toBe(false);
    // REAPER 两句（事件码仍现两码——有行 attempts<3 判据同其余档）
    expect(feedError('INTENT_DEADLINE_EXCEEDED', 'REAPER_DEADLINE', row({ attempts: 1 })).error).toBe('生成超时已被系统回收');
    expect(feedError('INTENT_STALE_REAPED', 'REAPER_STALE', row({ attempts: 1 })).error).toBe('生成心跳失联已被系统回收（进程/调度异常）');
    // EXEC_DEADLINE：同码异句靠 id（事件码 INTENT_DEADLINE_EXCEEDED 不变）
    expect(feedError('INTENT_DEADLINE_EXCEEDED', 'EXEC_DEADLINE', row({ attempts: 1 })).error).toBe('生成已被系统回收（超时）——产物未投递');
  });

  it('④ 有行档身份键：intentId=行 intentId 列+execSeq=row.execSeq.toString()（attempts 行值）', () => {
    const p = feedError('CREDIT_INSUFFICIENT', 'CREDIT_INSUFFICIENT', row({ intentId: 'row-intent-x', attempts: 1, execSeq: 105n }));
    expect(p.intentId).toBe('row-intent-x');
    expect(p.execSeq).toBe('105');
    expect(p.attempts).toBe(1);
    // execSeq number/string 行型同档（BigInt wire 消费侧兼容——GenerationIntent 列型 BigInt）
    expect(feedError('CREDIT_INSUFFICIENT', 'CREDIT_INSUFFICIENT', row({ execSeq: '7' as unknown as bigint })).execSeq).toBe('7');
    expect(feedError('CREDIT_INSUFFICIENT', 'CREDIT_INSUFFICIENT', row({ execSeq: 7 as unknown as bigint })).execSeq).toBe('7');
  });

  it('feedError 产出恒经组装器八键面（表外句子传 id 时不可达——句子单源=FEED_SENTENCES[id]）', () => {
    // feedError 的句子只从 FEED_SENTENCES[sentence id] 来——封闭句结构保证（等值检查仍留最后一道）
    const p = feedError('EXECUTION_FAILED', 'EXEC_GENERIC', null);
    expect(p).toEqual({ status: 'error', attempts: 0, errorCode: 'EXECUTION_FAILED', rearmable: false, error: '生成失败' });
  });
});

describe('Y3 Task1 契约冻结：execStatusSlotOfPayload（payload→Fact 八键+nodeVersion；缺合法 nodeVersion→null）', () => {
  it('⑥ 全值→Fact 八键+nodeVersion（键有值才拷——缺的可选键不写成 undefined）', () => {
    const slot = execStatusSlotOfPayload({
      nodeId: 'n1', status: 'error', attempts: 2, execSeq: '42', errorCode: 'CREDIT_INSUFFICIENT',
      artifactRev: 3, intentId: 'intent-token-1', rearmable: false, error: '积分不足', nodeVersion: '101',
    });
    expect(slot).not.toBeNull();
    expect(Object.keys(slot!.execStatus).sort()).toEqual(
      ['artifactRev', 'attempts', 'error', 'errorCode', 'execSeq', 'intentId', 'nodeVersion', 'rearmable', 'status'],
    );
    // 残缺 payload：可选键缺→不写成 undefined（键有值才拷）
    const partial = execStatusSlotOfPayload({ nodeId: 'n1', status: 'loading', attempts: 0, nodeVersion: '5' });
    expect(partial).toEqual({ execStatus: { status: 'loading', attempts: 0, nodeVersion: '5' } });
  });

  it('⑥ 缺 nodeVersion／nodeVersion 非十进制 string→null（缺合法版本不算一条状态）', () => {
    expect(execStatusSlotOfPayload({ nodeId: 'n1', status: 'loading', attempts: 0 })).toBeNull();
    expect(execStatusSlotOfPayload({ nodeId: 'n1', status: 'loading', attempts: 0, nodeVersion: 'abc' })).toBeNull();
    expect(execStatusSlotOfPayload({ nodeId: 'n1', status: 'loading', attempts: 0, nodeVersion: 101 })).toBeNull();
    expect(execStatusSlotOfPayload({ nodeId: 'n1', status: 'loading', attempts: 0, nodeVersion: '' })).toBeNull();
  });

  it('非 exec.status 感面：kind/v/fileId 等键传入不进 Fact（投影面只认八键+nodeVersion）', () => {
    const slot = execStatusSlotOfPayload({
      nodeId: 'n1', status: 'done', attempts: 1, nodeVersion: '9', kind: 'exec.status', v: 1, fileId: 'f1',
    });
    expect(Object.keys(slot!.execStatus).sort()).toEqual(['attempts', 'nodeVersion', 'status']);
  });
});

describe('Y3 Task1 契约冻结：受理四档联合类型（discriminated union——api/web 同源）', () => {
  it('四档形状：replayed:false{intentId,execSeq}/delivered{resultRef}/voided/deduped{taskId,status}', () => {
    const fresh: AdmissionOutcome = { replayed: false, intentId: 'intent-token-1', execSeq: '42' };
    const delivered: AdmissionOutcome = { replayed: true, outcome: 'delivered', resultRef: 'ref-1' };
    const voided: AdmissionOutcome = { replayed: true, outcome: 'voided' };
    const deduped: AdmissionOutcome = { replayed: true, outcome: 'deduped', taskId: 't-1', status: 'completed' };
    expect(fresh.replayed).toBe(false);
    expect(delivered.resultRef).toBe('ref-1');
    expect('resultRef' in voided).toBe(false);   // 作废档无 resultRef 键
    expect(deduped.status).toBe('completed');
  });
});

describe('Y3 Task1 契约冻结：mergeSlot execStatus execSeq 代际规则（execStatus 槽专用）', () => {
  const proj = (over: Partial<RuntimeProjection> = {}): RuntimeProjection => ({
    projectId: 'p1', generation: 3, feedSeq: '10', pgSeq: '100', nodes: {}, ...over,
  });
  const delta = (p: RuntimeProjection) => ({ projection: p, fullSnapshot: false });

  it('⑧ 两边都有十进制 execSeq：大者胜（BigInt 数值比较非字符串——execSeq="10" loading 不被 "9" done 盖掉）', () => {
    const current = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 1, execSeq: '10', nodeVersion: '20' } } },
    });
    const staleDone = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '9', nodeVersion: '30' } } },
    });
    // 字符串比较 "9">"10" 为真会盖掉——BigInt 比较后 "10" loading 胜（nodeVersion 30 也救不回旧代）
    const merged = mergeRuntimeProjection(current, delta(staleDone));
    expect(merged.nodes.n1!.execStatus!.status).toBe('loading');
    // 反向：execSeq 11 的 done 到场——盖掉 loading
    const freshDone = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '11', nodeVersion: '21' } } },
    });
    expect(mergeRuntimeProjection(current, delta(freshDone)).nodes.n1!.execStatus!.status).toBe('done');
  });

  it('⑧ execSeq 数值大胜过 nodeVersion 大：execSeq=6 loading（nodeVersion=20）不被 execSeq=5 done（nodeVersion=30）盖掉', () => {
    const current = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 1, execSeq: '6', nodeVersion: '20' } } },
    });
    const oldGenDone = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '5', nodeVersion: '30' } } },
    });
    const merged = mergeRuntimeProjection(current, delta(oldGenDone));
    expect(merged.nodes.n1!.execStatus!.status).toBe('loading');
  });

  it('⑧ execSeq 相同比 nodeVersion：大者胜；等值保持当前（幂等重放稳定）', () => {
    const current = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 1, execSeq: '7', nodeVersion: '20' } } },
    });
    const higher = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '7', nodeVersion: '25' } } },
    });
    expect(mergeRuntimeProjection(current, delta(higher)).nodes.n1!.execStatus!.status).toBe('done');
    const lower = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '7', nodeVersion: '15' } } },
    });
    expect(mergeRuntimeProjection(current, delta(lower)).nodes.n1!.execStatus!.status).toBe('loading');
    const replay = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 1, execSeq: '7', nodeVersion: '20' } } },
    });
    expect(mergeRuntimeProjection(current, delta(replay)).nodes.n1!.execStatus!.status).toBe('loading');
  });

  it('⑧ 任一边缺 execSeq→仍只比 nodeVersion（无行档不受影响——发布窗旧 worker loading 无 execSeq 形态）', () => {
    // 当前缺 execSeq（旧 worker 形态）——incoming 有 execSeq 但 nodeVersion 低→不盖
    const current = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 1, nodeVersion: '30' } } },
    });
    const oldIncoming = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, execSeq: '9', nodeVersion: '20' } } },
    });
    expect(mergeRuntimeProjection(current, delta(oldIncoming)).nodes.n1!.execStatus!.status).toBe('loading');
    // incoming 缺 execSeq——nodeVersion 大照常盖
    const newLoading = proj({
      nodes: { n1: { execStatus: { status: 'loading', attempts: 2, nodeVersion: '35' } } },
    });
    expect(mergeRuntimeProjection(current, delta(newLoading)).nodes.n1!.execStatus!.status).toBe('loading');
    const doneHigher = proj({
      nodes: { n1: { execStatus: { status: 'done', attempts: 1, nodeVersion: '40' } } },
    });
    expect(mergeRuntimeProjection(current, delta(doneHigher)).nodes.n1!.execStatus!.status).toBe('done');
  });

  it('⑧ execStatus 槽专用：artifact/deletedAt/restored 槽不受 execSeq 规则影响（仍只比 nodeVersion）', () => {
    const current = proj({
      nodes: {
        n1: {
          artifact: { mediaId: 'm0', artifactRev: 1, nodeVersion: '20' },
          deletedAt: { lifecycleSeq: '1', nodeVersion: '20' },
          restored: { lifecycleSeq: '2', nodeVersion: '20' },
        },
      },
    });
    const incoming = proj({
      nodes: {
        n1: {
          // execStatus 带 execSeq=9（大于一切）但 artifact 槽自身 nodeVersion 更低——artifact 不被盖
          execStatus: { status: 'done', attempts: 1, execSeq: '9', nodeVersion: '15' },
          artifact: { mediaId: 'm1', artifactRev: 2, nodeVersion: '18' },
          deletedAt: { lifecycleSeq: '3', nodeVersion: '18' },
          restored: { lifecycleSeq: '4', nodeVersion: '18' },
        },
      },
    });
    const merged = mergeRuntimeProjection(current, delta(incoming));
    expect(merged.nodes.n1!.artifact!.mediaId).toBe('m0');
    expect(merged.nodes.n1!.deletedAt!.lifecycleSeq).toBe('1');
    expect(merged.nodes.n1!.restored!.lifecycleSeq).toBe('2');
    // execStatus 槽 current 缺席=槽创建档（mergeSlot 同语义）——incoming 落槽；
    // 反向对照：current 在席+incoming nodeVersion 低→execStatus 也不被盖
    expect(merged.nodes.n1!.execStatus).toEqual({ status: 'done', attempts: 1, execSeq: '9', nodeVersion: '15' });
    const withExec = proj({
      nodes: {
        n1: {
          execStatus: { status: 'loading', attempts: 1, execSeq: '6', nodeVersion: '20' },
          artifact: { mediaId: 'm0', artifactRev: 1, nodeVersion: '20' },
        },
      },
    });
    const lowGenIncoming = proj({
      nodes: {
        n1: {
          // execStatus execSeq=5 旧代+nodeVersion 15 低——execStatus 不被盖
          execStatus: { status: 'done', attempts: 1, execSeq: '5', nodeVersion: '15' },
          artifact: { mediaId: 'm1', artifactRev: 2, nodeVersion: '18' },
        },
      },
    });
    const merged2 = mergeRuntimeProjection(withExec, delta(lowGenIncoming));
    expect(merged2.nodes.n1!.execStatus!.status).toBe('loading');   // execStatus 旧代（execSeq 5<6、nodeVersion 15<20）不盖
    expect(merged2.nodes.n1!.artifact!.mediaId).toBe('m0');         // artifact 同照 nodeVersion 不盖（execSeq 规则只作用 execStatus 槽）
  });
});
