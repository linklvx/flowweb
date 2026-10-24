// packages/shared/src/collab/execution-request.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §6.1——偏离 38⑨⑩）：执行受理契约冻结的契约测试——
// 锁受理数字（8MiB/2MiB/256KiB/20/200/50/15min——单源派生禁第二字面量）、planHash 不可变字段清单双向冻结
// （status/execSeq/generationIntentId 不进 hash 负控）、canonicalPlanHashPayload 确定性（order 排序/可变字段无关）、
// 受理纯函数族（nodeIds 非空/去重/≤20；raw∧stored 双限任一超限=EXEC_INPUT_TOO_LARGE）、
// frozenDocSeq 临界区次序+超时数字、重试双 409、资金 per-item 预留契约。
// 本文件=T21（G4 门受理实现）/T23（资金收口）的消费契约锁：任何契约面漂移先红于此。
import { describe, expect, it } from 'vitest';
import {
  canonicalPlanHashPayload, EXEC_ADMISSION_TIMEOUT_MS, EXEC_CREDIT_RESERVATION_CONTRACT,
  EXEC_FREEZE_BUDGET_MS, EXEC_INPUT_ENCODING_KINDS, EXEC_INPUT_RAW_MAX_BYTES,
  EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS, EXEC_INPUT_STORED_MAX_BYTES, EXEC_MAX_NODES,
  EXEC_PROMPT_MAX_BYTES, EXEC_REFERENCED_IMAGE_IDS_MAX, EXEC_REQUEST_CONFLICT_REASONS,
  EXEC_REQUEST_EXPIRES_AT_MS, EXEC_UPSTREAM_MEDIA_IDS_MAX, ExecutionInputRow,
  ExecutionNodePlanRow, ExecutionRequestRow, FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES,
  PLAN_HASH_EXCLUDED_FIELDS, PLAN_HASH_IMMUTABLE_FIELDS, validateExecutionInputLimits,
  validateExecutionScopeNodeIds,
} from './execution-request';

/** 子行 fixture（全字段含可变执行态——列集冻结+planHash 负控共用） */
const planRow = (over: Partial<ExecutionNodePlanRow> = {}): ExecutionNodePlanRow => ({
  requestId: 'req-1', nodeId: 'node-1', order: 0, type: 'imageGen', model: 'model-a',
  resolution: '1k', styleId: 'style-1', pricingRuleId: 'rule-1', creditCost: 5,
  reservedCredit: 5, paramsHash: 'a'.repeat(64), status: 'PLANNED',
  generationIntentId: 'gi-0', execSeq: 0n,
  ...over,
});

