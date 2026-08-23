// apps/web/src/utils/nodeOrder.test.ts
import { describe, it, expect } from 'vitest';
import { ensureParentOrder, hydrateNodes } from './nodeOrder';

const n = (id: string, parentId?: string) =>
  ({ id, ...(parentId ? { parentId } : {}) }) as any;

describe('ensureParentOrder（父前子后拓扑重排）', () => {
  it('子在前父在后 → 重排为父前子后，其余节点相对顺序不变', () => {
    const input = [n('child', 'g'), n('g'), n('solo')];
    const out = ensureParentOrder(input);
    expect(out.map((x: any) => x.id)).toEqual(['g', 'child', 'solo']);
  });

  it('已满足父前子后 → 返回原数组引用', () => {
    const input = [n('g'), n('child', 'g')];
    const out = ensureParentOrder(input);
    expect(out).toBe(input);
  });

  it('全部无 parentId → 顺序不变且返回原引用', () => {
    const input = [n('a'), n('b')];
    const out = ensureParentOrder(input);
    expect(out).toBe(input);
  });

  it('parentId 指向不存在的节点 → 该节点照常输出（不炸）', () => {
    const input = [n('a'), n('orphan', 'ghost')];
    const out = ensureParentOrder(input);
    expect(out.map((x: any) => x.id)).toEqual(['a', 'orphan']);
  });

  it('两组 + 独立节点交错 → 各组在其子节点前，独立节点保序', () => {
    const input = [
      n('c1', 'g1'), n('c2', 'g2'), n('solo'),
      n('g1'), n('c3', 'g1'), n('g2'),
    ];
    const out = ensureParentOrder(input);
    expect(out.map((x: any) => x.id)).toEqual(['g1', 'c1', 'g2', 'c2', 'solo', 'c3']);
  });

  it('嵌套链 child→parent→grandparent → 递归先输出祖先', () => {
    const input = [n('child', 'p'), n('p', 'gp'), n('gp')];
    const out = ensureParentOrder(input);
    expect(out.map((x: any) => x.id)).toEqual(['gp', 'p', 'child']);
  });

  it('循环引用（A↔B）→ 不抛栈溢出，节点不丢失', () => {
    const input = [n('a', 'b'), n('b', 'a')];
    const out = ensureParentOrder(input);
    expect(out.map((x: any) => x.id).sort()).toEqual(['a', 'b']);
  });
});

describe('hydrateNodes（恢复路径共用辅助：parentMap 回填 + extent 补全 + 排序）', () => {
  it('回填 parentMap：无 parentId 节点获得 parentId', () => {
    const input = [n('g'), n('c1'), n('c2')];
    const out = hydrateNodes(input, { c1: 'g', c2: 'g' });
    const c1 = out.find((x: any) => x.id === 'c1') as any;
    expect(c1.parentId).toBe('g');
  });

  it('有 parentId 节点补 extent:"parent"（仅无值时，不覆盖已有）', () => {
    const input = [n('g'), { id: 'c1', parentId: 'g' } as any, { id: 'c2', parentId: 'g', extent: 'parent' } as any];
    const out = hydrateNodes(input);
    expect((out.find((x: any) => x.id === 'c1') as any).extent).toBe('parent');
    expect((out.find((x: any) => x.id === 'c2') as any).extent).toBe('parent');
  });

  it('无 parentId 节点不补 extent', () => {
    const out = hydrateNodes([n('solo')]);
    expect((out[0] as any).extent).toBeUndefined();
  });

  it('输出父前子后（乱序输入重排）', () => {
    const input = [{ id: 'c1', parentId: 'g' } as any, n('g')];
    const out = hydrateNodes(input);
    expect(out.map((x: any) => x.id)).toEqual(['g', 'c1']);
  });

  it('parentMap 指向不存在节点 → 不回填不炸（ensureParentOrder 防御）', () => {
    const out = hydrateNodes([n('c1')], { c1: 'ghost' });
    expect((out[0] as any).parentId).toBeUndefined();
  });
});
