import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useMarqueeSelectionGuard } from './useMarqueeSelectionGuard';
import { useCanvasStore } from '@/stores/canvasStore';

function GuardProbe() {
  useMarqueeSelectionGuard();
  return <div data-testid="guard" />;
}

const setTrue = () =>
  useCanvasStore.setState((s) => (s.marqueeSelecting ? s : { marqueeSelecting: true }));

describe('useMarqueeSelectionGuard（spec §5-1 兜底复位——onSelectionEnd 主通道之外的 4 个 window 通道，标志作用域挂载）', () => {
  beforeEach(() => {
    useCanvasStore.setState({ marqueeSelecting: false });
  });
  afterEach(() => {
    useCanvasStore.setState({ marqueeSelecting: false });
  });

  it('标志 true 时挂载监听；window pointerup 复位 false', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('主通道 pointercancel 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('pointercancel')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('补充通道 pointermove buttons===0 复位（窗口外释放）', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new MouseEvent('pointermove', { buttons: 0 })); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('非左键 pointerup 不复位（框选拖拽中误触右键松开不提前解除抑制）', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new MouseEvent('pointerup', { button: 2 })); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(true);
  });

  it('次级通道 blur 复位', () => {
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('卸载兜底：标志 true 时 unmount → 复位 false（拖拽中切路由/错误边界/HMR 不卡死）', () => {
    const { unmount } = render(<GuardProbe />);
    act(() => setTrue());
    unmount();
    expect(useCanvasStore.getState().marqueeSelecting).toBe(false);
  });

  it('标志复位即卸载监听：复位后再派发 pointerup 不触发 setState（标志作用域验证）', () => {
    const spy = vi.spyOn(useCanvasStore, 'setState');
    render(<GuardProbe />);
    act(() => setTrue());
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    spy.mockClear();
    act(() => { window.dispatchEvent(new Event('pointerup')); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('§5-1.3 复位写法依据（zustand vanilla 语义钉死——guard 与 onSelectionEnd 共用的写法前提）', () => {
  it('函数式同引用不通知、partial 字面量必通知', () => {
    const listener = vi.fn();
    const unsub = useCanvasStore.subscribe(listener);
    useCanvasStore.setState((s) => s);
    expect(listener).not.toHaveBeenCalled();
    useCanvasStore.setState({ marqueeSelecting: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});
