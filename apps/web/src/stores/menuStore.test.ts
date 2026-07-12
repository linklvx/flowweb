import { describe, it, expect, beforeEach } from 'vitest';
import { useMenuStore } from './menuStore';

describe('menuStore', () => {
  beforeEach(() => {
    useMenuStore.setState({ isOpen: false, position: undefined, triggerEl: null, lastMousePos: { x: 0, y: 0 } });
  });

  describe('open', () => {
    it('should set isOpen to true without position (for + button trigger)', () => {
      useMenuStore.getState().open();
      expect(useMenuStore.getState().isOpen).toBe(true);
      expect(useMenuStore.getState().position).toBeUndefined();
    });

    it('should set isOpen and position when called with coordinates (for right-click)', () => {
      useMenuStore.getState().open({ x: 300, y: 400 });
      expect(useMenuStore.getState().isOpen).toBe(true);
      expect(useMenuStore.getState().position).toEqual({ x: 300, y: 400 });
    });
  });

  describe('close', () => {
    it('should set isOpen to false and clear position', () => {
      useMenuStore.setState({ isOpen: true, position: { x: 100, y: 200 } });
      useMenuStore.getState().close();
      expect(useMenuStore.getState().isOpen).toBe(false);
      expect(useMenuStore.getState().position).toBeUndefined();
    });
  });

  describe('toggle', () => {
    it('should toggle isOpen, not affect position', () => {
      useMenuStore.setState({ isOpen: false, position: { x: 500, y: 600 } });
      useMenuStore.getState().toggle();
      expect(useMenuStore.getState().isOpen).toBe(true);
      expect(useMenuStore.getState().position).toEqual({ x: 500, y: 600 });
    });
  });

  describe('setTriggerEl', () => {
    it('should store the trigger button element', () => {
      const btn = document.createElement('button');
      useMenuStore.getState().setTriggerEl(btn);
      expect(useMenuStore.getState().triggerEl).toBe(btn);
    });

    it('should clear the trigger element when passed null', () => {
      const btn = document.createElement('button');
      useMenuStore.getState().setTriggerEl(btn);
      useMenuStore.getState().setTriggerEl(null);
      expect(useMenuStore.getState().triggerEl).toBeNull();
    });
  });

  describe('updateMousePos', () => {
    it('should update lastMousePos', () => {
      useMenuStore.getState().updateMousePos({ x: 600, y: 300 });
      expect(useMenuStore.getState().lastMousePos).toEqual({ x: 600, y: 300 });
    });
  });
});
