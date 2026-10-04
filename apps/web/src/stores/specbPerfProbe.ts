// apps/web/src/stores/specbPerfProbe.ts
// B7-2（Spec B）性能冒烟 e2e 探针：URL 显式 ?perfProbe=1 时挂 window.__specbPerf——
// nightly Playwright（vite preview=prod 构建）在 page 上下文内量测的唯一通道：
//   - store.subscribe 计数（零差异⇒订阅回调=0 锚——zustand subscribe 在 prod 同样可用）；
//   - reconcileGroupGeometry 直呼计时（单次≤5ms 锚——同源模块引用，与 app 内调用共享 store 状态）；
//   - getDoc 惰性取当前会话 doc（挂载时点早于 hydration 完成也不失效）。
// prod 安全面：仅暴露同源模块引用（数据=会话自有画布——与页面自身可及面相同），不带 query 的普通访问
// 零挂载零成本（挂载点=CanvasPageInner，见 page.tsx 接线）。
import { useCanvasStore } from './canvasStore';
import { getDoc, reconcileGroupGeometry } from './canvasCollabRuntime';

export const SPECB_PERF_PROBE_KEY = '__specbPerf';

/** 挂载判定单源（测试消费同函数——默认不挂/带参挂两档） */
export function shouldAttachSpecbPerfProbe(search: string): boolean {
  return new URLSearchParams(search).has('perfProbe');
}

export function attachSpecbPerfProbe(): void {
  if (typeof window === 'undefined') return;
  if (!shouldAttachSpecbPerfProbe(window.location.search)) return;
  (window as unknown as Record<string, unknown>)[SPECB_PERF_PROBE_KEY] = {
    store: useCanvasStore,
    getDoc,
    reconcile: reconcileGroupGeometry,
  };
}
