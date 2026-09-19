// themeStore 单测（C1，spec §4.1）：
// 真源=html 主题类；mode 三态 localStorage 持久化；system 档经 matchMedia 解析且随 change 重解析重挂；
// 显式档永不被媒体覆盖；缺省/非法存储默认深（D3 兜底，非跟随系统）。
// 懒加载契约：模块 import 零副作用——vi.resetModules + 每用例动态 import 取全新实例，
// 保证 vitest 既有用例不加载本 store 即不受任何 DOM/localStorage 副作用影响。
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMatchMediaMock, type MatchMediaMock } from './__tests__/matchMediaMock';

type ThemeModule = typeof import('./themeStore');

async function loadStore(): Promise<ThemeModule> {
  return import('./themeStore');
}

function htmlThemeClasses(): string[] {
  return Array.from(document.documentElement.classList).filter((c) => c === 'light' || c === 'dark');
}

describe('themeStore', () => {
  let media: MatchMediaMock;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    media = installMatchMediaMock();
  });

  it('模块导入零副作用（懒加载契约）——不挂 html 类、不读写 localStorage', async () => {
    await loadStore();
    expect(htmlThemeClasses()).toEqual([]);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('无存储默认深（D3 兜底非跟随系统）——OS 浅下仍 mode=resolved=dark + html.dark，且不回写存储', async () => {
    media.set(true); // OS 浅：钉死「默认=深」而非「默认=跟随系统」
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark', resolved: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('非法存储值同默认深', async () => {
    localStorage.setItem('theme', 'blue');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark', resolved: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('显式 light：resolved=mode + html.light', async () => {
    media.set(false); // OS 深：显式 light 与媒体无关
    localStorage.setItem('theme', 'light');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light', resolved: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('显式 dark：resolved=mode + html.dark', async () => {
    media.set(true); // OS 浅：显式 dark 与媒体无关
    localStorage.setItem('theme', 'dark');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark', resolved: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('system 档 OS 浅 → mode≠resolved 区分：{mode:"system", resolved:"light"} + html.light', async () => {
    media.set(true);
    localStorage.setItem('theme', 'system');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'system', resolved: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('system 档 OS 深 → resolved=dark + html.dark', async () => {
    media.set(false);
    localStorage.setItem('theme', 'system');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'system', resolved: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('init 采信 html 类为 resolved 真源（内联脚本产物优先于按媒体重算）', async () => {
    media.set(true); // 媒体现值浅
    localStorage.setItem('theme', 'system');
    document.documentElement.classList.add('dark'); // 内联脚本已挂深（历史解析产物）
    const { getSnapshot } = await loadStore();
    expect(getSnapshot().resolved).toBe('dark');
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('setMode 三态：写 localStorage + 挂对应类 + 通知订阅者 + 快照引用更换', async () => {
    const store = await loadStore();
    const seen: Array<{ mode: string; resolved: string }> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
    const before = store.getSnapshot();

    store.setMode('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(htmlThemeClasses()).toEqual(['light']);

    store.setMode('system'); // 媒体默认恒假（OS 深）→ 解析为 dark
    expect(localStorage.getItem('theme')).toBe('system');
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(store.getSnapshot()).toEqual({ mode: 'system', resolved: 'dark' });

    store.setMode('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(htmlThemeClasses()).toEqual(['dark']);

    expect(seen.length, '每次 setMode 通知一次（3 次）').toBe(3);
    expect(store.getSnapshot()).not.toBe(before);

    unsubscribe();
    store.setMode('light');
    expect(seen.length, '退订后不再通知').toBe(3);
  });

  it('system 档随媒体 change 重解析重挂 + 通知', async () => {
    localStorage.setItem('theme', 'system');
    const store = await loadStore();
    expect(store.getSnapshot().resolved).toBe('dark'); // OS 深起步

    const seen: Array<{ mode: string; resolved: string }> = [];
    store.subscribe(() => seen.push(store.getSnapshot()));
    media.set(true); // OS 翻浅 → change 监听重解析
    expect(store.getSnapshot()).toEqual({ mode: 'system', resolved: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
    expect(seen.length).toBe(1);

    media.set(false); // 再翻回深
    expect(store.getSnapshot().resolved).toBe('dark');
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('显式档不被媒体 change 覆盖（explicit wins over media）', async () => {
    localStorage.setItem('theme', 'light');
    const store = await loadStore();
    expect(store.getSnapshot().resolved).toBe('light');

    media.set(true); // OS 浅（同向）
    media.set(false); // OS 深（逆向）——显式 light 均不动
    expect(store.getSnapshot()).toEqual({ mode: 'light', resolved: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('setMode("system") 立即按当前媒体解析（非仅靠后续 change）', async () => {
    media.set(true);
    const store = await loadStore();
    store.setMode('system');
    expect(store.getSnapshot()).toEqual({ mode: 'system', resolved: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('useTheme：useSyncExternalStore 集成——首渲染取默认深，setMode 触发重渲染', async () => {
    const { useTheme, setMode } = await loadStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual({ mode: 'dark', resolved: 'dark' }); // 无存储默认深（懒 init 由首渲染触发）
    act(() => setMode('light'));
    expect(result.current).toEqual({ mode: 'light', resolved: 'light' });
  });
});
