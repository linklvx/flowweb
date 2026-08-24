// apps/web/src/stores/canvasHistory.test.ts
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  HISTORY_LIMIT, pickStructNodes, pickStructEdges, sanitizeDragging,
  createPartialize, structuralEquality, type NodeStoreLike,
} from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

const snapEntry = (id: string, data: Record<string, unknown> = {}) =>
  ({ id, type: 'textInput', position: { x: 0, y: 0 }, data });

describe('pickStructNodes / pickStructEdges', () => {
  it('只保留结构字段（id/type/position/parentId/width/height）', () => {
    const picked = pickStructNodes([n({ id: 'a', selected: true, dragging: true, zIndex: 5, data: { x: 1 } })]);
    expect(picked[0]).toEqual({ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, parentId: undefined, width: undefined, height: undefined });
  });
  it('edge 只保留结构字段', () => {
    const picked = pickStructEdges([{ id: 'e1', source: 'a', target: 'b', animated: true } as Edge]);
    expect(picked[0]).toEqual({ id: 'e1', source: 'a', target: 'b', sourceHandle: undefined, targetHandle: undefined, type: undefined });
  });
});

describe('sanitizeDragging', () => {
  it('无 dragging 节点时返回原数组引用（零 clone）', () => {
    const nodes = [n({ id: 'a' }), n({ id: 'b' })];
    expect(sanitizeDragging(nodes)).toBe(nodes);
  });
  it('dragging:true 的节点被替换为 dragging:false，其余保持引用', () => {
    const a = n({ id: 'a' });
    const b = n({ id: 'b', dragging: true });
    const out = sanitizeDragging([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1].dragging).toBe(false);
    expect(out[1]).not.toBe(b);
  });
});

describe('createPartialize（F1 缓存 + S-3 降级）', () => {
  const mkStore = (nodes: Record<string, any>): NodeStoreLike & { swap(next: any): void } => {
    const holder = { nodes };
    return { nodes, swap: (next) => { holder.nodes = next; }, get nodes2() { return holder.nodes; } } as any;
  };
  // 简化：直接用闭包可控引用
  const mkGetter = () => {
    let cur: NodeStoreLike = { nodes: {} };
    return { get: () => cur, set: (nodes: any) => { cur = { nodes }; } };
  };

  it('nodeStore 引用未变时两次调用返回同一 __nodeDataSnap 引用（零深拷贝）', () => {
    const g = mkGetter();
    g.set({ a: snapEntry('a', { content: 'x' }) });
    const partialize = createPartialize(g.get);
    const state = { nodes: [n({ id: 'a' })], edges: [] } as any;
    expect(partialize(state).__nodeDataSnap).toBe(partialize(state).__nodeDataSnap);
  });
  it('nodeStore nodes 引用变化后重新采样', () => {
    const g = mkGetter();
    const partialize = createPartialize(g.get);
    const state = { nodes: [], edges: [] } as any;
    const p1 = partialize(state);
    g.set({ b: snapEntry('b') });
    const p2 = partialize(state);
    expect(p1.__nodeDataSnap).not.toBe(p2.__nodeDataSnap);
    expect(p2.__nodeDataSnap.b).toBeDefined();
  });
  it('采样为深拷贝（后续 nodeStore 更新不污染快照）', () => {
    const g = mkGetter();
    g.set({ a: snapEntry('a', { content: 'v1' }) });
    const partialize = createPartialize(g.get);
    const snap = partialize({ nodes: [], edges: [] } as any).__nodeDataSnap;
    g.set({ a: snapEntry('a', { content: 'v2' }) });
    expect((snap.a.data as any).content).toBe('v1');
  });
  it('不同工厂实例缓存隔离（Vitest 串用例防护）', () => {
    const g1 = mkGetter(); g1.set({});
    const p1 = createPartialize(g1.get)({ nodes: [], edges: [] } as any);
    g1.set({ a: snapEntry('a') });
    const p2 = createPartialize(g1.get)({ nodes: [], edges: [] } as any);
    expect(p1.__nodeDataSnap).not.toBe(p2.__nodeDataSnap);
  });
  it('S-3：data 混入不可克隆值（函数）时不抛错，降级浅拷贝', () => {
    const g = mkGetter();
    g.set({ a: { ...snapEntry('a'), data: { fn: () => {} } as any } });
    const partialize = createPartialize(g.get);
    expect(() => partialize({ nodes: [], edges: [] } as any)).not.toThrow();
    expect(partialize({ nodes: [], edges: [] } as any).__nodeDataSnap.a).toBeDefined();
  });
  it('I-1：拖动中（_isPointerInteraction）跳过采样——nodeStore 引用变化不触发 clone，结束后 catch-up', () => {
    const g = mkGetter();
    const partialize = createPartialize(g.get);
    const idle = partialize({ nodes: [], edges: [], _isPointerInteraction: false } as any);
    g.set({ b: snapEntry('b') });                                                 // 引用变化（模拟 TD-Pos 每帧写）
    const dragging = partialize({ nodes: [], edges: [], _isPointerInteraction: true } as any);
    expect(dragging.__nodeDataSnap).toBe(idle.__nodeDataSnap);                    // 复用缓存，零 clone
    const after = partialize({ nodes: [], edges: [], _isPointerInteraction: false } as any);
    expect(after.__nodeDataSnap.b).toBeDefined();                                 // 结束后下次调用补采样
  });
});

describe('structuralEquality（G1：过滤在 equality 层）', () => {
  it('只改 selected/hidden/dragging 不产生历史（equality 判等）', () => {
    const before = { nodes: [n({ id: 'a' })], edges: [] };
    const after = { nodes: [n({ id: 'a', selected: true, dragging: true, hidden: true })], edges: [] };
    expect(structuralEquality(before as any, after as any)).toBe(true);
  });
  it('改 position/parentId/width/height 产生历史（equality 不等）', () => {
    for (const patch of [{ position: { x: 9, y: 9 } }, { parentId: 'g' }, { width: 123 }, { height: 456 }]) {
      const before = { nodes: [n({ id: 'a' })], edges: [] };
      const after = { nodes: [n({ id: 'a', ...patch } as any)], edges: [] };
      expect(structuralEquality(before as any, after as any)).toBe(false);
    }
  });
  it('__nodeDataSnap 差异不影响判等', () => {
    const a = { nodes: [n({ id: 'a' })], edges: [], __nodeDataSnap: { a: {} } };
    const b = { nodes: [n({ id: 'a' })], edges: [], __nodeDataSnap: { a: { x: 1 } } };
    expect(structuralEquality(a as any, b as any)).toBe(true);
  });
});

describe('HISTORY_LIMIT', () => {
  it('为 100', () => expect(HISTORY_LIMIT).toBe(100));
});
