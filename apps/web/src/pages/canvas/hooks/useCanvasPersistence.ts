import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';

const STORAGE_KEY = 'flowweb_canvas';

export function useCanvasPersistence(projectId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore from localStorage on mount
  useEffect(() => {
    const cached = localStorage.getItem(`${STORAGE_KEY}_${projectId}`);
    if (!cached) return;

    try {
      const data = JSON.parse(cached);
      const store = useCanvasStore.getState();

      // Restore viewport
      if (data.viewport) {
        store.updateViewport(data.viewport);
      }

      // Restore nodes
      if (data.nodes && data.nodes.length > 0) {
        store.onNodesChange(
          data.nodes.map((n: any) => ({
            type: 'add',
            item: {
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data,
            },
          }))
        );
      }

      // Restore edges
      if (data.edges && data.edges.length > 0) {
        store.onEdgesChange(
          data.edges.map((e: any) => ({
            type: 'add',
            item: {
              id: e.id,
              source: e.source,
              target: e.target,
            },
          }))
        );
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
      localStorage.setItem(
        `${STORAGE_KEY}_content_${projectId}`,
        JSON.stringify(state.nodes)
      );
    });

    return () => {
      unsub1();
      unsub2();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId]);
}
