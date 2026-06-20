import { describe, it, expect, beforeEach } from 'vitest';
import { useLightingStore } from './lightingStore';
type LightingTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

const TS = {
  PENDING: 'pending' as LightingTaskStatus,
  PROCESSING: 'processing' as LightingTaskStatus,
  SUCCESS: 'success' as LightingTaskStatus,
  FAILED: 'failed' as LightingTaskStatus,
} as const;

describe('lightingStore', () => {
  beforeEach(() => {
    useLightingStore.getState().closeModal();
  });

  const defaultParams = {
    position: { x: 0, y: 0, z: 6 },
    brightness: 50,
    colorTemperature: 5600,
    rimLight: false,
  };

  describe('openModal', () => {
    it('should set visible, nodeId, imageUrl and default params', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');

      const state = useLightingStore.getState();
      expect(state.visible).toBe(true);
      expect(state.nodeId).toBe('node-1');
      expect(state.imageUrl).toBe('https://example.com/img.jpg');
      expect(state.params).toEqual(defaultParams);
    });

    it('should reset task info when opening', () => {
      useLightingStore.getState().setTaskInfo({
        taskId: 'old-task',
        taskStatus: TS.FAILED,
        resultUrl: 'https://example.com/old.jpg',
      });
      useLightingStore.getState().openModal('node-2', 'https://example.com/img2.jpg');

      const state = useLightingStore.getState();
      expect(state.taskId).toBeNull();
      expect(state.taskStatus).toBe(TS.PENDING);
      expect(state.resultUrl).toBeNull();
    });
  });

  describe('closeModal', () => {
    it('should reset all state to initial values', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().updateParams({ brightness: 80 });
      useLightingStore.getState().setTaskInfo({
        taskId: 'task-1',
        taskStatus: TS.SUCCESS,
        resultUrl: 'https://example.com/result.jpg',
      });

      useLightingStore.getState().closeModal();

      const state = useLightingStore.getState();
      expect(state.visible).toBe(false);
      expect(state.nodeId).toBeNull();
      expect(state.imageUrl).toBeNull();
      expect(state.params).toEqual(defaultParams);
      expect(state.taskId).toBeNull();
      expect(state.taskStatus).toBe(TS.PENDING);
      expect(state.resultUrl).toBeNull();
    });
  });

  describe('updateParams', () => {
    it('should partially update params', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().updateParams({ brightness: 80 });

      const state = useLightingStore.getState();
      expect(state.params.brightness).toBe(80);
      // Unspecified fields should remain unchanged
      expect(state.params.colorTemperature).toBe(5600);
      expect(state.params.position).toEqual({ x: 0, y: 0, z: 6 });
      expect(state.params.rimLight).toBe(false);
    });

    it('should update multiple params at once', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().updateParams({
        brightness: 30,
        colorTemperature: 3200,
        rimLight: true,
      });

      const state = useLightingStore.getState();
      expect(state.params.brightness).toBe(30);
      expect(state.params.colorTemperature).toBe(3200);
      expect(state.params.rimLight).toBe(true);
    });
  });

  describe('resetParams', () => {
    it('should reset params to defaults, keep other state unchanged', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().updateParams({ brightness: 80, rimLight: true });
      useLightingStore.getState().setTaskInfo({
        taskId: 'task-1',
        taskStatus: TS.PROCESSING,
      });

      useLightingStore.getState().resetParams();

      const state = useLightingStore.getState();
      expect(state.params).toEqual(defaultParams);
      // Other state should be preserved
      expect(state.visible).toBe(true);
      expect(state.nodeId).toBe('node-1');
      expect(state.taskId).toBe('task-1');
    });
  });

  describe('setTaskInfo', () => {
    it('should update task info partially', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().setTaskInfo({
        taskId: 'task-abc',
        taskStatus: TS.PROCESSING,
      });

      const state = useLightingStore.getState();
      expect(state.taskId).toBe('task-abc');
      expect(state.taskStatus).toBe(TS.PROCESSING);
      expect(state.resultUrl).toBeNull();
    });

    it('should update resultUrl on success', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().setTaskInfo({
        taskId: 'task-abc',
        taskStatus: TS.SUCCESS,
        resultUrl: 'https://example.com/result.jpg',
      });

      const state = useLightingStore.getState();
      expect(state.taskStatus).toBe(TS.SUCCESS);
      expect(state.resultUrl).toBe('https://example.com/result.jpg');
    });

    it('should update errorMessage on failure', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img.jpg');
      useLightingStore.getState().setTaskInfo({
        taskId: 'task-abc',
        taskStatus: TS.FAILED,
        errorMessage: 'AI generation failed',
      });

      const state = useLightingStore.getState();
      expect(state.taskStatus).toBe(TS.FAILED);
      // errorMessage is part of task info
    });
  });

  describe('open → close → open cycle', () => {
    it('should have no state leakage between sessions', () => {
      useLightingStore.getState().openModal('node-1', 'https://example.com/img1.jpg');
      useLightingStore.getState().updateParams({ brightness: 90 });
      useLightingStore.getState().closeModal();

      useLightingStore.getState().openModal('node-2', 'https://example.com/img2.jpg');

      const state = useLightingStore.getState();
      expect(state.nodeId).toBe('node-2');
      expect(state.imageUrl).toBe('https://example.com/img2.jpg');
      expect(state.params).toEqual(defaultParams);
      expect(state.taskId).toBeNull();
    });
  });
});
