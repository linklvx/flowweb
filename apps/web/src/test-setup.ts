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
// Ant Design 5+ uses :has() and complex selectors that jsdom's nwsapi doesn't parse
// We intercept style tag insertion to filter out problematic CSS rules
const originalInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function (newNode: Node, referenceNode: Node | null) {
  if (newNode.nodeType === Node.ELEMENT_NODE && (newNode as Element).tagName === 'STYLE') {
    const styleEl = newNode as HTMLStyleElement;
    const originalText = styleEl.textContent;
    if (originalText && (originalText.includes(')+:') || originalText.includes(':has('))) {
      // Filter out problematic CSS rules
      const filtered = originalText
        .split('}')
        .map((rule) => {
          const selectorPart = rule.split('{')[0];
          if (selectorPart.includes(')+:') || selectorPart.includes(':has(')) {
            return ''; // Remove problematic rules
          }
          return rule;
        })
        .filter((rule) => rule.trim())
        .join('}');
      styleEl.textContent = filtered;
    }
  }
  return originalInsertBefore.call(this, newNode, referenceNode);
};
