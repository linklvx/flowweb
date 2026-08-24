import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useTrackCanvasPointerShift } from './useTrackCanvasPointerShift';
import { useCanvasStore } from '@/stores/canvasStore';

const flag = () => useCanvasStore.getState().lastPointerShiftKey;

let nodeEl: HTMLElement;

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useTrackCanvasPointerShift(ref);
  return (
    <div ref={ref}>
      <div className="react-flow">
        <div data-testid="node" ref={(el) => { if (el) nodeEl = el; }} />
        <svg data-testid="svg-icon"><path d="M0 0h10v10z" /></svg>
        <div className="react-flow__minimap" data-testid="minimap" />
        <div id="canvas-toolbar" data-testid="ctoolbar" />
      </div>
      <div id="node-toolbar-portal" data-testid="portal" />
    </div>
  );
}

// jsdom 无 PointerEvent 构造器；addEventListener 按 type 匹配，MouseEvent 携带所需属性
function pd(target: Element, opts: { shiftKey?: boolean; button?: number } = {}) {
  target.dispatchEvent(new MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: opts.button ?? 0, shiftKey: opts.shiftKey ?? false,
  }));
}

describe('useTrackCanvasPointerShift', () => {
  beforeEach(() => {
    useCanvasStore.setState({ lastPointerShiftKey: false });
    render(<Harness />);
  });
  afterEach(() => cleanup());

  it('.react-flow 内主键 Shift pointerdown → flag=true', () => {
    pd(nodeEl, { shiftKey: true });
    expect(flag()).toBe(true);
  });

  it('.react-flow 内主键无 Shift → flag=false', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(nodeEl, { shiftKey: false });
    expect(flag()).toBe(false);
  });

  it('节点内 SVG 元素目标（SVGElement 非 HTMLElement 子类）也采样 flag', () => {
    const path = document.querySelector('[data-testid="svg-icon"] path')!;
    pd(path, { shiftKey: true });
    expect(flag()).toBe(true);
  });

  it('非主键（button=2）不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(nodeEl, { shiftKey: false, button: 2 });
    expect(flag()).toBe(true);
  });

  it('MiniMap / canvas-toolbar 内 pointerdown 不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(document.querySelector('.react-flow__minimap')!, { shiftKey: false });
    pd(document.querySelector('#canvas-toolbar')!, { shiftKey: false });
    expect(flag()).toBe(true);
  });

  it('.react-flow 外（node-toolbar-portal 同层）不改 flag', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    pd(document.querySelector('[data-testid="portal"]')!, { shiftKey: false });
    expect(flag()).toBe(true);
  });

  it('capture 写入先于 bubble 读取（核心时序保证）', () => {
    useCanvasStore.setState({ lastPointerShiftKey: true });
    let bubbleRead: boolean | undefined;
    nodeEl.addEventListener('pointerdown', () => { bubbleRead = flag(); });
    pd(nodeEl, { shiftKey: false });
    expect(bubbleRead).toBe(false); // bubble 读到 capture 已写入的 false，而非旧值 true
  });

  it('unmount 后 dispatch 不改 flag（cleanup）', () => {
    cleanup();
    pd(nodeEl, { shiftKey: true });
    expect(flag()).toBe(false);
  });
});
