import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { SNAPSHOT_VERSION, loadSnapshot, snapshotKey } from './canvasSnapshot';
import { hydrateNodes } from '@/utils/nodeOrder';

// 旧 key 清扫单次执行 flag：hook 随 projectId 变化重跑 effect，避免重复全量扫描
let hasCleanedOldLocalKeys = false;

const OLD_KEY_PATTERNS = [
  /^flowweb_canvas_content_/,
  /^flowweb_canvas_(?!v2_)/,
];

function sweepOldKeys() {
  if (hasCleanedOldLocalKeys) return;
  hasCleanedOldLocalKeys = true;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && OLD_KEY_PATTERNS.some((re) => re.test(key))) {
      localStorage.removeItem(key);
      i--;
    }
  }
}

export function useCanvasPersistence(projectId: string) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore from localStorage on mount (only if store is empty — DB 加载优先，本地兜底，串行不竞争)
  useEffect(() => {
    sweepOldKeys();

    const store = useCanvasStore.getState();
    if (store.nodes.length > 0) return;

    const snap = loadSnapshot(projectId);
    if (!snap) return;

    useCanvasStore.getState().setHydrating(true);
    try {
      useNodeStore.setState({ nodes: snap.nodes });
      useCanvasStore.setState({
        nodes: hydrateNodes(
          Object.values(snap.nodes).map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data as unknown as Record<string, unknown>,
            width: n.width,
            height: n.height,
          })),
          snap.parentMap,
        ) as any,
        edges: snap.edges,
        viewport: snap.viewport,
      });
      // 对齐 DB 加载路径（loadProjectIntoStore）：恢复后派生 storyboard 子节点 hidden 等组状态
      useCanvasStore.getState().applyGroupDerivations();
      // 对齐 DB 加载路径 P0-4：展开普通组按子节点重算；手动 resize 过的组保留用户尺寸。
      // 快照 AppNode 通常带组宽高（hydrate 已恢复），从未折叠过的手动组无 savedSize——
      // 只要有 manuallyResized 标记就不 refit，savedSize 仅作宽高缺失时的兜底（T8 端到端发现）
      for (const g of useCanvasStore.getState().nodes.filter(
        (n) => n.type === 'group' && (n.data as any).groupType === 'normal' && !(n.data as any).collapsed,
      )) {
        const d = g.data as any;
        if (d.manuallyResized) {
          if (d.savedSize && (g.width == null || g.height == null)) {
            useCanvasStore.setState({
              nodes: useCanvasStore.getState().nodes.map((n) =>
                n.id === g.id ? { ...n, width: d.savedSize.width, height: d.savedSize.height } : n),
            });
          }
        } else {
          useCanvasStore.getState().refitGroupBounds(g.id);
        }
      }
    } finally {
      useCanvasStore.getState().setHydrating(false);
    }
  }, [projectId]);

  // Auto-save merged snapshot (single writer, shared 500ms debounce across both stores)
  useEffect(() => {
    const scheduleWrite = (hydratingNow: boolean, wasHydrating: boolean) => {
      if (hydratingNow) {
        // S1: hydrate 窗口内不调度，并清除挂起定时器，防止 hydrate 结束后旧回调脏写
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        return;
      }
      // hydrate 结束的过渡事件本身不调度——窗口内的实质变化已被抑制，无新内容可写
      if (wasHydrating) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (useCanvasStore.getState().isHydrating) return;
        const cs = useCanvasStore.getState();
        localStorage.setItem(
          snapshotKey(projectId),
          JSON.stringify({
            version: SNAPSHOT_VERSION,
            nodes: useNodeStore.getState().nodes,
            edges: cs.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
            viewport: cs.viewport,
            parentMap: Object.fromEntries(
              cs.nodes.filter((n) => n.parentId).map((n) => [n.id, n.parentId as string]),
            ),
          }),
        );
      }, 500);
    };

    const unsub1 = useCanvasStore.subscribe((state, prevState) => {
      // 快照输入只有 nodes/edges/viewport（parentMap 由 canvasStore.nodes 派生）+ isHydrating 参与
      // 调度协议（S1：hydrate 窗口内清挂起定时器 + wasHydrating 过渡不调度）。wasHydrating 过渡分支
      // 的唯可达路径=纯 isHydrating 翻转（unsub2 的 (h,h) 同值组合不产生它；hydrate 前后 setHydrating
      // 不动 nodes/edges/viewport）——早退不比对 isHydrating 则该分支变死代码、S1 失去纯翻转入口。
      // 引用未变则内容必然不变，早退防 UI 态（marqueeSelecting 等）翻转白排 500ms 全量快照写——顺带
      // 消除 nodeProcessMap/selectedId/pendingMediaFile 抖动的同税。快照的 nodes 内容来自 nodeStore
      // （定时器内现读 :105），由下方 unsub2 独立触发——勿删 unsub2，否则 nodeStore 变更永久不落盘。
      if (state.isHydrating === prevState.isHydrating
        && state.nodes === prevState.nodes && state.edges === prevState.edges
        && state.viewport === prevState.viewport) return;
      scheduleWrite(state.isHydrating, prevState.isHydrating);
    });
    const unsub2 = useNodeStore.subscribe(() => {
      const h = useCanvasStore.getState().isHydrating;
      scheduleWrite(h, h);
    });

    return () => {
      unsub1();
      unsub2();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [projectId]);
}
