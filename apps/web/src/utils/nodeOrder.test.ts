// apps/web/src/utils/nodeOrder.test.ts
import { describe, it, expect } from 'vitest';
import { ensureParentOrder } from './nodeOrder';

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
