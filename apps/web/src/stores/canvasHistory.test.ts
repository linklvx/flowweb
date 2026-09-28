// apps/web/src/stores/canvasHistory.test.ts
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import isEqual from 'fast-deep-equal';
import { pickStructNodes, pickStructEdges } from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

describe('pickStructNodes / pickStructEdges', () => {
  it('普通节点只保留结构字段（data 不入 pick 面——nodeStore 订阅已覆盖）', () => {
    const picked = pickStructNodes([n({ id: 'a', selected: true, dragging: true, zIndex: 5, data: { x: 1 } })]);
    expect(picked[0]).toEqual({ id: 'a', type: 'textInput', position: { x: 0, y: 0 }, parentId: undefined, width: undefined, height: undefined });
  });
  it('edge 只保留结构字段', () => {
    const picked = pickStructEdges([{ id: 'e1', source: 'a', target: 'b', animated: true } as Edge]);
    expect(picked[0]).toEqual({ id: 'e1', source: 'a', target: 'b', sourceHandle: undefined, targetHandle: undefined, type: undefined });
  });
});

describe('F42 触发面——pickStructNodes 纳入组 data', () => {
  it('组节点 data 变更使 pickStruct 输出不等（showIndex 等纯 data 变更桥必须触发——现状红：不含 data 恒等）', () => {
    const before = pickStructNodes([{ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { showIndex: false } } } as any]);
    const after = pickStructNodes([{ id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', storyboard: { showIndex: true } } } as any]);
    expect(isEqual(before, after)).toBe(false);   // 现状：两输出相等（data 不在 pick 面）——必红
  });

  it('普通节点 data 不入 pick 面（nodeStore 订阅已覆盖——不加比较税）', () => {
    const mk = (d: unknown) => [{ id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: d } as any];
    expect(isEqual(pickStructNodes(mk({ a: 1 })), pickStructNodes(mk({ a: 2 })))).toBe(true);
  });
});
