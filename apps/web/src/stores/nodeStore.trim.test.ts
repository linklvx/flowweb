import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeStore, NODE_TYPES, type AppNode, type VideoNodeData } from './nodeStore';

function createVideoNode(overrides?: Partial<VideoNodeData>): AppNode {
  return {
    id: 'test-video-node-1',
    type: NODE_TYPES.VIDEO_GEN,
    data: {
      model: 'hyvideo-v1.5',
      status: 'done',
      fileId: 'file-abc',
      ...overrides,
    },
  };
}

describe('nodeStore — video trim actions', () => {
  beforeEach(() => {
    // Reset store state
    useNodeStore.setState({ nodes: {} });
  });

  describe('updateVideoTrim', () => {
    it('should update trimStart and trimEnd on a video node', () => {
      const node = createVideoNode();
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().updateVideoTrim(node.id, 5.2, 18.7);

      const updated = useNodeStore.getState().getNodeData<VideoNodeData>(node.id);
      expect(updated?.trimStart).toBe(5.2);
      expect(updated?.trimEnd).toBe(18.7);
    });

    it('should be a no-op when node does not exist', () => {
      // Should not throw
      expect(() => {
        useNodeStore.getState().updateVideoTrim('nonexistent', 1, 2);
      }).not.toThrow();
    });
  });

  // Y2 B3：setTrimTaskStatus/setTrimmedResult 整体退役——trimTaskStatus/trimmedFileId 禁键
  // （服务端进度/产物域；剪辑产物落画布=VideoGenNode 作者放置写 mediaId、进度归 useTrimTaskStatus 本地态）
  it('Y2 B3：trim 双写点退役——ns 面零 trimTaskStatus/trimmedFileId 键（updateVideoTrim 照常）', () => {
    const node = createVideoNode();
    useNodeStore.getState().addNode(node);
    useNodeStore.getState().updateVideoTrim(node.id, 1.5, 9.5);

    const updated = useNodeStore.getState().getNodeData<VideoNodeData>(node.id);
    expect(updated?.trimStart).toBe(1.5);
    expect(updated?.trimEnd).toBe(9.5);
    expect(updated?.trimTaskStatus).toBeUndefined();
    expect(updated?.trimmedFileId).toBeUndefined();
  });
});
