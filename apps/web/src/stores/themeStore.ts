// 主题 store（C8 D0 两态，spec 2026-09-20-canvas-domain-theme §7）：真源 = documentElement 的
// .light/.dark 类（非 React state）；mode 两态持久化 localStorage['theme']；无 system 档、无 matchMedia。
// - 缺省/非法存储默认深；'system' 残留读取侧映射 dark 不回写（P8）——残留**永不主动清理**（仅用户手动
//   切换覆盖），此为有意契约非遗漏；两标签页无 storage 事件同步（单用户开发期无影响，已知接受）。
// - mode 即唯一态（"用户选择"与"实际渲染"随 resolved 概念消亡不再可区分）——若将来做"跟随系统"回归
//   需重新引入第三概念，本简化是有意的（P1）。
// - 懒加载契约：模块 import 零副作用，首个 getSnapshot/subscribe/setMode 调用时才初始化。
// - useSyncExternalStore 兼容：subscribe/getSnapshot 直接可用，useTheme 为 React 绑定。
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark';

export interface ThemeState {
  /** 用户选择档 = html 类实际状态（两态单值，resolved 概念随 system 档消亡） */
  mode: ThemeMode;
}

const STORAGE_KEY = 'theme';
/** SSR/懒加载前占位快照（默认深）——getServerSnapshot 同引用 */
const INITIAL_STATE: ThemeState = { mode: 'dark' };

let state: ThemeState = INITIAL_STATE;
let initialized = false;
const listeners = new Set<() => void>();

/** 读存储两态；缺省/非法/'system' 残留/读抛（隐私模式）→ null（三级回落交 ensureInit：storage → html 类提示 → dark） */
function readStoredMode(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

/** html 恒有且仅有 .light/.dark 之一（内联脚本契约，store 同口径维护） */
function applyClass(mode: ThemeMode): void {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(mode);
}

function setState(next: ThemeState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** 幂等懒初始化（P8 反转）：storage 优先并回挂 html 类；storage 缺失回落 html 类提示（内联脚本产物），再回落 dark */
function ensureInit(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  const classList = document.documentElement.classList;
  const htmlHint: ThemeMode | null = classList.contains('light')
    ? 'light'
    : classList.contains('dark')
      ? 'dark'
      : null;
  const mode = readStoredMode() ?? htmlHint ?? 'dark';
  applyClass(mode);
  state = { mode };
}

/** 应用侧接线入口（main.tsx 调用）：显式初始化契约声明（spec §10.6——懒初始化下首帧与调用顺序无关） */
export function initThemeSync(): void {
  ensureInit();
}

/** 两态切换：写 localStorage + 挂 html 类 + 通知订阅者 */
export function setMode(mode: ThemeMode): void {
  ensureInit();
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式写失败——内存态与 html 类仍生效 */
  }
  applyClass(mode);
  setState({ mode });
}

export function subscribe(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): ThemeState {
  ensureInit();
  return state;
}

/** React 绑定（useSyncExternalStore：subscribe/getSnapshot 直接兼容） */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);
}
