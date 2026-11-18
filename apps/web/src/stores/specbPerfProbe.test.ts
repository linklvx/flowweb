// apps/web/src/stores/specbPerfProbe.test.ts
// B7-2 性能探针门控两档：无参零挂载（普通访问零成本）/ ?perfProbe=1 挂载三引用
//（store/getDoc——与 app 内调用同源模块引用，非拷贝；Y2 A3：reconcile 条目随仲裁体系退役）。
import { describe, it, expect, afterEach } from 'vitest';
import { shouldAttachSpecbPerfProbe, attachSpecbPerfProbe, SPECB_PERF_PROBE_KEY } from './specbPerfProbe';

declare global {
  interface Window { [k: string]: unknown }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[SPECB_PERF_PROBE_KEY];
});

describe('specbPerfProbe（B7-2 e2e 量测通道——URL 显式 opt-in）', () => {
  it('无参：不挂载（普通访问零成本——prod 面零新增全局）', () => {
    expect(shouldAttachSpecbPerfProbe('')).toBe(false);
    expect(shouldAttachSpecbPerfProbe('?projectId=x')).toBe(false);
    attachSpecbPerfProbe(); // jsdom location.search 默认空——不挂
    expect((window as unknown as Record<string, unknown>)[SPECB_PERF_PROBE_KEY]).toBeUndefined();
  });

  it('?perfProbe=1：挂载 store/getDoc 两引用（同源模块导出，非快照拷贝——Y2 A3 起 reconcile 条目退役）', () => {
    expect(shouldAttachSpecbPerfProbe('?perfProbe=1')).toBe(true);
    expect(shouldAttachSpecbPerfProbe('?a=1&perfProbe=&b=2')).toBe(true); // has() 语义——空值也算显式在场
    window.history.replaceState(null, '', '/canvas?projectId=p&perfProbe=1');
    try {
      attachSpecbPerfProbe();
      const probe = (window as unknown as Record<string, unknown>)[SPECB_PERF_PROBE_KEY] as {
        store: { getState: unknown; subscribe: unknown }; getDoc: unknown;
      };
      expect(probe).toBeTruthy();
      expect(typeof probe.store.getState).toBe('function');
      expect(typeof probe.store.subscribe).toBe('function');      // 订阅计数通道
      expect(typeof probe.getDoc).toBe('function');               // 惰性 doc 句柄
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
