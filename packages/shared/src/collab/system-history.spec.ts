// packages/shared/src/collab/system-history.spec.ts
// Y1c T5b（plan v1.7 Task 5 业务 DDL 段；spec v5.4 §4.4/§6 权威注记）：SystemHistory 单行权威+
// CanvasDocUpdate.actorRanges 单表示+updateHash canonical+DocAuditEvent 的契约测试——
// 十进制字符串校验（拒 number——BigInt 2^53 精度）、批级区间覆盖（无重叠无空洞）、
// canonicalUpdateHashPayload 确定性（有序 frameHash 列表 join 形态锁定）、审计 180d。
import { describe, expect, it } from 'vitest';
import {
  ActorRange, CANVAS_DOC_HISTORY_COLUMN_REMOVED, canonicalUpdateHashPayload,
  DECIMAL_BIGINT_STRING_RE, DocAuditEventRow, DOC_AUDIT_KINDS, DOC_AUDIT_RETENTION_DAYS,
  isDecimalBigintString, SYSTEM_HISTORY_BUMP_CONTRACT, SystemHistoryRow,
  validateActorRange, validateActorRanges,
} from './system-history';

describe('Y1c T5b 契约冻结：SystemHistory 全局单行唯一权威（v5.4⑦——删 CanvasDoc.historyId 列）', () => {
  it('SystemHistoryRow=id 恒 1+historyId+epochStartedAt+updatedAt（extends T5a SystemHistoryState——单源不重复）', () => {
    const row: SystemHistoryRow = { id: 1, historyId: 'h-2026-10-24', epochStartedAtMs: 1, updatedAtMs: 2 };
    expect(Object.keys(row).sort()).toEqual(['epochStartedAtMs', 'historyId', 'id', 'updatedAtMs']);
    expect(row.epochStartedAtMs).toBeGreaterThanOrEqual(0);
  });
  it('bump 纪律：单事务（+trigger 同步缓存）提交后才允许启动；启动任一不匹配/缺失/为零=fail-closed 不自动修复', () => {
    expect(SYSTEM_HISTORY_BUMP_CONTRACT.bump).toContain('单事务');
    expect(SYSTEM_HISTORY_BUMP_CONTRACT.failClosed).toContain('fail-closed');
  });
  it('CanvasDoc.historyId 列删除登记（restore 恒整库恢复——WAL 段头 historyId 直存 SystemHistory 值）', () => {
    expect(CANVAS_DOC_HISTORY_COLUMN_REMOVED).toBe('historyId');
  });
});

