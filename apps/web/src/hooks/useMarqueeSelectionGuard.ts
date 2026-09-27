import { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * marqueeSelecting 兜底复位（spec 2026-09-28 §5-1.2）。
 * 复位通道全景（5 个）：onSelectionEnd（CanvasView 主通道，正常路径）+ 本 hook 的 4 个 window
 * 通道——pointerup（左键，button 过滤——非左键时拖拽未必终止）/pointercancel（触发即拖拽必已
 * 终止）、pointermove(buttons===0)（窗口外释放时浏览器对 pointerup 派发行为不一）、blur（次级，
 * 接受拖拽中 alt-tab 的极小残留窗口）。
 * 标志为 true 期间全部操作浮层被抑制且无自愈——兜底是本设计唯一单点故障面。
 * 标志作用域挂载：非框选期全 app 零常驻开销，卡死时监听恰处激活态。
 * 复位必须函数式返回同引用：对象字面量 partial 永不 Object.is 等于整 state → 必通知全部
 * 裸订阅者（500ms 快照写 / collab O(n) diff 等，每次点击白跑）。
 * cleanup 复位：拖拽中组件卸载（切路由/错误边界/HMR）时标志不得卡 true（幂等——已是 false
 * 时同引用 no-op，早退于真实复位之后执行零副作用）。
 */
export function useMarqueeSelectionGuard() {
  const marqueeSelecting = useCanvasStore((s) => s.marqueeSelecting);
  useEffect(() => {
    if (!marqueeSelecting) return;
    const reset = () => {
      useCanvasStore.setState((s) => (s.marqueeSelecting ? { marqueeSelecting: false } : s));
    };
    const onMove = (e: MouseEvent) => {
      if (e.buttons === 0) reset();
    };
    // pointerup 只认左键（button 0；Event 无 button 字段时放行——jsdom 测试形态）：框选手势是
    // 左键，非左键 pointerup 时拖拽未必终止，提前复位会使剩余拖拽段浮层复现
    const onPointerUp = (e: Event) => {
      const button = (e as PointerEvent).button;
      if (button !== undefined && button !== 0) return;
      reset();
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('pointermove', onMove);
      reset();
    };
  }, [marqueeSelecting]);
}
