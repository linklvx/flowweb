import '@testing-library/jest-dom/vitest';

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// jsdom lacks requestAnimationFrame
let rafId = 0;
global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = ++rafId;
  setTimeout(() => cb(performance.now()), 0);
  return id;
};
global.cancelAnimationFrame = (id: number): void => {
  // no-op in test environment
};
