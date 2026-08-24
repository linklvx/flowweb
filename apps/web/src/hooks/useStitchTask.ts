// useStitchTask.ts — Socket 优先 + 5s 轮询兜底；产物节点生成（zundo 自动记录）
import { useCallback, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { createStitchTask, getStitchTask, type StitchParams } from '@/api/stitchApi';
import { useCanvasStore } from '@/stores/canvasStore';

export function useStitchTask(projectId: string) {
  const running = useRef(false);
  const socket = useSocket(projectId); // Hooks 规则：顶层调用一次，start 闭包引用

  const spawnResultNode = useCallback(
    (
      r: { fileId: string; url?: string; width?: number; height?: number },
      sourceGroupId?: string
    ) => {
      const add = useCanvasStore.getState().addNode;
      const nodes = useCanvasStore.getState().nodes;
      const group = sourceGroupId
        ? nodes.find((n) => n.id === sourceGroupId)
        : undefined;
      const gx = group ? group.position.x + (group.width ?? 0) + 40 : 100;
      const gy = group?.position.y ?? 100;
      const nodeId = add(
        'image',
        { x: gx, y: gy },
        {
          fileId: r.fileId,
          status: 'done',
          customSize:
            r.width && r.height
              ? { width: r.width, height: r.height }
              : undefined,
          // 不写 mediaUrl：后端无直链端点，ImageGenNode 按 fileId 自行解析
        }
      );
    },
    []
  );

  const start = useCallback(
    async (
      params: StitchParams
    ): Promise<{ outcome: 'COMPLETED' | 'FAILED' | 'TIMEOUT'; failedCount?: number }> => {
      if (running.current) return { outcome: 'FAILED' }; // 防重（spec 7.3）
      running.current = true;
      let outcome: 'COMPLETED' | 'FAILED' | 'TIMEOUT' = 'TIMEOUT';
      let failedCount: number | undefined;
      try {
        const { taskId } = await createStitchTask(projectId, params);
        await new Promise<void>((resolve) => {
          let done = false;
          // 统一结算：done 保护 + 清理两个定时器 + spawn —— Socket 与轮询双完成路径
          // 只会结算一次，产物节点不会重复生成（socket 完成后未清 timer 的双 spawn 缺陷修复）
          const settle = (
            r: typeof outcome,
            result?: { fileId: string; url?: string; width?: number; height?: number; failedCount?: number }
          ) => {
            if (done) return;
            done = true;
            clearInterval(timer);
            clearTimeout(timeoutId);
            if (r === 'COMPLETED' && result) {
              failedCount = result.failedCount;
              spawnResultNode(result, params.sourceGroupId);
            }
            outcome = r;
            resolve();
          };
          // Socket 快路径：useSocket 返回 MutableRefObject<Socket|null>，必须经 .current 取实例
          socket.current?.once('storyboard:stitch:completed', (evt: any) => {
            if (evt.taskId !== taskId) return;
            if (evt.status === 'COMPLETED' && evt.fileId) {
              settle('COMPLETED', { fileId: evt.fileId, url: evt.url, width: evt.width, height: evt.height, failedCount: evt.failedCount });
            } else {
              settle('FAILED');
            }
          });
          // 5s 轮询兜底（Socket 断线/事件未达）
          const timer = setInterval(async () => {
            try {
              const r = await getStitchTask(projectId, taskId);
              if (r.status === 'COMPLETED' && r.fileId) {
                settle('COMPLETED', { fileId: r.fileId, url: r.url, width: r.width, height: r.height, failedCount: r.failedCount });
              }
              if (r.status === 'FAILED') {
                settle('FAILED');
              }
            } catch {
              /* 单次轮询失败（网络抖动）→ 等待下一轮 */
            }
          }, 5000);
          const timeoutId = setTimeout(
            () => {
              settle('TIMEOUT');
            },
            65_000
          ); // >60s 超时（spec 7.3）
        });
      } finally {
        running.current = false;
      }
      return { outcome, failedCount };
    },
    [projectId, spawnResultNode, socket]
  );

  return { start };
}
