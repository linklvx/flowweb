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

// Workaround for jsdom not supporting CSS selectors used by antd 5
// antd 5 的 cssinjs 会注入含 :has() / )+: 的选择符，jsdom 解析时抛 SyntaxError 导致组件被卸载。
// 测试不依赖视觉样式，直接清空含坏选择符的 style 标签内容。
const originalInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function (newNode: Node, referenceNode: Node | null) {
  if (newNode.nodeType === Node.ELEMENT_NODE && (newNode as Element).tagName === 'STYLE') {
    const styleEl = newNode as HTMLStyleElement;
    const text = styleEl.textContent;
    if (text && (text.includes(')+:') || text.includes(':has('))) {
      styleEl.textContent = '';
    }
  }
  return originalInsertBefore.call(this, newNode, referenceNode);
};
