import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// jsdom lacks requestAnimationFrame
let rafId = 0;
const rafTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = ++rafId;
  const timeout = setTimeout(() => {
    rafTimeouts.delete(id);
    cb(performance.now());
  }, 0);
  rafTimeouts.set(id, timeout);
  return id;
};
global.cancelAnimationFrame = (id: number): void => {
  const timeout = rafTimeouts.get(id);
  if (timeout) {
    clearTimeout(timeout);
    rafTimeouts.delete(id);
  }
};
