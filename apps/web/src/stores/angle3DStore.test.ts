import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAngle3DStore } from './angle3DStore';
import { ANGLE3D_DEFAULTS, ANGLE3D_PRESETS, type Angle3DTaskStatus } from '@flowweb/shared';

const TS = {
  IDLE: 'idle' as Angle3DTaskStatus,
  PENDING: 'pending' as Angle3DTaskStatus,
  PROCESSING: 'processing' as Angle3DTaskStatus,
  SUCCESS: 'success' as Angle3DTaskStatus,
  FAILED: 'failed' as Angle3DTaskStatus,
} as const;

describe('angle3DStore', () => {
  beforeEach(() => {
    useAngle3DStore.getState().closeModal();
  });

  describe('openModal — new node', () => {
    it('should set visible, nodeId, imageUrl, canvasId and default params', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.visible).toBe(true);
      expect(state.nodeId).toBe('node-1');
      expect(state.imageUrl).toBe('https://example.com/img.jpg');
      expect(state.canvasId).toBe('canvas-1');
      expect(state.params).toEqual(ANGLE3D_DEFAULTS);
    });

    it('should reset task info when opening new node', () => {
      // Seed with old task state
      useAngle3DStore.getState().setTaskState({
        taskId: 'old-task',
        taskStatus: TS.FAILED,
        resultUrl: 'https://example.com/old.jpg',
      });
      useAngle3DStore.getState().openModal('node-2', 'https://example.com/img2.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.taskId).toBeNull();
      expect(state.taskStatus).toBe(TS.IDLE);
      expect(state.resultUrl).toBeNull();
      expect(state.errorMessage).toBeNull();
    });
  });

  describe('openModal — same node (reopen)', () => {
    it('should preserve params when reopening same node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 45, verticalAngle: 30, zoom: 3 });
      useAngle3DStore.getState().closeModal();

      // Reopen same node
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.visible).toBe(true);
      expect(state.params.horizontalAngle).toBe(45);
      expect(state.params.verticalAngle).toBe(30);
      expect(state.params.zoom).toBe(3);
    });

    it('should update imageUrl with fresh presigned URL on reopen', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/old-url.jpg', 'canvas-1');
      useAngle3DStore.getState().closeModal();

      // Reopen same node with fresh presigned URL
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/fresh-presigned-url.jpg', 'canvas-1');

      expect(useAngle3DStore.getState().imageUrl).toBe('https://example.com/fresh-presigned-url.jpg');
    });

    it('should preserve taskInfo when reopening same node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().setTaskState({
        taskId: 'task-abc',
        taskStatus: TS.PROCESSING,
      });
      useAngle3DStore.getState().closeModal();

      // Reopen same node
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.taskId).toBe('task-abc');
      expect(state.taskStatus).toBe(TS.PROCESSING);
    });

    it('should preserve estimatedCredits when reopening same node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().setEstimatedCredits(25);
      useAngle3DStore.getState().closeModal();
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');

      expect(useAngle3DStore.getState().estimatedCredits).toBe(25);
    });
  });

  describe('openModal — different node', () => {
    it('should reset params when switching to different node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img1.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 45 });
      useAngle3DStore.getState().closeModal();

      // Open different node
      useAngle3DStore.getState().openModal('node-2', 'https://example.com/img2.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.nodeId).toBe('node-2');
      expect(state.imageUrl).toBe('https://example.com/img2.jpg');
      expect(state.params).toEqual(ANGLE3D_DEFAULTS);
    });

    it('should clear task info when switching to different node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img1.jpg', 'canvas-1');
      useAngle3DStore.getState().setTaskState({
        taskId: 'task-1',
        taskStatus: TS.PROCESSING,
      });
      useAngle3DStore.getState().closeModal();
      useAngle3DStore.getState().openModal('node-2', 'https://example.com/img2.jpg', 'canvas-1');

      expect(useAngle3DStore.getState().taskId).toBeNull();
      expect(useAngle3DStore.getState().taskStatus).toBe(TS.IDLE);
    });
  });

  describe('closeModal', () => {
    it('should set visible=false but preserve business data', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 90 });
      useAngle3DStore.getState().setTaskState({ taskId: 't-1', taskStatus: TS.SUCCESS });

      useAngle3DStore.getState().closeModal();

      const state = useAngle3DStore.getState();
      expect(state.visible).toBe(false);
      expect(state.nodeId).toBe('node-1');
      expect(state.params.horizontalAngle).toBe(90);
      expect(state.taskId).toBe('t-1');
      expect(state.taskStatus).toBe(TS.SUCCESS);
    });
  });

  describe('updateParams', () => {
    it('should partially update params', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 90 });

      const state = useAngle3DStore.getState();
      expect(state.params.horizontalAngle).toBe(90);
      expect(state.params.verticalAngle).toBe(ANGLE3D_DEFAULTS.verticalAngle);
      expect(state.params.zoom).toBe(ANGLE3D_DEFAULTS.zoom);
    });

    it('should update multiple params at once', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({
        horizontalAngle: 30,
        verticalAngle: -15,
        zoom: 7,
        customPrompt: 'test prompt',
      });

      const state = useAngle3DStore.getState();
      expect(state.params.horizontalAngle).toBe(30);
      expect(state.params.verticalAngle).toBe(-15);
      expect(state.params.zoom).toBe(7);
      expect(state.params.customPrompt).toBe('test prompt');
    });
  });

  describe('applyPreset', () => {
    it('should apply all three angle params from preset', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().applyPreset('fisheye');

      const preset = ANGLE3D_PRESETS.find((p) => p.key === 'fisheye')!;
      const state = useAngle3DStore.getState();
      expect(state.params.horizontalAngle).toBe(preset.horizontalAngle);
      expect(state.params.verticalAngle).toBe(preset.verticalAngle);
      expect(state.params.zoom).toBe(preset.zoom);
    });

    it('should not modify params for unknown key', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 45 });
      useAngle3DStore.getState().applyPreset('nonexistent' as any);

      expect(useAngle3DStore.getState().params.horizontalAngle).toBe(45);
    });
  });

  describe('resetParams', () => {
    it('should reset params to defaults, keep other state unchanged', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 80, zoom: 2 });
      useAngle3DStore.getState().setTaskState({ taskId: 't-1', taskStatus: TS.PROCESSING });

      useAngle3DStore.getState().resetParams();

      const state = useAngle3DStore.getState();
      expect(state.params).toEqual(ANGLE3D_DEFAULTS);
      expect(state.visible).toBe(true);
      expect(state.nodeId).toBe('node-1');
      expect(state.taskId).toBe('t-1');
      expect(state.taskStatus).toBe(TS.PROCESSING);
    });
  });

  describe('setTaskState', () => {
    beforeEach(() => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
    });

    it('should update task info partially', () => {
      useAngle3DStore.getState().setTaskState({
        taskId: 'task-abc',
        taskStatus: TS.PROCESSING,
      });

      const state = useAngle3DStore.getState();
      expect(state.taskId).toBe('task-abc');
      expect(state.taskStatus).toBe(TS.PROCESSING);
      expect(state.resultUrl).toBeNull();
    });

    it('should update resultUrl on success', () => {
      useAngle3DStore.getState().setTaskState({
        taskId: 'task-xyz',
        taskStatus: TS.SUCCESS,
        resultUrl: 'https://example.com/result.jpg',
      });

      const state = useAngle3DStore.getState();
      expect(state.taskStatus).toBe(TS.SUCCESS);
      expect(state.resultUrl).toBe('https://example.com/result.jpg');
    });

    it('should update errorMessage on failure', () => {
      useAngle3DStore.getState().setTaskState({
        taskStatus: TS.FAILED,
        errorMessage: 'Generation failed',
      });

      expect(useAngle3DStore.getState().errorMessage).toBe('Generation failed');
    });

    it('should not overwrite unprovided fields', () => {
      useAngle3DStore.getState().setTaskState({
        taskId: 'tid-1',
        taskStatus: TS.PENDING,
      });
      useAngle3DStore.getState().setTaskState({ resultUrl: 'https://example.com/r.jpg' });

      const state = useAngle3DStore.getState();
      expect(state.taskId).toBe('tid-1');
      expect(state.taskStatus).toBe(TS.PENDING);
      expect(state.resultUrl).toBe('https://example.com/r.jpg');
    });
  });

  describe('setEstimatedCredits', () => {
    it('should update estimatedCredits', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().setEstimatedCredits(25);

      expect(useAngle3DStore.getState().estimatedCredits).toBe(25);
    });
  });

  describe('retryTask', () => {
    it('should reset taskStatus to idle while preserving params', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 45 });
      useAngle3DStore.getState().setTaskState({
        taskId: 't-1',
        taskStatus: TS.FAILED,
        errorMessage: 'fail',
      });

      useAngle3DStore.getState().retryTask();

      const state = useAngle3DStore.getState();
      expect(state.taskStatus).toBe(TS.IDLE);
      expect(state.errorMessage).toBeNull();
      expect(state.resultUrl).toBeNull();
      expect(state.params.horizontalAngle).toBe(45);
    });
  });

  describe('node callbacks (Map-based isolation)', () => {
    it('should store and invoke callbacks per nodeId', () => {
      const onReplace = vi.fn();
      const onCreate = vi.fn();

      useAngle3DStore.getState().setNodeCallbacks('node-1', {
        onReplaceCurrentNode: onReplace,
        onCreateNewNode: onCreate,
      });

      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().replaceCurrentNode('https://example.com/result.jpg');
      expect(onReplace).toHaveBeenCalledWith('https://example.com/result.jpg');

      useAngle3DStore.getState().createNewNode('https://example.com/result2.jpg');
      expect(onCreate).toHaveBeenCalledWith('https://example.com/result2.jpg');
    });

    it('should isolate callbacks between different nodes', () => {
      const onReplace1 = vi.fn();
      const onReplace2 = vi.fn();

      useAngle3DStore.getState().setNodeCallbacks('node-1', {
        onReplaceCurrentNode: onReplace1,
        onCreateNewNode: vi.fn(),
      });
      useAngle3DStore.getState().setNodeCallbacks('node-2', {
        onReplaceCurrentNode: onReplace2,
        onCreateNewNode: vi.fn(),
      });

      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().replaceCurrentNode('https://example.com/result.jpg');

      expect(onReplace1).toHaveBeenCalledWith('https://example.com/result.jpg');
      expect(onReplace2).not.toHaveBeenCalled();
    });

    it('should clear callback on null', () => {
      const onReplace = vi.fn();
      useAngle3DStore.getState().setNodeCallbacks('node-1', {
        onReplaceCurrentNode: onReplace,
        onCreateNewNode: vi.fn(),
      });
      useAngle3DStore.getState().setNodeCallbacks('node-1', null);

      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().replaceCurrentNode('https://example.com/result.jpg');

      expect(onReplace).not.toHaveBeenCalled();
    });
  });

  describe('open → close → open cycle', () => {
    it('should have no leakage between different nodes', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img1.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 90 });
      useAngle3DStore.getState().closeModal();

      useAngle3DStore.getState().openModal('node-2', 'https://example.com/img2.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.nodeId).toBe('node-2');
      expect(state.imageUrl).toBe('https://example.com/img2.jpg');
      expect(state.params).toEqual(ANGLE3D_DEFAULTS);
      expect(state.taskId).toBeNull();
    });

    it('should preserve state within same node', () => {
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');
      useAngle3DStore.getState().updateParams({ horizontalAngle: 90, zoom: 2 });
      useAngle3DStore.getState().setTaskState({ taskId: 't-1', taskStatus: TS.PROCESSING });
      useAngle3DStore.getState().closeModal();
      useAngle3DStore.getState().openModal('node-1', 'https://example.com/img.jpg', 'canvas-1');

      const state = useAngle3DStore.getState();
      expect(state.params.horizontalAngle).toBe(90);
      expect(state.params.zoom).toBe(2);
      expect(state.taskId).toBe('t-1');
      expect(state.taskStatus).toBe(TS.PROCESSING);
    });
  });
});
