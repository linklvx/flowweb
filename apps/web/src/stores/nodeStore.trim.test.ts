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

  describe('setTrimTaskStatus', () => {
    it('should update trimTaskStatus on a video node', () => {
      const node = createVideoNode();
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().setTrimTaskStatus(node.id, 'processing');

      const updated = useNodeStore.getState().getNodeData<VideoNodeData>(node.id);
      expect(updated?.trimTaskStatus).toBe('processing');
    });

    it('should be a no-op when node does not exist', () => {
      expect(() => {
        useNodeStore.getState().setTrimTaskStatus('nonexistent', 'done');
      }).not.toThrow();
    });
  });

  describe('setTrimmedResult', () => {
    it('should set trimmedFileId and update status to done', () => {
      const node = createVideoNode();
      useNodeStore.getState().addNode(node);

      useNodeStore.getState().setTrimmedResult(node.id, 'trimmed-file-xyz');

      const updated = useNodeStore.getState().getNodeData<VideoNodeData>(node.id);
      expect(updated?.trimmedFileId).toBe('trimmed-file-xyz');
      expect(updated?.trimTaskStatus).toBe('done');
    });

    it('should be a no-op when node does not exist', () => {
      expect(() => {
        useNodeStore.getState().setTrimmedResult('nonexistent', 'file-123');
      }).not.toThrow();
    });
  });
});