describe('Y1c T5b 契约冻结：actorRanges Json 单表示（删 actor 列——from/to 十进制字符串）', () => {
  const range = (from: string, to: string, over: Partial<ActorRange> = {}): ActorRange =>
    ({ from, to, userId: 'u1', actorKind: 'user', ...over });
  it('isDecimalBigintString：拒 number（BigInt 2^53 精度——JS number 直落 JSON 即精度损失）/负号/前导零/小数/空串', () => {
    expect(isDecimalBigintString('0')).toBe(true);
    expect(isDecimalBigintString('42')).toBe(true);
    expect(isDecimalBigintString('9007199254740993')).toBe(true);    // 2^53+1——十进制串无损
    expect(isDecimalBigintString(42 as unknown)).toBe(false);        // number 一律拒（纪律：BigInt 禁入 JSON number）
    expect(isDecimalBigintString(9007199254740993 as unknown)).toBe(false);
    expect(isDecimalBigintString('-1')).toBe(false);
    expect(isDecimalBigintString('042')).toBe(false);                // 前导零拒（canonical 十进制）
    expect(isDecimalBigintString('1.5')).toBe(false);
    expect(isDecimalBigintString('')).toBe(false);
    expect(DECIMAL_BIGINT_STRING_RE.test('123')).toBe(true);
  });
  it('validateActorRange：非十进制串/from>=to 拒；u64 全域十进制可过（2^64-1）', () => {
    expect(validateActorRange(range('10', '20'))).toBe(true);
    expect(validateActorRange(range('20', '10'))).toBe(false);       // 倒置
    expect(validateActorRange(range('10', '10'))).toBe(false);       // 空半开区间
    expect(validateActorRange({ from: 10 as unknown as string, to: '20', userId: 'u1', actorKind: 'user' })).toBe(false);   // number 混入即拒
    expect(validateActorRange(range('0', '18446744073709551615'))).toBe(true);   // u64 全域
  });
  it('validateActorRanges 批级：排序后覆盖 [firstWalSeq,lastWalSeq] 半开无重叠无空洞', () => {
    const batch = { firstWalSeq: 1n, lastWalSeq: 5n };
    expect(validateActorRanges([range('1', '3'), range('3', '6')], batch)).toEqual({ ok: true });            // 双 actor 首尾相接
    expect(validateActorRanges([range('1', '6')], batch)).toEqual({ ok: true });                             // 单 actor 全覆盖
    expect(validateActorRanges([range('1', '4'), range('3', '6')], batch)).toMatchObject({ ok: false, reason: 'overlap' });
    expect(validateActorRanges([range('1', '2'), range('3', '6')], batch)).toMatchObject({ ok: false, reason: 'hole' });   // 洞=帧 2 无人认领
    expect(validateActorRanges([range('2', '6')], batch)).toMatchObject({ ok: false, reason: 'coverage' });  // 头未覆盖
    expect(validateActorRanges([range('1', '5')], batch)).toMatchObject({ ok: false, reason: 'coverage' });  // 尾缺 lastWalSeq（半开 to=last+1）
    expect(validateActorRanges([], batch)).toMatchObject({ ok: false, reason: 'empty' });                    // frameCount>0 必有认领者
  });
});

describe('Y1c T5b 契约冻结：updateHash=有序 frameHash 列表 SHA-256（canonical join 形态锁定）', () => {
  const h = (c: string): string => c.repeat(64);
  it('canonicalUpdateHashPayload=JSON 数组 join（有序——批内 walSeq 升序）；确定性+顺序敏感', () => {
    expect(canonicalUpdateHashPayload([h('a')])).toBe(JSON.stringify([h('a')]));
    expect(canonicalUpdateHashPayload([h('a'), h('b')])).toBe(JSON.stringify([h('a'), h('b')]));
    expect(canonicalUpdateHashPayload([h('a'), h('b')])).not.toBe(canonicalUpdateHashPayload([h('b'), h('a')]));   // 顺序敏感
    expect(canonicalUpdateHashPayload([h('a'), h('b')])).toBe(canonicalUpdateHashPayload([h('a'), h('b')]));       // 确定性
  });
  it('空列表 canonical=空 JSON 数组（合法形态——批行 frameCount>0 由 CHECK 另守，本函数不重复判）', () => {
    expect(canonicalUpdateHashPayload([])).toBe('[]');
  });
});

describe('Y1c T5b 契约冻结：DocAuditEvent（敏感操作同 PG 事务审计——v1.2 DocWriteAudit 残留替代）', () => {
  it('kind 五值 closed：delete/execute/permission/maintenance/refund；180d 保留', () => {
    expect([...DOC_AUDIT_KINDS]).toEqual(['delete', 'execute', 'permission', 'maintenance', 'refund']);
    expect(DOC_AUDIT_RETENTION_DAYS).toBe(180);
  });
  it('列集冻结：payload 不含正文（requestId 关联+projectId 索引）', () => {
    const row: DocAuditEventRow = {
      id: 'ae-1', projectId: 'p1', kind: 'execute', userId: 'u1', requestId: 'req-1',
      payload: { nodeCount: 2 }, createdAtMs: 1,
    };
    expect(Object.keys(row).sort()).toEqual(['createdAtMs', 'id', 'kind', 'payload', 'projectId', 'requestId', 'userId']);
  });
});
