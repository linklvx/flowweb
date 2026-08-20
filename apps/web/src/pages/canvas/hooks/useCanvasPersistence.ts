import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

const STORAGE_KEY = 'flowweb_canvas';

export function useCanvasPersistence(projectId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore from localStorage on mount (only if store is empty)
  useEffect(() => {
    const store = useCanvasStore.getState();
    // Only restore if canvas is empty — prevents duplicates on re-render
    if (store.nodes.length > 0) return;

    const cached = localStorage.getItem(`${STORAGE_KEY}_${projectId}`);
    if (!cached) return;

    try {
      const data = JSON.parse(cached);

      // Restore viewport
      if (data.viewport) {
        store.updateViewport(data.viewport);
      }

      // Restore nodes — use setState to replace, not add
      if (data.nodes && data.nodes.length > 0) {
        useCanvasStore.setState({ nodes: data.nodes });
      }

      // Restore edges — use setState to replace, not add
      if (data.edges && data.edges.length > 0) {
        useCanvasStore.setState({ edges: data.edges });
      }
    } catch {
      // Corrupt cache — ignore
    }

    // Restore node content
    const cachedContent = localStorage.getItem(`${STORAGE_KEY}_content_${projectId}`);
    if (cachedContent) {
      try {
        const content = JSON.parse(cachedContent);
        useNodeStore.setState({ nodes: content });
      } catch {
        // ignore
      }
    }
  }, [projectId]);

  // Auto-save to localStorage on state changes (debounced for nodes/edges)
  useEffect(() => {
    const unsub1 = useCanvasStore.subscribe((state) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        localStorage.setItem(
          `${STORAGE_KEY}_${projectId}`,
          JSON.stringify({
            nodes: state.nodes,
            edges: state.edges,
            viewport: state.viewport,
          })
        );
      }, 500);
    });

    const unsub2 = useNodeStore.subscribe((state) => {
      const key = `${STORAGE_KEY}_content_${projectId}`;
      // 防污染：store 被动清空（如迟到空响应覆盖）时不回写，避免覆盖非空缓存
      if (Object.keys(state.nodes).length === 0) {
        const existing = localStorage.getItem(key);
        if (existing && existing !== '{}') return;
      }
      localStorage.setItem(key, JSON.stringify(state.nodes));
    });

    return () => {
      unsub1();
      unsub2();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId]);
}
