import { describe, it, expect } from 'vitest';
import { normalizeSelection, participation, sortForArrange, arrangeRects, ARRANGE_GAP, clampToolbarX } from './arrangeSelection';

const G = (id: string, children: string[], extra: Record<string, unknown> = {}) =>
  ({ id, type: 'group', parentId: undefined, position: { x: 0, y: 0 }, data: { groupType: 'normal', cells: children, ...extra } });
const N = (id: string, parentId?: string) =>
  ({ id, type: 'imageGen', parentId, position: { x: 0, y: 0 }, data: {} });

// 基础夹具：组 g1 含 a/b（b 同时选中=detached）；c 顶层 loose
const nodes: any[] = [G('g1', ['a', 'b']), N('a', 'g1'), N('b', 'g1'), N('c')];
// 折叠夹具：g2 折叠含 x/y；s1 分镜组含 p/q
const collapsed = (extra: Record<string, unknown> = {}) =>
  [G('g2', ['x', 'y'], { collapsed: true, ...extra }), N('x', 'g2'), N('y', 'g2')];

describe('normalizeSelection 三桶（契约 1 两段式）', () => {
  it('选中 [c,a,b,g1] → groups=[g1] looseRoots=[c] detachedChildren=[a,b]', () => {
    const r = normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']);
    expect(r.groups.map((g) => g.id)).toEqual(['g1']);
    expect(r.looseRoots.map((n) => n.id)).toEqual(['c']);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
  it('选中父组未选时子选中 → 子落 detached', () => {
    const r = normalizeSelection(nodes as any, ['a', 'b']);
    expect(r.groups).toEqual([]);
    expect(r.detachedChildren.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('participation 闭包策略表（v2.1：组→成员闭包展开+hidden 语义收窄）', () => {
  it('arrange：groups+looseRoots 参与（组=原子块不展开）、detached 排除并计数', () => {
    const p = participation(normalizeSelection(nodes as any, ['c', 'a', 'b', 'g1']), 'arrange', nodes as any);
    expect(p.ids.sort()).toEqual(['c', 'g1']);
    expect(p.excluded.detached).toBe(2);
  });
  it('duplicate：选中组闭包全量保真——hidden 成员随组纳入（折叠子保留原 rel、分镜子由 copyPlan 层归零）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    const p = participation(normalizeSelection(all, ['g1', 'g2']), 'duplicate', all);
    // g1 展开成员 a/b + g2 折叠成员 x/y 全部纳入（复制折叠组得完整副本继承 collapsed——非空壳）
    expect(p.ids.sort()).toEqual(['a', 'b', 'g1', 'g2', 'x', 'y']);
    expect(p.excluded.hidden).toBe(0);
  });
  it('duplicate 的 hidden 排除仅限 detached/直接选中桶（防陈旧选中产出孤儿副本）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    // 直接选中折叠组成员 x（不经组闭包——模拟陈旧选中残留）→ 排除并计数
    const p = participation(normalizeSelection(all, ['x']), 'duplicate', all);
    expect(p.ids).toEqual([]);
    expect(p.excluded.hidden).toBe(1);
  });
  it('duplicate：折叠组与其隐藏子同选——组闭包已纳员不得再计 excluded（双计数修正）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    // selection [g2, x]：x 经组闭包随 g2 纳入，detached 循环再遇 x 时不得重复计 hidden
    const p = participation(normalizeSelection(all, ['g2', 'x']), 'duplicate', all);
    expect(p.ids.sort()).toEqual(['g2', 'x', 'y']);
    expect(p.excluded.hidden).toBe(0);
    expect(p.excludedCount).toBe(0);
  });
  it('duplicate：excludedCount 聚合——hidden 排除与 detached 纳入并存时计数正确', () => {
    const all: any[] = [...nodes, ...collapsed()];
    // x=折叠 g2 的子（g2 未选→hidden 排除计数）；a=展开组 g1 的子（detached 顶层化纳入）
    const p = participation(normalizeSelection(all, ['x', 'a']), 'duplicate', all);
    expect(p.ids).toEqual(['a']);
    expect(p.excluded.hidden).toBe(1);
    expect(p.excludedCount).toBe(1);
  });
  it('download：三桶全展开且含 hidden 成员（整组下载语义——spec 契约 1 显式）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    const p = participation(normalizeSelection(all, ['g2']), 'download', all);
    expect(p.ids.sort()).toEqual(['g2', 'x', 'y']);
  });
});

describe('sortForArrange 行优先（F40：y 容差 8px 分行、行内 x 升序——先分行再行内排序）', () => {
  it('同行（|Δy|<8 对行首）按 x 升序；跨行按 y 升序', () => {
    const items = [
      { id: 'b', x: 200, y: 100 }, { id: 'a', x: 0, y: 100 },
      { id: 'd', x: 0, y: 105 }, { id: 'c', x: 0, y: 130 },
    ];
    // 第一行 {a(0,100), b(200,100), d(0,105)}（d 与行首差 5<8），行内 x 升序 → [a,d,b]；第二行 [c]
    expect(sortForArrange(items).map((i) => i.id)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('容差链对行首而非前项：c 与行首 a 差 12≥8 分新行（即便与前项 b 仅差 6<8）', () => {
    const items = [
      { id: 'a', x: 0, y: 100 }, { id: 'b', x: 10, y: 106 }, { id: 'c', x: 5, y: 112 },
    ];
    // 行首语义：行={a,b},{c} → 行内 x 升序 → [a,b,c]。
    // 若误为"对前项"语义：c(6<8)并入首行 → 行内 x 升序 → [a,c,b]——本断言据此判别。
    expect(sortForArrange(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('arrangeRects 三模式（§4.3）', () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 500, y: 500, width: 60, height: 80 },
    { x: 200, y: 40, width: 40, height: 40 },
  ];
  it('grid：列数 calcDefaultGrid(3)=2；相邻列间距=列宽+GAP；尺寸不变；n≤1 no-op', () => {
    const out = arrangeRects(rects, 'grid');
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);      // 相对断言（平移不变）
    out.forEach((r, i) => { expect(r.width).toBe(rects[i].width); expect(r.height).toBe(rects[i].height); });
    expect(arrangeRects([rects[0]], 'grid')).toEqual([rects[0]]);
  });
  it('grid 中心回归锚：输出包围盒中心==输入包围盒中心（实现按此不变量平移——回归锚，非独立判别）', () => {
    const c = (rs: typeof rects, axis: 'x' | 'y') => {
      const lo = Math.min(...rs.map((r) => r[axis]));
      const hi = Math.max(...rs.map((r) => axis === 'x' ? r.x + r.width : r.y + r.height));
      return (lo + hi) / 2;
    };
    const out = arrangeRects(rects, 'grid');
    expect(c(out, 'x')).toBeCloseTo(c(rects, 'x'), 6);
    expect(c(out, 'y')).toBeCloseTo(c(rects, 'y'), 6);
  });
  it('horizontal：单行；相邻间距=前行宽+GAP（相对断言）', () => {
    const out = arrangeRects(rects, 'horizontal');
    expect(new Set(out.map((r) => r.y)).size).toBe(1);
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);
    expect(out[2].x - out[1].x).toBe(60 + ARRANGE_GAP);
  });
  it('vertical：单列；相邻行距=行0 max 高+GAP（相对断言）', () => {
    const out = arrangeRects(rects, 'vertical');
    expect(new Set(out.map((r) => r.x)).size).toBe(1);
    expect(out[1].y - out[0].y).toBe(50 + ARRANGE_GAP);       // 行0 max 高=50（rects[0]）
  });
  it('混排顶对齐：行高=max', () => {
    const mixed = [{ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 0, width: 100, height: 200 }];
    const out = arrangeRects(mixed, 'horizontal');
    expect(out[1].y).toBe(out[0].y);
    expect(out[1].x - out[0].x).toBe(100 + ARRANGE_GAP);
  });
});

describe('clampToolbarX 水平夹取（§4.3）', () => {
  it('超左缘右移至 margin；恰右界与超右缘左移至 vw-margin-w', () => {
    expect(clampToolbarX(-50, 200, 1000, 8)).toBe(8);
    expect(clampToolbarX(980, 200, 1000, 8)).toBe(792);
    expect(clampToolbarX(808, 200, 1000, 8)).toBe(792);
  });
  it('窄视口（vw-margin-w < margin）双边兜底不小于 margin', () => {
    expect(clampToolbarX(50, 200, 100, 8)).toBe(8);
  });
});
