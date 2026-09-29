// apps/web/src/utils/viewportPersistence.test.ts
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import { bindViewportPersistence, readViewport, viewportKey } from './viewportPersistence';

const PID = 'p1';

beforeEach(() => {
  localStorage.clear();
  useCanvasStore.setState({ viewport: { x: 0, y: 0, zoom: 1 }, isHydrating: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindViewportPersistence（viewport 本地偏好 debounce 写）', () => {
  it('多次 viewport 变化 debounce 500ms 合并——只写一次，值为最终状态', () => {
    vi.useFakeTimers();
    const unbind = bindViewportPersistence(PID);
    useCanvasStore.setState({ viewport: { x: 10, y: 20, zoom: 1 } });
    useCanvasStore.setState({ viewport: { x: 30, y: 40, zoom: 2 } });
    vi.advanceTimersByTime(499);
    expect(localStorage.getItem(viewportKey(PID))).toBeNull(); // 未到点不写
    vi.advanceTimersByTime(1);
    expect(JSON.parse(localStorage.getItem(viewportKey(PID))!)).toEqual({ x: 30, y: 40, zoom: 2 });
    unbind();
  });

  it('isHydrating 期间的 viewport 变化不调度写（恢复不算编辑）', () => {
    vi.useFakeTimers();
    const unbind = bindViewportPersistence(PID);
    useCanvasStore.setState({ isHydrating: true });
    useCanvasStore.setState({ viewport: { x: 1, y: 2, zoom: 1 } });
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(viewportKey(PID))).toBeNull();
    unbind();
  });

  it('unbind 清除挂起定时器与订阅——不再写', () => {
    vi.useFakeTimers();
    const unbind = bindViewportPersistence(PID);
    useCanvasStore.setState({ viewport: { x: 5, y: 5, zoom: 1 } });
    unbind();
    useCanvasStore.setState({ viewport: { x: 6, y: 6, zoom: 1 } });
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(viewportKey(PID))).toBeNull();
  });
});

describe('readViewport（恢复解析）', () => {
  it('合法 JSON → 返回 viewport 对象', () => {
    localStorage.setItem(viewportKey(PID), JSON.stringify({ x: 11, y: 22, zoom: 1.5 }));
    expect(readViewport(PID)).toEqual({ x: 11, y: 22, zoom: 1.5 });
  });

  it('坏 JSON → null（不抛）', () => {
    localStorage.setItem(viewportKey(PID), '{oops');
    expect(readViewport(PID)).toBeNull();
  });

  it('字段类型非法（zoom 非数值）→ null', () => {
    localStorage.setItem(viewportKey(PID), JSON.stringify({ x: 1, y: 2, zoom: 'big' }));
    expect(readViewport(PID)).toBeNull();
  });

  it('含多余键的合法 JSON → 只回三键（pick，多余键不入 store）', () => {
    localStorage.setItem(viewportKey(PID), JSON.stringify({ x: 1, y: 2, zoom: 3, extra: 'injected' }));
    expect(readViewport(PID)).toEqual({ x: 1, y: 2, zoom: 3 });
  });

  it('无存量 key → null', () => {
    expect(readViewport(PID)).toBeNull();
  });
});
