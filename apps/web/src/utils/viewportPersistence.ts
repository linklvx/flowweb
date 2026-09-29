// apps/web/src/utils/viewportPersistence.ts
import { useCanvasStore } from '@/stores/canvasStore';

const VP_PREFIX = 'flowweb_vp_';

export const viewportKey = (projectId: string) => VP_PREFIX + projectId;

/** viewport 本地偏好持久化（非协作数据——契约 5 v11）：订阅 cs.viewport debounce 500ms 写
 *  （viewport 每帧写 store——直写 localStorage 会阻塞主线程）。恢复：initCollab 完成后读 key set 进 store。 */
export function bindViewportPersistence(projectId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useCanvasStore.subscribe((state, prev) => {
    if (state.viewport === prev.viewport) return;
    if (state.isHydrating) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { localStorage.setItem(viewportKey(projectId), JSON.stringify(useCanvasStore.getState().viewport)); } catch { /* 隐私模式配额——忽略 */ }
    }, 500);
  });
  return () => { unsub(); if (timer) clearTimeout(timer); };
}

export function readViewport(projectId: string): { x: number; y: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(viewportKey(projectId));
    const v = raw ? JSON.parse(raw) : null;
    // pick 三键：校验只保证 x/y/zoom 合法，原样返回会把解析对象的其余键带入 store
    return v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number'
      ? { x: v.x, y: v.y, zoom: v.zoom }
      : null;
  } catch { return null; }
}
