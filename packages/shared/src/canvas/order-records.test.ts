// packages/shared/src/canvas/order-records.test.ts
// T17（plan v11.2 S5 片·spec D5/Z4''-v14）：读序单源——层序遍历+同层 (order,id)/(slot,id)
// 双 tie-break 容忍重复键。D5：order 仅同 parentId 层内生效；不设跨层全局序。
import { describe, it, expect } from 'vitest';
import { orderRecords, compareWithinLayer, layerOf } from './order-records';

const node = (id: string, parentId: string | null, data: Record<string, unknown>) =>
  ({ id, ...(parentId != null ? { parentId } : {}), data });

describe('compareWithinLayer (order,id) 双 tie-break', () => {
  it('order 键数值序（"9"<"10"——字符串序反例红线）', () => {
    expect(compareWithinLayer(node('a', null, { order: '9' }), node('b', null, { order: '10' }))).toBeLessThan(0);
  });
  it('等值 order：id 字典序 tie-break（重复键容忍——读序稳定不500）', () => {
    expect(compareWithinLayer(node('b', null, { order: '5' }), node('a', null, { order: '5' }))).toBeGreaterThan(0);
    expect(compareWithinLayer(node('a', null, { order: '5' }), node('b', null, { order: '5' }))).toBeLessThan(0);
  });
  it('缺 order 键排同层最后（未迁移/新建窗口——(null,id) 兜底）', () => {
    expect(compareWithinLayer(node('a', null, {}), node('z', null, { order: '5' }))).toBeGreaterThan(0);
  });
  it('(slot,id)：slot 数值序+id tie-break（分镜子层读序）', () => {
    expect(compareWithinLayer(node('a', 'g', { slot: 2 }), node('b', 'g', { slot: 10 }))).toBeLessThan(0);
    expect(compareWithinLayer(node('b', 'g', { slot: 1 }), node('a', 'g', { slot: 1 }))).toBeGreaterThan(0);
  });
  it('混合层（order 档在前、slot 档在后——脏态兜底不抛）', () => {
    expect(compareWithinLayer(node('a', null, { order: '1' }), node('b', null, { slot: 0 }))).toBeLessThan(0);
  });
});

describe('orderRecords 层序遍历（D5：父先于子+同层读序）', () => {
  it('层序遍历=根层 (order,id) 先、组层随后（按父发现序）', () => {
    const recs = [
      node('z', null, { order: '2' }),
      node('kid2', 'g1', { order: '2' }),
      node('kid1', 'g1', { order: '1' }),
      node('a', null, { order: '1' }),
      node('g1', null, { order: '3' }),
    ];
    expect(orderRecords(recs).map((r) => r.id)).toEqual(['a', 'z', 'g1', 'kid1', 'kid2']);
  });

  it('同层 order 数值序跨长度正确（"9"<"10"）', () => {
    const recs = [node('ten', null, { order: '10' }), node('nine', null, { order: '9' })];
    expect(orderRecords(recs).map((r) => r.id)).toEqual(['nine', 'ten']);
  });

  it('重复 order 键：读序仍稳定（(order,id) tie-break——Z4-v14 容忍）', () => {
    const recs = [node('b', null, { order: '5' }), node('a', null, { order: '5' }), node('c', null, { order: '5' })];
    expect(orderRecords(recs).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('分镜子层按 (slot,id) 读序（slot 单实现）', () => {
    const recs = [
      node('g', null, { order: '1', groupType: 'storyboard' }),
      node('s2', 'g', { slot: 1 }),
      node('s1', 'g', { slot: 0 }),
    ];
    expect(orderRecords(recs).map((r) => r.id)).toEqual(['g', 's1', 's2']);
  });

  it('孤儿（parentId 悬空）不丢：作为根层成员参与排序（读侧全函数）', () => {
    const recs = [node('orphan', 'ghost', { order: '1' }), node('root', null, { order: '2' })];
    const out = orderRecords(recs).map((r) => r.id);
    expect(out).toContain('orphan');
    expect(out).toContain('root');
  });

  it('父环不抛栈溢出：环成员作根层兜底输出', () => {
    const recs = [node('p', 'c', { order: '1' }), node('c', 'p', { order: '1' })];
    const out = orderRecords(recs).map((r) => r.id).sort();
    expect(out).toEqual(['c', 'p']);
  });

  it('输入数组不被就地修改（纯函数）', () => {
    const recs = [node('b', null, { order: '2' }), node('a', null, { order: '1' })];
    const snapshot = [...recs];
    orderRecords(recs);
    expect(recs).toEqual(snapshot);
  });
});

describe('layerOf（层键单源：分镜子层归父组、自由子归父组、根层 null）', () => {
  it('根层 null；子层=parentId（D5 层内序）', () => {
    expect(layerOf(node('a', null, {}))).toBeNull();
    expect(layerOf(node('k', 'g', {}))).toBe('g');
  });
});