describe('Y1c T5b 契约冻结：ExecutionRequest 父行/子行/输入（spec §6.1 v5.4——偏离 37⑤+38⑨）', () => {
  it('受理数字冻结：expiresAt=15min/EXEC_MAX_NODES=20（api EXEC_DEFAULTS.MAX_NODES 同值——T21 改引本单源）', () => {
    expect(EXEC_REQUEST_EXPIRES_AT_MS).toBe(15 * 60 * 1000);
    expect(EXEC_MAX_NODES).toBe(20);
    expect(EXEC_INPUT_RETENTION_AFTER_FINAL_DAYS).toBe(30);   // 终态 30d 清理 worker
  });
  it('输入预算冻结：raw≤8MiB ∧ stored≤2MiB 双限（任一超限 413）+prompt 256KiB+upstream 200+引用图 50——不截断不分片', () => {
    expect(EXEC_INPUT_RAW_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(EXEC_INPUT_STORED_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(EXEC_PROMPT_MAX_BYTES).toBe(256 * 1024);
    expect(EXEC_UPSTREAM_MEDIA_IDS_MAX).toBe(200);
    expect(EXEC_REFERENCED_IMAGE_IDS_MAX).toBe(50);
  });
  it('encoding 契约=json 内容+gzip|brotli 二选一（node:zlib——禁 zstd 原生依赖）；zstd 不在值域', () => {
    expect([...EXEC_INPUT_ENCODING_KINDS]).toEqual(['json+gzip', 'json+brotli']);
    expect((EXEC_INPUT_ENCODING_KINDS as readonly string[]).some((e) => e.includes('zstd'))).toBe(false);
  });
  it('ExecutionRequestRow 字段清单双向冻结（列集=spec §6.1 DDL：内部 id 主键+requestId 项目内唯一+historyId 列）', () => {
    const row: ExecutionRequestRow = {
      id: 'cuid-1', requestId: 'req-1', projectId: 'p1', generation: 3, historyId: 'h-1',
      docSeq: 40n, frozenDocSeq: 42n, userId: 'u1', teamId: 't1', kind: 'image',
      state: 'ADMITTED', reservedCredit: 10, totalCredit: 10,
      planHash: 'b'.repeat(64), inputHash: 'c'.repeat(64), expiresAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'docSeq', 'expiresAtMs', 'frozenDocSeq', 'generation', 'historyId', 'id', 'inputHash',
      'kind', 'planHash', 'projectId', 'requestId', 'reservedCredit', 'state', 'teamId',
      'totalCredit', 'userId',
    ]);
  });
  it('ExecutionNodePlanRow 字段清单双向冻结（@@id([requestId,nodeId])+@@index([requestId,order])——reservedCredit per-item）', () => {
    const row = planRow({ model: undefined, resolution: undefined, styleId: undefined, pricingRuleId: undefined });
    expect(Object.keys(row).sort()).toEqual([
      'creditCost', 'execSeq', 'generationIntentId', 'model', 'nodeId', 'order', 'paramsHash',
      'pricingRuleId', 'requestId', 'reservedCredit', 'resolution', 'status', 'styleId', 'type',
    ]);
  });
  it('ExecutionInputRow 字段清单冻结：contentHash 64hex 单源（inputHash=contentHash）+expiresAt 必填（无值禁插）', () => {
    const row: ExecutionInputRow = {
      requestId: 'req-1', encoding: 'json+brotli', content: new Uint8Array([1, 2]),
      contentHash: 'c'.repeat(64), rawBytes: 2, storedBytes: 2, schemaVersion: 3, expiresAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual([
      'content', 'contentHash', 'encoding', 'expiresAtMs', 'rawBytes', 'requestId',
      'schemaVersion', 'storedBytes',
    ]);
    expect(row.contentHash.length).toBe(64);
  });
});

describe('Y1c T5b 契约冻结：planHash 只盖不可变字段（偏离 38⑨——冻结后不可变的单源证明）', () => {
  it('PLAN_HASH_IMMUTABLE_FIELDS 九字段精确冻结（nodeId/order/type/model/resolution/styleId/pricingRuleId/creditCost/paramsHash）', () => {
    expect([...PLAN_HASH_IMMUTABLE_FIELDS]).toEqual([
      'nodeId', 'order', 'type', 'model', 'resolution', 'styleId', 'pricingRuleId', 'creditCost', 'paramsHash',
    ]);
  });
  it('负控：status/execSeq/generationIntentId 不进 planHash（PLAN_HASH_EXCLUDED_FIELDS 冻结）', () => {
    expect([...PLAN_HASH_EXCLUDED_FIELDS]).toEqual(['status', 'execSeq', 'generationIntentId']);
    const base = canonicalPlanHashPayload([planRow()]);
    // 同不可变字段、可变执行态任意变化——canonical 不变（负控断言）
    expect(canonicalPlanHashPayload([planRow({ status: 'CLAIMED' })])).toBe(base);
    expect(canonicalPlanHashPayload([planRow({ status: 'DONE', execSeq: 9n, generationIntentId: 'gi-1' })])).toBe(base);
  });
  it('canonicalPlanHashPayload：按 order 排序子行（输入乱序→canonical 相同）；order 并列按 nodeId tie-break', () => {
    const a = planRow({ nodeId: 'n-a', order: 0 });
    const b = planRow({ nodeId: 'n-b', order: 1 });
    const c = planRow({ nodeId: 'n-c', order: 2 });
    expect(canonicalPlanHashPayload([c, a, b])).toBe(canonicalPlanHashPayload([a, b, c]));
    const x = planRow({ nodeId: 'n-x', order: 1 });
    const y = planRow({ nodeId: 'n-y', order: 1 });
    expect(canonicalPlanHashPayload([y, x])).toBe(canonicalPlanHashPayload([x, y]));
    // 确定性：同输入同串（sha256 调用点=T21/T26——本函数只出 canonical payload）
    expect(canonicalPlanHashPayload([a, b, c])).toBe(canonicalPlanHashPayload([a, b, c]));
  });
  it('canonicalPlanHashPayload：可选字段 undefined 归一 null；串形态锁定（JSON 元组数组）', () => {
    const bare = planRow({ model: undefined, resolution: undefined, styleId: undefined, pricingRuleId: undefined });
    expect(canonicalPlanHashPayload([bare])).toBe(
      JSON.stringify([['node-1', 0, 'imageGen', null, null, null, null, 5, 'a'.repeat(64)]]),
    );
    expect(canonicalPlanHashPayload([planRow()])).toBe(
      JSON.stringify([['node-1', 0, 'imageGen', 'model-a', '1k', 'style-1', 'rule-1', 5, 'a'.repeat(64)]]),
    );
  });
});

describe('Y1c T5b 契约冻结：受理校验纯函数族（插入前一次性——任一失败整请求 4xx 不落半行）', () => {
  it('validateExecutionScopeNodeIds：非空/去重/≤20 三拒+恰 20 放行（上限含端点）', () => {
    expect(validateExecutionScopeNodeIds([])).toMatchObject({ ok: false, code: 'EXEC_SCOPE_EMPTY' });
    expect(validateExecutionScopeNodeIds(['n1', 'n2', 'n1'])).toMatchObject({ ok: false, code: 'EXEC_SCOPE_DUPLICATE_NODE' });
    const twentyOne = Array.from({ length: 21 }, (_, i) => `n${i}`);
    expect(validateExecutionScopeNodeIds(twentyOne)).toMatchObject({ ok: false, code: 'EXEC_SCOPE_TOO_LARGE' });
    expect(validateExecutionScopeNodeIds(twentyOne.slice(0, 20))).toEqual({ ok: true });   // 恰 20 放行
    expect(validateExecutionScopeNodeIds(['n1'])).toEqual({ ok: true });
  });
  it('validateExecutionInputLimits：raw 8MiB ∧ stored 2MiB 任一超限=EXEC_INPUT_TOO_LARGE（413）——恰压线放行', () => {
    expect(validateExecutionInputLimits({ rawBytes: EXEC_INPUT_RAW_MAX_BYTES, storedBytes: EXEC_INPUT_STORED_MAX_BYTES })).toEqual({ ok: true });
    expect(validateExecutionInputLimits({ rawBytes: EXEC_INPUT_RAW_MAX_BYTES + 1, storedBytes: 10 })).toMatchObject({ ok: false, code: 'EXEC_INPUT_TOO_LARGE' });
    expect(validateExecutionInputLimits({ rawBytes: 10, storedBytes: EXEC_INPUT_STORED_MAX_BYTES + 1 })).toMatchObject({ ok: false, code: 'EXEC_INPUT_TOO_LARGE' });
    expect(validateExecutionInputLimits({ rawBytes: 9 * 1024 * 1024, storedBytes: 3 * 1024 * 1024 })).toMatchObject({ ok: false, code: 'EXEC_INPUT_TOO_LARGE' });   // 双超也归一档
  });
  it('validateExecutionInputLimits：prompt>256KiB=PROMPT_TOO_LARGE/upstream>200/引用图>50=各自 413——不截断不分片', () => {
    expect(validateExecutionInputLimits({ promptBytes: EXEC_PROMPT_MAX_BYTES })).toEqual({ ok: true });
    expect(validateExecutionInputLimits({ promptBytes: EXEC_PROMPT_MAX_BYTES + 1 })).toMatchObject({ ok: false, code: 'PROMPT_TOO_LARGE' });
    expect(validateExecutionInputLimits({ upstreamMediaCount: EXEC_UPSTREAM_MEDIA_IDS_MAX + 1 })).toMatchObject({ ok: false, code: 'UPSTREAM_MEDIA_TOO_MANY' });
    expect(validateExecutionInputLimits({ referencedImageCount: EXEC_REFERENCED_IMAGE_IDS_MAX + 1 })).toMatchObject({ ok: false, code: 'REFERENCED_IMAGES_TOO_MANY' });
  });
  it('首违确定序：多限同超时按 raw/stored→prompt→upstream→referenced 首违回报（无随机性）', () => {
    const r = validateExecutionInputLimits({ rawBytes: 9 * 1024 * 1024, promptBytes: 300 * 1024, upstreamMediaCount: 300 });
    expect(r).toMatchObject({ ok: false, code: 'EXEC_INPUT_TOO_LARGE' });
  });
});

describe('Y1c T5b 契约冻结：frozenDocSeq 临界区+重试冲突+资金 per-item（spec §6.1 v5.4⑦⑨⑪）', () => {
  it('临界区次序冻结：拿 gate mutex→等当前 apply→flushThrough(appliedSeq)→断言 pgSeq==appliedSeq→校验 generation→只读 scope+直接父→frozenDocSeq=pgSeq→释放', () => {
    expect([...FROZEN_DOC_SEQ_CRITICAL_SECTION_STAGES]).toEqual([
      'acquire-gate-mutex',
      'wait-current-apply',
      'flush-through-appliedSeq',
      'assert-pgSeq-equals-appliedSeq',
      'verify-generation-unchanged',
      'read-scope-and-direct-parents-only',
      'set-frozenDocSeq-equals-pgSeq',
      'release-mutex',
    ]);
  });
  it('超时数字：临界区 2s→503 不落行；freeze 预算 500ms→回退 PG 前缀重建候选 doc（不无限阻塞 actor）', () => {
    expect(EXEC_ADMISSION_TIMEOUT_MS).toBe(2_000);
    expect(EXEC_FREEZE_BUDGET_MS).toBe(500);
  });
  it('重试双 409：REQUEST_STALE（historyId 不匹配=PITR 后同 requestId 重试）/IDEMPOTENCY_CONFLICT（同键异 body）', () => {
    expect(EXEC_REQUEST_CONFLICT_REASONS).toEqual({ REQUEST_STALE: 409, IDEMPOTENCY_CONFLICT: 409 });
  });
  it('资金 per-item 预留契约五面：受理事务逐 item/expiresAt=15min/sweeper void/部分失败逐 item 结算/重试不重复预留', () => {
    expect(EXEC_CREDIT_RESERVATION_CONTRACT.perItem).toBe(true);
    expect(EXEC_CREDIT_RESERVATION_CONTRACT.expiresAtMs).toBe(EXEC_REQUEST_EXPIRES_AT_MS);
    expect(EXEC_CREDIT_RESERVATION_CONTRACT.unclaimedSweeper).toContain('逐 item void');
    expect(EXEC_CREDIT_RESERVATION_CONTRACT.partialFailure).toContain('按 item');
    expect(EXEC_CREDIT_RESERVATION_CONTRACT.idempotentRetry).toContain('不重复预留');
  });
});
