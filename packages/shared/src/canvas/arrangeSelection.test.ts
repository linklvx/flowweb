import { describe, it, expect } from 'vitest';
import { normalizeSelection, participation } from './arrangeSelection';

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
  it('download：三桶全展开且含 hidden 成员（整组下载语义——spec 契约 1 显式）', () => {
    const all: any[] = [...nodes, ...collapsed()];
    const p = participation(normalizeSelection(all, ['g2']), 'download', all);
    expect(p.ids.sort()).toEqual(['g2', 'x', 'y']);
  });
});
