import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * B4'-1（Spec B）拖动手势常驻指针监听+pointerdown 缓存 id+capture 抑制。
 *
 * 常驻注册（[] 依赖挂载一次+session 引用守卫——终裁 37①）：监听清单模板=useMarqueeSelectionGuard
 * （先例只借清单、终形常驻——先例实为条件注册[激活期挂摘]，常驻防挂摘中间失败=泄漏类漂移入口）。
 * 处理器经 useCanvasStore.getState() 读 session（守卫——无 session 零动作），不订阅不重挂。
 *
 * 监听族（spec §3.2.6）：
 * - pointerup/pointercancel：activePointers 按 pointerId 移除（键控集合活性维护——pointercancel
 *   不作取消原语仅记账，终裁 31④；不继承 button===0 过滤——window 级 up 不按 button 判，终裁 37①）。
 *   收尾不在此触发——归 watchdog/自愈（pointerup 只维护集合）。
 * - pointermove[buttons===0]：吞 pointerup 检出（自愈）⇒ endGesture('healed')；[buttons!==0] 手势
 *   活动刷新（noteDragActivity——lastActivityAt+watchdog 重挂）。
 * - blur：吞 pointerup 次级自愈通道（窗外释手/alt-tab——marquee guard 同通道先例）。
 * - touchmove[capture,passive:false]：capture 抑制窗=session∧drag∧touches>1 ⇒ preventDefault
 *   （RF 多指 pan/zoom 抑制）；不含 touchcancel（终裁 31③）。
 *
 * pointerdown 缓存 id（canvas wrapper capture 消费 onPointerDownCapture）：仅 session 未活跃时
 * 更新缓存——session 内第二指 down 不覆盖（终裁 58 小项）；begin 消费 pointerIdRef 为起始
 * pointerId（onNodeDragStart 事件无稳定 pointerId 面——wrapper capture 先记）。
 */
export function useDragGestureGuard() {
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const s = useCanvasStore.getState().dragSession;
      if (!s) return;
      s.activePointers.delete(e.pointerId);   // 键控维护：按 id 移除（无命中幂等——touchend+pointerup 同帧双上报下首指存活）
    };
    const onPointerCancel = (e: PointerEvent) => {
      const s = useCanvasStore.getState().dragSession;
      if (!s) return;
      s.activePointers.delete(e.pointerId);   // 活性维护保留（终裁 31④）——不作取消原语
    };
    const onPointerMove = (e: PointerEvent) => {
      const st = useCanvasStore.getState();
      if (!st.dragSession) return;
      if (e.buttons === 0) {
        st.endGesture('healed');              // 吞 pointerup 检出（指针已起未达 up——自愈）
        return;
      }
      st.noteDragActivity();                  // 活动刷新（watchdog 每次活动重挂——主道）
    };
    const onBlur = () => {
      const st = useCanvasStore.getState();
      if (st.dragSession) st.endGesture('healed');
    };
    const onTouchMove = (e: TouchEvent) => {
      const s = useCanvasStore.getState().dragSession;
      if (s && s.gestureKind === 'drag' && e.touches.length > 1) e.preventDefault();
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('blur', onBlur);
    window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('touchmove', onTouchMove, { capture: true });
      // 卸载兜底（路由切走/组件树拆）：监听摘除后 activePointers 永不可排空（up/cancel 通道已亡）
      // ⇒ watchdog 无限续挂僵尸会话——让位保护悬挂、远端几何写被吞直至下一次 begin。会话仍活
      // ⇒ abort 族收尾（回滚 baseline+清 session/watchdog+reconcile）。
      if (useCanvasStore.getState().dragSession) useCanvasStore.getState().endGesture('aborted');
    };
  }, []);

  // wrapper capture：pointerdown 缓存 id（仅 session 未活跃时更新——session 内第二指 down 不覆盖）
  const onPointerDownCapture = useCallback((e: { pointerId?: number }) => {
    if (!useCanvasStore.getState().dragSession && e.pointerId != null) {
      pointerIdRef.current = e.pointerId;
    }
  }, []);

  return useMemo(() => ({ pointerIdRef, onPointerDownCapture }), [onPointerDownCapture]);
}
