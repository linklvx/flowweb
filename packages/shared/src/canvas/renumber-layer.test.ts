// packages/shared/src/canvas/renumber-layer.test.ts
// T18（Z4''-v14）：CLI renumber-layer 规划单源测试——幂等/重复键分键/slot 不动/跨层旧键/读序保持。
import { describe, it, expect } from 'vitest';
import { planRenumberLayers, RENUMBER_BASE, RENUMBER_STEP } from './renumber-layer';
import { orderRecords, type OrderableRecord } from './order-records';
import { readPlacement } from './placement';

const rec = (id: string, data: Record<string, unknown>, parentId?: string | null): OrderableRecord =>
  ({ id, parentId: parentId ?? null, data });

const orderOf = (rs: OrderableRecord[], id: string): string | null => {
  const r = rs.find((x) => x.id === id)!;
  const p = readPlacement((r.data ?? {}) as Record<string, unknown>);
  return p.kind === 'order' ? p.order : null;
};

describe('planRenumberLayers（CLI 规划核——幂等不承诺永久无重复）', () => {
  it('带间隙整键：按读序分配 base+i*step（5000/5100/…）——幂等：再跑零变更', () => {
    const rs = [rec('b', { order: '20' }), rec('a', { order: '10' }), rec('c', { order: '15.5' })];
    const p1 = planRenumberLayers(rs);
    expect(p1.byId.get('a')).toBe(String(RENUMBER_BASE));
    expect(p1.byId.get('c')).toBe(String(RENUMBER_BASE + RENUMBER_STEP));
    expect(p1.byId.get('b')).toBe(String(RENUMBER_BASE + 2 * RENUMBER_STEP));
    expect(p1.layers).toEqual(new Set([null]));
    // 应用后再跑=零变更
    const applied = rs.map((r) => ({ ...r, data: { ...(r.data as object), order: p1.byId.get(r.id)! } }));
    const p2 = planRenumberLayers(applied);
    expect(p2.byId.size).toBe(0);   // 幂等：同键零变更（CLI 再跑零写）
    expect(p2.layers.size).toBe(0);
  });

  it('重复键分键：同层等值键按 (order,id) tie-break 现序获得相异新键（去重+读序稳定）', () => {
    const rs = [rec('x', { order: '10' }), rec('y', { order: '10' }), rec('z', { order: '9' })];
    const plan = planRenumberLayers(rs);
    const applied = rs.map((r) => ({ ...r, data: { ...(r.data as object), ...(plan.byId.has(r.id) ? { order: plan.byId.get(r.id)! } : {}) } }));
    expect(new Set(applied.map((r) => orderOf(applied, r.id))).size).toBe(3);   // 三成员相异键
    // 读序稳定：应用后读序=原读序（z→x→y：数值序+等值 id tie-break）
    expect(orderRecords(applied).map((r) => r.id)).toEqual(['z', 'x', 'y']);
    // 二次生成重复（离线合并回灌）再重排：仍容忍不抛（重复再生成容忍——不承诺永久无重复）
    const reDup = applied.map((r, i) => (i === 1 ? { ...r, data: { ...(r.data as object), order: orderOf(applied, 'x')! } } : r));
    expect(() => planRenumberLayers(reDup)).not.toThrow();
    const p3 = planRenumberLayers(reDup);
    expect(p3.byId.size).toBeGreaterThan(0);
  });

  it('slot 域不动：分镜格位成员零重排（整值已紧凑——重排会破坏格位语义）', () => {
    const rs = [
      rec('g', { groupType: 'storyboard', storyboard: {}, order: '5000' }),   // 组自身=根层 order 域（slot 判别只看子成员）
      rec('s1', { slot: 1 }, 'g'), rec('s2', { slot: 0 }, 'g'),
      rec('free', { order: '10' }),
    ];
    const p = planRenumberLayers(rs);
    expect(p.scannedNodes).toBe(2);   // 根层自由节点+组节点（slot 子成员不入规划）
    expect(p.byId.has('free')).toBe(true);
    expect(p.byId.has('s1')).toBe(false);
    expect(p.byId.has('s2')).toBe(false);
  });

  it('跨层旧键一并重排：入组携带的旧层键按新层现序获得整键（全层全量）', () => {
    const rs = [
      rec('g', { groupType: 'normal', order: '5000' }),   // 组自身=根层 order 域成员（已是整键——同值零变更）
      rec('moved', { order: '4999.99999' }, 'g'),   // 入组携带旧分数键
      rec('fresh', { order: '5000' }, 'g'),
    ];
    const p = planRenumberLayers(rs);
    expect(p.byId.get('moved')).toBe(String(RENUMBER_BASE));        // 现序（旧键<5000）在前
    expect(p.byId.get('fresh')).toBe(String(RENUMBER_BASE + RENUMBER_STEP));
    expect(p.byId.has('g')).toBe(false);   // 根层成员 g 已是目标键=幂等零变更
    expect(p.layers).toEqual(new Set(['g']));
  });

  it('缺键/非法键成员同样获得合法新键（重排=顺带修复病理——读序兜底序参与分配）', () => {
    const rs = [rec('bad', { order: 'not-a-key' }), rec('bare', {}), rec('good', { order: '5000' })];
    const p = planRenumberLayers(rs);
    const keys = rs.map((r) => p.byId.get(r.id)!);
    expect(keys.every((k) => k != null)).toBe(true);   // 全员获得键（含非法/缺键成员——修复档）
    expect(new Set(keys).size).toBe(3);                // 相异（等值/非法并存态分键）
    expect(new Set(keys.map(Number)).size).toBe(3);    // 合法整键（canonical——非法键被替换）
  });

  it('多层独立：各层独立计数从 base 起（键域仅层内生效——D5）', () => {
    const rs = [
      rec('g1', { groupType: 'normal', order: '5000' }), rec('g2', { groupType: 'normal', order: '5100' }),   // 根层两组成员已是整键（幂等零变更——根层不入受影响层）
      rec('a', { order: '10' }, 'g1'), rec('b', { order: '20' }, 'g1'),
      rec('c', { order: '10' }, 'g2'), rec('d', { order: '20' }, 'g2'),
    ];
    const p = planRenumberLayers(rs);
    expect(p.layers).toEqual(new Set(['g1', 'g2']));
    for (const layer of ['g1', 'g2']) {
      const keys = rs.filter((r) => r.parentId === layer).map((r) => p.byId.get(r.id));
      expect(keys).toEqual([String(RENUMBER_BASE), String(RENUMBER_BASE + RENUMBER_STEP)]);   // 各层独立从 base 起
    }
  });
});
