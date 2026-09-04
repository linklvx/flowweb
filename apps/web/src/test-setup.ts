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
// 仅测试环境生效：清空整个标签内容（测试不依赖视觉样式；生产浏览器支持这些选择符）。
// 若 antd 日后回读 textContent 做主题 diff 可能重复注入样式——升级 antd/jsdom 时需复查。
const originalInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function (this: Node, newNode: Node, referenceNode: Node | null) {
  if (newNode.nodeType === Node.ELEMENT_NODE && (newNode as Element).tagName === 'STYLE') {
    const styleEl = newNode as HTMLStyleElement;
    const text = styleEl.textContent;
    if (text && (text.includes(')+:') || text.includes(':has('))) {
      styleEl.textContent = '';
    }
  }
  return originalInsertBefore.call(this, newNode, referenceNode);
} as typeof Node.prototype.insertBefore;

// 上面的 insertBefore 拦截存在两条绕过路径（均实测命中）：
// 1) rc-util injectCSS 非 prepend 时走 container.appendChild(style)；
// 2) rc-util updateCSS 复用 head 中已存在的 <style> 时直接 existNode.innerHTML = css
//    （同文件第 2+ 次 render 复用第 1 次留下的标签 → 畸形选择符再次入 DOM）。
// 故在 HTMLStyleElement 的 innerHTML/textContent setter 层统一拦截。
const sanitizeStyleText = (v: unknown) =>
  typeof v === 'string' && (v.includes(')+:') || v.includes(':has(')) ? '' : v;
const styleTextProps: Array<[Element | Node, 'innerHTML' | 'textContent']> = [
  [Element.prototype, 'innerHTML'],
  [Node.prototype, 'textContent'],
];
for (const [proto, prop] of styleTextProps) {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (desc?.set) {
    const descSet = desc.set;
    Object.defineProperty(HTMLStyleElement.prototype, prop, {
      configurable: true,
      get: desc.get,
      set(value: unknown) {
        descSet.call(this as HTMLStyleElement, sanitizeStyleText(value));
      },
    });
  }
}

// ProComponents（rc-virtual-list 等）依赖 scrollIntoView/scrollTo，jsdom 未实现
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.scrollTo) (window as any).scrollTo = () => {};
