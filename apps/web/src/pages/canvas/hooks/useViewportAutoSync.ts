// apps/web/src/pages/canvas/hooks/useViewportAutoSync.ts
import { useCallback, useEffect, useRef } from 'react';
import { updateViewport } from '@/api/projectApi';
import { useCanvasStore } from '@/stores/canvasStore';

/** viewport 独立同步通道（spec D7）：onMoveEnd 低频触发 + 1s debounce，不参与结构 dirty/乐观锁 */
export function useViewportAutoSync() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onMoveEnd = useCallback(() => {
    const pid = useCanvasStore.getState().projectId;
    if (!pid) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // H-1 同款守卫：窗口内切项目/hydrate 期间触发则丢弃，防旧项目 viewport 写到新项目
      const cs = useCanvasStore.getState();
      if (cs.projectId !== pid || cs.isHydrating) return;
      updateViewport(pid, cs.viewport)
        .catch((e) => console.error('[canvasSync] viewport sync failed', e));
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { onMoveEnd };
}
