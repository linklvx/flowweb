import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

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

// Y0b-5 T18（出口判据 ⑲）：全仓 unhandledRejection 测试基座——任何未处理拒绝让所在用例失败。
// 缺口实证（2026-10-12 探针）：vitest 2.1 只把它记进侧栏 Errors（run exit 1）而用例本身仍绿；
// 挂 process 监听后 Node 不再走默认升级（白名单可行——abort 族探针 exit 0 零 Errors），
// throw 只能回注侧栏。故归因路径=process 锚定注册表+afterEach 清算：用例红；throw 保留作
// run 级兜底（末用例后库定时器 reject 无 afterEach 可挂——侧栏 Errors→exit 1）。
// 注册表/监听安装均锚 process：setup 逐文件重跑（worker 内模块注册表重置而 process 常驻），
// 模块级状态会断链（文件 2 的 afterEach 读到新空表=假绿）或重装（双计数）。
const UNHANDLED_REJECTION_ALLOWLIST: readonly RegExp[] = [
  /abort/i, // abort 族（AbortError/'This operation was aborted' 等 AbortController teardown 竞态类库 flaky——起始仅此族，按全量实跑追加登记）
];
const isAllowlistedRejection = (reason: unknown): boolean => {
  const text =
    typeof reason === 'object' && reason !== null
      ? `${String((reason as { name?: unknown }).name ?? '')} ${String((reason as { message?: unknown }).message ?? '')}`
      : String(reason);
  return UNHANDLED_REJECTION_ALLOWLIST.some((re) => re.test(text));
};
const describeRejection = (reason: unknown): string =>
  reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
const GUARD_KEY = '__flowwebUnhandledRejectionGuard__';
const guard = ((process as unknown as Record<string, unknown>)[GUARD_KEY] ??= {
  pending: [] as unknown[],
  installed: false,
}) as { pending: unknown[]; installed: boolean };
if (!guard.installed) {
  guard.installed = true;
  process.on('unhandledRejection', (reason: unknown) => {
    if (isAllowlistedRejection(reason)) return; // 白名单：放行（防 abort 类库 flaky 炸全量）
    guard.pending.push(reason);
    throw reason; // run 级兜底：uncaughtException→vitest 侧栏 Errors（末用例后路径）
  });
}
afterEach(() => {
  const pending = guard.pending.splice(0);
  if (pending.length) {
    throw new Error(
      `unhandled rejection×${pending.length}（出口判据 ⑲——本用例期内未处理拒绝）首条: ${describeRejection(pending[0])}`,
    );
  }
});
