// themeStore 单测（C8 D0 两态，spec 2026-09-20-canvas-domain-theme §7）：
// 真源=html 主题类；mode 两态（light/dark）持久化 localStorage['theme']；默认深（无跟随系统）；
// 'system' 残留读取侧映射 dark 不回写（P8）；storage 与 html 类冲突时 storage 优先并回挂（ensureInit 反转）。
// 懒加载契约：模块 import 零副作用——vi.resetModules + 每用例动态 import 取全新实例。
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

describe('themeStore（两态）', () => {
  let media: MatchMediaMock;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    media = installMatchMediaMock();
  });

  it('模块导入零副作用（懒加载契约）——不挂 html 类、不读写 localStorage', async () => {
    await loadStore();
    expect(htmlThemeClasses()).toEqual([]);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('无存储默认深（非跟随系统）——OS 浅下仍 mode=dark + html.dark，且不回写存储', async () => {
    media.set(true); // OS 浅：钉死「默认=深」而非「默认=跟随系统」
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('非法存储值同默认深', async () => {
    localStorage.setItem('theme', 'blue');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('显式 light：mode=light + html.light（OS 深下不变）', async () => {
    media.set(false);
    localStorage.setItem('theme', 'light');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('显式 dark：mode=dark + html.dark（OS 浅下不变）', async () => {
    media.set(true);
    localStorage.setItem('theme', 'dark');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it("'system' 残留 → 读取侧映射 dark + html.dark，且不回写存储（P8，保持 boot 不写盘契约）", async () => {
    media.set(true); // OS 浅——残留 system 也不跟随 OS，恒落深
    localStorage.setItem('theme', 'system');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
    expect(localStorage.getItem('theme'), '残留值原样保留，不回写').toBe('system');
  });

  it('storage 与 html 类冲突：storage 优先并回挂 html 类（ensureInit 反转，P8 配套）', async () => {
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.add('dark'); // 内联脚本历史产物与 storage 冲突
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses(), 'storage=light 必须重挂 html.light').toEqual(['light']);
  });

  it('读抛（隐私模式）+ html.light 提示 → light（三级回落第二级）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    document.documentElement.classList.add('light');
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'light' });
    expect(htmlThemeClasses()).toEqual(['light']);
  });

  it('读抛（隐私模式）+ 无 html 类 → dark（三级回落兜底）', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const { getSnapshot } = await loadStore();
    expect(getSnapshot()).toEqual({ mode: 'dark' });
    expect(htmlThemeClasses()).toEqual(['dark']);
  });

  it('setMode 两态：写 localStorage + 挂对应类 + 通知订阅者 + 快照引用更换', async () => {
    const store = await loadStore();
    const seen: Array<{ mode: string }> = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
    const before = store.getSnapshot();

    store.setMode('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(htmlThemeClasses()).toEqual(['light']);

    store.setMode('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(htmlThemeClasses()).toEqual(['dark']);

    expect(seen.length, '每次 setMode 通知一次（2 次）').toBe(2);
    expect(store.getSnapshot()).not.toBe(before);

    unsubscribe();
    store.setMode('light');
    expect(seen.length, '退订后不再通知').toBe(2);
  });

  it('useTheme：useSyncExternalStore 集成——首渲染取默认深，setMode 触发重渲染', async () => {
    const { useTheme, setMode } = await loadStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current).toEqual({ mode: 'dark' }); // 无存储默认深（懒 init 由首渲染触发）
    act(() => setMode('light'));
    expect(result.current).toEqual({ mode: 'light' });
  });
});
