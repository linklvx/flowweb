// apps/web/src/pages/canvas/video-editor/export/product-node.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createProductNode } from './product-node';
import { useCanvasStore } from '@/stores/canvasStore';
import { autoOutEdgeId } from '@/stores/autoEdgeIds';

// canvasStore.nodes 是 Node[] 数组——夹具用数组
beforeEach(() => {
  useCanvasStore.setState({
    projectId: 'wf1',
    nodes: [
      { id: 'edit1', type: 'videoEdit', position: { x: 100, y: 50 }, data: {}, width: 320, measured: { width: 320 } } as never,
    ],
    edges: [],
  } as never);
});

describe('createProductNode（产物上画布）', () => {
  it('建 videoGen 产物节点：data 含 origin/sourceNodeId/mediaId/label（Y2 B3：作者放置只写 mediaId；Y4a T8 re-key——doc-schema-v5 videoGen 槽键），位置在剪辑节点右侧', () => {
    const id = createProductNode('edit1', 'edit1', 'file-1', '多轨剪辑');
    const s = useCanvasStore.getState();
    const node = s.nodes.find((n) => n.id === id) as unknown as { type: string; data: Record<string, unknown>; position: { x: number; y: number } };
    expect(node.type).toBe('videoGen');
    expect(node.data).toMatchObject({ origin: 'video-edit', sourceNodeId: 'edit1', mediaId: 'file-1', label: '多轨剪辑 · 导出 1' });
    expect(node.data.videoProjectId).toBeUndefined();   // Y4a T8：旧键零写（doc-schema-v5 键集外拒）
    expect(node.data.status).toBeUndefined();   // Y2 B3：status 禁键零写
    expect(node.data.fileId).toBeUndefined();
    expect(node.position.x).toBe(100 + 320 + 80); // sw + GAP
    expect(node.position.y).toBe(50);
    expect(s.edges.some((e: { id: string }) => e.id === autoOutEdgeId('edit1', id))).toBe(true);
  });
  it('重复导出独立新节点：label 导出 2、位置再偏移 400', () => {
    createProductNode('edit1', 'edit1', 'file-1', '多轨剪辑');
    const id2 = createProductNode('edit1', 'edit1', 'file-2', '多轨剪辑');
    const s = useCanvasStore.getState();
    const n2 = s.nodes.find((n) => n.id === id2) as unknown as { data: { label: string }; position: { x: number } };
    expect(n2.data.label).toBe('多轨剪辑 · 导出 2');
    expect(n2.position.x).toBe(100 + 320 + 80 + 400);
  });
});
