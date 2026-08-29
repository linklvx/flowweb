// apps/web/src/stores/canvasHistory.test.ts
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { pickStructNodes, pickStructEdges } from './canvasHistory';

const n = (over: Partial<Node> & { id: string }): Node => ({
  type: 'textInput', position: { x: 0, y: 0 }, data: {}, ...over,
} as Node);

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
