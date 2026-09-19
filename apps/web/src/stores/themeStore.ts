// 主题 store（C1，spec §4.1）：真源 = documentElement 的 .light/.dark 类（非 React state）。
// - mode 三态（light/dark/system）持久化 localStorage['theme']；resolved 是 html 类的实际状态；
//   显式选择与 system 解析严格区分——matchMedia change 只重解析 system 档，显式档永不被 OS 覆盖。
// - 缺省/非法存储默认深（D3 兜底，非跟随系统）——与 index.html head 内联防闪白脚本同口径。
// - 懒加载契约：模块 import 零副作用（不碰 DOM/localStorage/matchMedia），首个 getSnapshot/
//   subscribe/setMode 调用时才初始化——vitest 既有用例不加载本 store 即不受影响。
// - useSyncExternalStore 兼容：subscribe/getSnapshot 直接可用，useTheme 为 React 绑定。
import { useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeState {
  /** 用户选择档（显式 light/dark 或 system） */
  mode: ThemeMode;
  /** html 类实际状态（system 档 = matchMedia 解析结果） */
  resolved: ResolvedTheme;
}

const STORAGE_KEY = 'theme';
const MEDIA_QUERY = '(prefers-color-scheme: light)';
/** SSR/懒加载前占位快照（D3 默认深）——getServerSnapshot 同引用 */
const INITIAL_STATE: ThemeState = { mode: 'dark', resolved: 'dark' };

let state: ThemeState = INITIAL_STATE;
let initialized = false;
const listeners = new Set<() => void>();

/** system 档解析：OS 浅 → light，否则 dark；matchMedia 不可用（SSR/极端环境）回落 dark */
function resolveSystem(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia(MEDIA_QUERY).matches ? 'light' : 'dark';
}

/** 读存储三态；缺省/非法/读抛（隐私模式）均回落 dark */
function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

/** html 恒有且仅有 .light/.dark 之一（C1 脚本契约，store 同口径维护） */
function applyClass(resolved: ResolvedTheme): void {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(resolved);
}

function setState(next: ThemeState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** matchMedia change：仅 system 档重解析重挂（spec §4.1——显式选择永不被 OS 覆盖） */
function onMediaChange(): void {
  if (state.mode !== 'system') return;
  const resolved = resolveSystem();
  if (resolved === state.resolved) return;
  applyClass(resolved);
  setState({ mode: 'system', resolved });
}

/** 幂等懒初始化：mode ← localStorage 真源；resolved ← html 类真源（内联脚本产物，缺失才按 mode 解析） */
function ensureInit(): void {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  const mode = readStoredMode();
  const classList = document.documentElement.classList;
  const htmlResolved: ResolvedTheme | null = classList.contains('light')
    ? 'light'
    : classList.contains('dark')
      ? 'dark'
      : null;
  const resolved = htmlResolved ?? (mode === 'system' ? resolveSystem() : mode);
  applyClass(resolved);
  state = { mode, resolved };
  if (typeof window.matchMedia === 'function') {
    window.matchMedia(MEDIA_QUERY).addEventListener('change', onMediaChange);
  }
}

/** 应用侧接线入口（main.tsx 调用）：激活 change 监听——system 档随 OS 实时翻转 */
export function initThemeSync(): void {
  ensureInit();
}

/** 三态切换：写 localStorage + 重解析（system 走 matchMedia）+ 挂 html 类 + 通知订阅者 */
export function setMode(mode: ThemeMode): void {
  ensureInit();
  const resolved: ResolvedTheme = mode === 'system' ? resolveSystem() : mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 隐私模式写失败——内存态与 html 类仍生效 */
  }
  applyClass(resolved);
  setState({ mode, resolved });
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
