import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMenuStore } from './menuStore';
import { useNodeStore } from './nodeStore';

describe('menuStore', () => {
  beforeEach(() => {
    useMenuStore.setState({ isOpen: false, position: undefined, triggerEl: null, lastMousePos: { x: 0, y: 0 }, handleMenu: undefined, styleLibrary: null, batchMenu: undefined });
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

  describe('styleLibrary 第三切片与三向互斥（spec §4.1）', () => {
    it('openStyleLibrary 置切片并清 isOpen/handleMenu', () => {
      useMenuStore.setState({ isOpen: true, position: { x: 1, y: 1 }, handleMenu: { x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } } as any });
      useMenuStore.getState().openStyleLibrary('img1');
      expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' });
      expect(useMenuStore.getState().isOpen).toBe(false);
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
    });

    it('open 清 styleLibrary 与 handleMenu（既有语义保持）', () => {
      useMenuStore.setState({ styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().open();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
    });

    it('openHandleMenu 清 styleLibrary（既有语义保持）', () => {
      useMenuStore.setState({ styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } });
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('openBatchMenu 清 isOpen/handleMenu/styleLibrary（B6-3 四向互斥——spec §4.1 同款）', () => {
      useMenuStore.setState({ isOpen: true, position: { x: 1, y: 1 }, handleMenu: { x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } } as any, styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().openBatchMenu({ x: 10, y: 10, flowPoint: { x: 100, y: 100 }, sourceIds: ['a'] });
      expect(useMenuStore.getState().batchMenu).toEqual({ x: 10, y: 10, flowPoint: { x: 100, y: 100 }, sourceIds: ['a'] });
      expect(useMenuStore.getState().isOpen).toBe(false);
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('openStyleLibrary/open/openHandleMenu 各清 batchMenu（四向互斥反向）', () => {
      useMenuStore.getState().openBatchMenu({ x: 10, y: 10, flowPoint: { x: 100, y: 100 }, sourceIds: ['a'] });
      useMenuStore.getState().openStyleLibrary('img1');
      expect(useMenuStore.getState().batchMenu).toBeUndefined();
      useMenuStore.getState().openBatchMenu({ x: 10, y: 10, flowPoint: { x: 100, y: 100 }, sourceIds: ['a'] });
      useMenuStore.getState().open();
      expect(useMenuStore.getState().batchMenu).toBeUndefined();
      useMenuStore.getState().openBatchMenu({ x: 10, y: 10, flowPoint: { x: 100, y: 100 }, sourceIds: ['a'] });
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } });
      expect(useMenuStore.getState().batchMenu).toBeUndefined();
    });

    it('closeStyleLibrary 清切片', () => {
      useMenuStore.getState().openStyleLibrary('img1');
      useMenuStore.getState().closeStyleLibrary();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('toggle 由关变开时清 handleMenu 与 styleLibrary（修既有缺陷，spec §4.1）', () => {
      useMenuStore.setState({ isOpen: false, handleMenu: { x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } } as any, styleLibrary: { nodeId: 'img1' } });
      useMenuStore.getState().toggle();
      expect(useMenuStore.getState().isOpen).toBe(true);
      expect(useMenuStore.getState().handleMenu).toBeUndefined();
      expect(useMenuStore.getState().styleLibrary).toBeNull();
    });

    it('三个 open 与 toggle 开分支均跨 store 调 exitReferenceSelect（menuStore→nodeStore 单向；关分支不触发）', () => {
      const exitSpy = vi.spyOn(useNodeStore.getState(), 'exitReferenceSelect');
      useMenuStore.getState().open();             // 1
      useMenuStore.getState().openHandleMenu({ x: 0, y: 0, nodeId: 'n', side: 'source', flowPoint: { x: 0, y: 0 } }); // 2
      useMenuStore.getState().openStyleLibrary('img1'); // 3
      useMenuStore.getState().toggle();           // 此刻 isOpen=false → 开分支 → 4
      expect(exitSpy).toHaveBeenCalledTimes(4);
      useMenuStore.getState().toggle();           // 由开变关 → 不触发
      expect(exitSpy).toHaveBeenCalledTimes(4);
      exitSpy.mockRestore();
    });
  });
});
