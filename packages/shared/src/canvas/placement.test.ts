// packages/shared/src/canvas/placement.test.ts
// T17（plan v11.2 S5 片·spec Z12''/Z17''/:258）：placement 复合单键判别（order|slot 进 data，
// slot=派生单实现禁两可）+ DOC_NODE_KEYS 契约表 + deriveStoryboardCells（capacity 派生不落 doc
// /长度恰=capacity/overflowIds/resize 溢出/swap 整值）单测。
import { describe, it, expect } from 'vitest';
import {
  DOC_NODE_KEYS, PLACEMENT_DATA_KEYS, readPlacement, validatePlacementData,
  deriveStoryboardCells, isStoryboardChildRecord,
} from './placement';
import { NODE_ENVELOPE_KEYS } from './nodeEnvelope';

describe('DOC_NODE_KEYS 契约表（:258 钉死）', () => {
  it('envelope 7 键 = NODE_ENVELOPE_KEYS（不动红线）', () => {
    expect([...DOC_NODE_KEYS.envelope]).toEqual([...NODE_ENVELOPE_KEYS]);
    expect(DOC_NODE_KEYS.envelope).toHaveLength(7);
  });
  it('order/slot 进 data 判别——placement 键集恰两键', () => {
    expect([...DOC_NODE_KEYS.dataPlacement]).toEqual(['order', 'slot']);
    expect([...PLACEMENT_DATA_KEYS]).toEqual(['order', 'slot']);
  });
});

describe('readPlacement 判别（slot=派生单实现禁两可）', () => {
  it('分镜子（有效非负整数 slot）⇒ slot 档', () => {
    expect(readPlacement({ slot: 0 })).toEqual({ kind: 'slot', slot: 0 });
    expect(readPlacement({ slot: 7 })).toEqual({ kind: 'slot', slot: 7 });
  });
  it('自由节点（order 键）⇒ order 档；缺键⇒ order 档空键（读侧全函数）', () => {
    expect(readPlacement({ order: '5' })).toEqual({ kind: 'order', order: '5' });
    expect(readPlacement({})).toEqual({ kind: 'order', order: null });
  });
  it('非法 slot（负数/非整数/非数）不判 slot 档（fail-open 到 order 档+校验报告）', () => {
    expect(readPlacement({ slot: -1 }).kind).toBe('order');
    expect(readPlacement({ slot: 1.5 }).kind).toBe('order');
    expect(readPlacement({ slot: '2' }).kind).toBe('order');
  });
});

describe('validatePlacementData 禁两可', () => {
  it('order+slot 并存=违例（禁两可）', () => {
    expect(validatePlacementData({ order: '5', slot: 0 })).toHaveLength(1);
  });
  it('单键/空 data 零违例；非法 order/非法 slot 各自违例', () => {
    expect(validatePlacementData({})).toEqual([]);
    expect(validatePlacementData({ order: '5' })).toEqual([]);
    expect(validatePlacementData({ slot: 3 })).toEqual([]);
    expect(validatePlacementData({ order: 'bad' })).toHaveLength(1);
    expect(validatePlacementData({ slot: -2 })).toHaveLength(1);
    expect(validatePlacementData({ slot: 'x' })).toHaveLength(1);
  });
});

describe('isStoryboardChildRecord', () => {
  const sbGroup = { id: 'g', type: 'group', data: { groupType: 'storyboard' } };
  it('parentId 指向 storyboard 组的记录=分镜子', () => {
    expect(isStoryboardChildRecord({ parentId: 'g', data: {} }, new Map([['g', sbGroup] as any]))).toBe(true);
    expect(isStoryboardChildRecord({ data: {} }, new Map())).toBe(false);
  });
});

describe('deriveStoryboardCells（Z17 维持 v10）', () => {
  // id 与 slot 独立（k{i} 按*输入序*命名——swap 测试不自我抵消）
  const kids = (slots: (number | null)[]): { id: string; data: Record<string, unknown> }[] =>
    slots.map((s, i) => (s == null ? { id: `k${i}`, data: {} } : { id: `k${i}`, data: { slot: s } }));

  it('长度恰=capacity；有效 slot 落格；(slot,id) 双 tie-break 定序', () => {
    const r = deriveStoryboardCells(kids([2, 0, 1]), 4);
    expect(r.cells).toEqual(['k1', 'k2', 'k0', null]);
    expect(r.overflowIds).toEqual([]);
  });

  it('溢出：slot ≥ capacity 成员进 overflowIds（resize 溢出移出的读侧来源）', () => {
    const r = deriveStoryboardCells(kids([0, 4, 1, 9]), 3);
    expect(r.cells).toEqual(['k0', 'k2', null]);
    expect(r.overflowIds).toEqual(['k1', 'k3']); // (slot,id) 序
  });

  it('重复 slot：后到者（id 序）挤进首个空格——重复键容忍（(slot,id) tie-break）', () => {
    const dup = [
      { id: 'a', data: { slot: 1 } },
      { id: 'b', data: { slot: 1 } },
      { id: 'c', data: { slot: 0 } },
    ];
    const r = deriveStoryboardCells(dup, 2);
    expect(r.cells).toEqual(['c', 'a']); // a<b：a 落格 1，b 挤空格（无空格→overflow）
    expect(r.overflowIds).toEqual(['b']);
  });

  it('缺 slot/非法 slot 成员：自愈填首空格（读侧派生不写 doc）；满员进 overflow', () => {
    const r = deriveStoryboardCells(kids([null, 0]), 2);
    expect(r.cells).toEqual(['k1', 'k0']);
    const r2 = deriveStoryboardCells(kids([0, 1, null]), 2);
    expect(r2.overflowIds).toEqual(['k2']);
  });

  it('capacity=0（空配置退化）：全员 overflow、cells 空数组', () => {
    const r = deriveStoryboardCells(kids([0]), 0);
    expect(r.cells).toEqual([]);
    expect(r.overflowIds).toEqual(['k0']);
  });

  it('swap 整值语义底座：交换两成员 slot 后派生格互换（无第三态）', () => {
    const before = deriveStoryboardCells(kids([0, 1]), 2);
    const after = deriveStoryboardCells(kids([1, 0]), 2);
    expect(before.cells).toEqual(['k0', 'k1']);
    expect(after.cells).toEqual(['k1', 'k0']);
  });
});
