import { describe, it, expect } from 'vitest';
import { buildCopyPlan } from './copyPlan';
import { normalizeSelection, participation } from './arrangeSelection';

const G = (id: string, cells: string[], extra: any = {}) => {
  const { position, ...dataExtra } = extra ?? {};
  return {
    id, type: 'group', parentId: undefined, position: position ?? { x: 0, y: 0 },
    width: 400, height: 300, data: { groupType: 'normal', cells, ...dataExtra },
  };
};
const N = (id: string, parentId?: string, extra: any = {}) =>
  ({ id, type: 'imageGen', parentId, position: parentId ? { x: 20, y: 50 } : { x: 100, y: 100 }, data: { fileId: 'f1', prompt: 'p-ns', ...extra } });

// 分工契约组合测试缝：buildCopyPlan 只接收已裁决 ids——测试输入统一经 participation 组合取得
// （传裸组 id 违反契约：['g2'] 不含 'x' 则不该有 x 的副本，"折叠组成员纳入"断言必然落空）
const dupIds = (records: any[], ids: string[]) =>
  participation(normalizeSelection(records, ids), 'duplicate', records).ids;

describe('buildCopyPlan（副本构造体——分工单点：participation 裁决前置）', () => {
  it('组闭包：选中组→成员全纳入，cells 重映射（无旧 id 残留），子副本数==源子节点数', () => {
    const records: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => 'new-id');
    const newG = plan.copies.find((c) => c.type === 'group')!;
    expect(plan.copies.filter((c) => c.parentId === newG.id).length).toBe(2);
    // cells 无旧 id：
    const cells = (newG.data as any).cells as string[];
    const copyIds = new Set(plan.copies.map((c) => c.id));
    expect(cells.every((c: string) => copyIds.has(c))).toBe(true);
  });
  it('data 保真：普通节点副本 data=records 输入——prompt 等非桥接键逐字保真', () => {
    const records: any[] = [N('n1', undefined, { prompt: '用户改过的长提示词' })];
    const plan = buildCopyPlan(records, dupIds(records, ['n1']), { offset: { x: 40, y: 0 } }, () => 'c1');
    expect((plan.copies[0].data as any).prompt).toBe('用户改过的长提示词');
  });
  it('hidden 保真：折叠组成员随组入副本集（parentId=组副本 id、rel 保留）+ 副本组继承 collapsed；分镜子副本 position 归零 {0,0}', () => {
    const records: any[] = [
      G('g2', ['x'], { collapsed: true }), N('x', 'g2'),
      G('s1', ['p'], { groupType: 'storyboard' }), N('p', 's1'),
    ];
    const dup = buildCopyPlan(records, dupIds(records, ['g2']), { offset: { x: 40, y: 0 } }, () => 'd');
    const newG = dup.copies.find((c) => c.type === 'group')!;
    expect(dup.copies.filter((c) => c.parentId === newG.id).length).toBe(1);   // 折叠组成员纳入（非空壳）
    expect((newG.data as any).collapsed).toBe(true);                            // 副本继承 collapsed
    const st = buildCopyPlan(records, dupIds(records, ['s1']), { offset: { x: 40, y: 0 } }, () => 's');
    const child = st.copies.find((c) => c.parentId !== undefined)!;
    expect(child.position).toEqual({ x: 0, y: 0 });                              // 分镜子 rel 恒 0
  });
  it('detached 副本顶层化：parentId=undefined + 绝对坐标（父位置+rel）+offset + extent=undefined（F41）', () => {
    const records: any[] = [G('g1', ['a'], { position: { x: 100, y: 100 } }), N('a', 'g1')];
    const plan = buildCopyPlan(records, dupIds(records, ['a']), { offset: { x: 40, y: 0 } }, () => 'c');
    expect(plan.copies[0].parentId).toBeUndefined();
    expect(plan.copies[0].position).toEqual({ x: 160, y: 150 });
    // extent=undefined: copy record carries extent undefined
    expect((plan.copies[0] as any).extent).toBeUndefined();
  });
  it('选区闭包互连边重映射（两端都在复制集内）；selected：组副本 true / 子副本 false', () => {
    // e1 连 a→b（两端均在 g1 闭包内）→ 重映射保留；e2 连 a→z、e3 连 z→a（z 不在集合）→ 丢弃
    const records: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1'), N('z')];
    let i = 0;
    const plan = buildCopyPlan(
      records, dupIds(records, ['g1']), { offset: { x: 40, y: 0 } }, () => `id${++i}`,
      [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'z' },
        { id: 'e3', source: 'z', target: 'a' },
      ],
    );
    expect(plan.newEdges).toHaveLength(1);
    expect(plan.newEdges[0]).toEqual({ id: 'id4', source: plan.idMap.get('a'), target: plan.idMap.get('b') });
    const gCopy = plan.copies.find((c) => c.id === plan.idMap.get('g1'))!;
    expect(gCopy.selected).toBe(true);   // 组副本入选（成为新选区）
    for (const childId of ['a', 'b']) {
      expect(plan.copies.find((c) => c.id === plan.idMap.get(childId))!.selected).toBe(false);   // 子副本不入选
    }
  });
});
