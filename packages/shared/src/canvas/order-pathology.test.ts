// packages/shared/src/canvas/order-pathology.test.ts
// T18（Z4''-v14）：order 域病理计数单源测试——四档（duplicate/soft/hard/missing）+层集合+clean。
// 阈值单源=order-key（SOFT 24/HARD 128——T17 既有锚对齐）。
import { describe, it, expect } from 'vitest';
import { scanOrderPathology, isCleanOrderPathology, type OrderPathologyReport } from './order-pathology';
import { ORDER_KEY_SOFT_LIMIT } from './order-key';
import type { OrderableRecord } from './order-records';

const rec = (id: string, data: Record<string, unknown>, parentId?: string | null): OrderableRecord =>
  ({ id, parentId: parentId ?? null, data });

describe("scanOrderPathology 四档（Z4''-v14 病理计数）", () => {
  it('clean 层（合法唯一键）⇒ kinds 空+layers 空+isClean true', () => {
    const r = scanOrderPathology([
      rec('a', { order: '5000' }), rec('b', { order: '5050' }), rec('c', { order: '5100' }),
    ]);
    expect(r.kinds).toEqual([]);
    expect(r.layers).toEqual([]);
    expect(r.scannedNodes).toBe(3);
    expect(isCleanOrderPathology(r)).toBe(true);
  });

  it('duplicate-key：同层等值键两成员 ⇒ 两成员均计（参与重复口径）+层入集合；跨层同键不计（order 仅同层内生效——D5）', () => {
    const r = scanOrderPathology([
      rec('a', { order: '10' }), rec('b', { order: '10' }),
      rec('g', { groupType: 'normal', order: '999' }), rec('c', { order: '10' }, 'g'), rec('d', { order: '10' }, 'g'),
    ]);
    expect(r.kinds).toEqual(['duplicate-key']);
    expect(r.duplicateKeyNodes).toBe(4);   // 根层 2+组层 2（各自层内等值）
    expect(r.layers).toEqual([null, 'g']);
    expect(isCleanOrderPathology(r)).toBe(false);
  });

  it('soft-key：合法键键长 ≥24（ORDER_KEY_SOFT_LIMIT）⇒ 计数；23 长合法键不计', () => {
    const frac = '5'.repeat(ORDER_KEY_SOFT_LIMIT - 2);   // "5." + 22 位 → 总长 24
    const justUnder = '4'.repeat(ORDER_KEY_SOFT_LIMIT - 3);   // 总长 23
    const r = scanOrderPathology([rec('soft', { order: `5.${frac}` }), rec('ok', { order: `5.${justUnder}` })]);
    expect(r.kinds).toEqual(['soft-key']);
    expect(r.softKeyNodes).toBe(1);
  });

  it('hard-key：非法键（超 128 硬限/非 canonical 形/超键域上沿）⇒ 计数且不参与重复判定', () => {
    const over = `5.${'5'.repeat(127)}`;   // 129 长——超 HARD_LIMIT 即非法
    const trailingZero = '5.50';           // 尾零=等值非规范形
    const huge = `${2 ** 53 + 1}`;         // 超键域上沿（BigInt 判定）
    const r = scanOrderPathology([
      rec('over', { order: over }), rec('tz', { order: trailingZero }), rec('huge', { order: huge }), rec('tz2', { order: '5.50' }),
    ]);
    expect(r.hardKeyNodes).toBe(3);
    expect(r.kinds).toContain('hard-key');
    expect(r.kinds).not.toContain('duplicate-key');   // 非法键不进等值分组（canonical 语义依赖合法键）
  });

  it('missing-key：order 域成员缺 order 键 ⇒ 计数（未迁移窗口——读侧 (null,id) 兜底容忍）', () => {
    const r = scanOrderPathology([rec('bare', {}), rec('nullish', { order: null as unknown as string })]);
    expect(r.kinds).toEqual(['missing-key']);
    expect(r.missingKeyNodes).toBe(2);
  });

  it('slot 域跳过（分镜格位——格位病理归 deriveStoryboardCells 读侧面，Y2 扩展零代码）', () => {
    const r = scanOrderPathology([
      rec('s0', { slot: 0 }), rec('s0b', { slot: 0 }),   // 重复 slot：不在本扫描面
      rec('o', { order: '5000' }),
    ]);
    expect(r.scannedNodes).toBe(1);   // 仅 order 域成员计分母
    expect(isCleanOrderPathology(r)).toBe(true);
  });

  it('混合档：kinds 按词表序全列+报告字段全量（CLI dry-run 直印形态）', () => {
    const r: OrderPathologyReport = scanOrderPathology([
      rec('dup1', { order: '7' }), rec('dup2', { order: '7' }),
      rec('hard', { order: 'abc' }),
      rec('miss', {}),
      rec('soft', { order: `5.${'9'.repeat(40)}` }),
    ]);
    expect(r.kinds).toEqual(['duplicate-key', 'soft-key', 'hard-key', 'missing-key']);
    expect(r.duplicateKeyNodes).toBe(2);
    expect(r.hardKeyNodes).toBe(1);
    expect(r.missingKeyNodes).toBe(1);
    expect(r.softKeyNodes).toBe(1);
    expect(r.layers).toEqual([null]);
    expect(r.scannedNodes).toBe(5);
  });
});
