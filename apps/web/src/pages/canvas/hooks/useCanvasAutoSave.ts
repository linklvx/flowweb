import { useEffect } from 'react';
import { bindCanvasSync, flushOnUnload } from '@/stores/canvasSyncRuntime';

/** 自动保存生命周期：projectId 就绪后绑定判脏订阅 + pagehide 兜底。
 *  ⚠️ cleanup 不做 unmount flush：项目切换时 cleanup 执行晚于 store 清空/新数据写入、
 *  早于 canvasStore.projectId 更新——此刻 flush 会把空画布/新项目数据写到旧项目（跨项目脏写）。
 *  路由切走丢改窗口 ≤2s，由 localStorage 快照与下次进入兜底 */
export function useCanvasAutoSave(projectId: string | null) {
  useEffect(() => {
    if (!projectId) return;
    const unbind = bindCanvasSync();
    const onPageHide = () => flushOnUnload();
    window.addEventListener('pagehide', onPageHide);
    return () => {
      unbind();
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [projectId]);
}
