// useStitchTask.ts — REST 轮询单通道（先请求一次+5s 后续）；产物节点生成（doc 同步自动入 undo 栈）
import { useCallback, useRef } from 'react';
import { createStitchTask, getStitchTask, type StitchParams } from '@/api/stitchApi';
import { useCanvasStore } from '@/stores/canvasStore';

export function useStitchTask(projectId: string) {
  const running = useRef(false);

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
      // O0b-2 (i) 命令体显式值（终裁 59①[i]+59⑤——删 customSize 后初始尺寸的显式形参）：
      // 拼接尺寸已知⇒envelope wh 随 addNode intent 单 transact 落 doc（非内容事件——产物节点
      // 的尺寸来源=命令载荷）
      const nodeId = add(
        'image',
        { x: gx, y: gy },
        {
          fileId: r.fileId,
          status: 'done',
          // 不写 mediaUrl：后端无直链端点，ImageGenNode 按 fileId 自行解析
        },
        r.width && r.height ? { width: r.width, height: r.height } : undefined,
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
          // 统一结算：done 保护 + 清理两个定时器 + spawn —— 单一完成路径只结算一次
          //（超时结算后迟到 COMPLETED 走同一把 done 锁——不得再 spawnResultNode）
          const settle = (
            r: typeof outcome,
            result?: { fileId: string; url?: string; width?: number; height?: number; failedCount?: number }
          ) => {
            if (done) return;
            done = true;
            if (timer !== null) clearInterval(timer);
            clearTimeout(timeoutId);
            if (r === 'COMPLETED' && result) {
              failedCount = result.failedCount;
              spawnResultNode(result, params.sourceGroupId);
            }
            outcome = r;
            resolve();
          };
          const checkStatus = (r: {
            status: string;
            fileId?: string;
            url?: string;
            width?: number;
            height?: number;
            failedCount?: number;
          }) => {
            if (done) return; // done 锁外早退：超时结算后迟到响应不再触发 settle
            if (r.status === 'COMPLETED' && r.fileId) {
              settle('COMPLETED', { fileId: r.fileId, url: r.url, width: r.width, height: r.height, failedCount: r.failedCount });
            } else if (r.status === 'FAILED') {
              settle('FAILED');
            }
          };
          const poll = async (): Promise<boolean> => {
            try {
              checkStatus(await getStitchTask(projectId, taskId));
            } catch {
              /* 单次轮询失败（网络抖动）→ 等待下一轮 */
            }
            return !done;
          };
          // 先请求一次（start() 起算）；未终态再 5s interval
          let timer: ReturnType<typeof setInterval> | null = null;
          void poll().then((keepGoing) => {
            if (keepGoing) {
              timer = setInterval(() => { void poll(); }, 5000);
            }
          });
          // 65s 超时仍从 start() 起算（spec 7.3——首枪已即时发出，超时线不动）
          const timeoutId = setTimeout(
            () => {
              settle('TIMEOUT');
            },
            65_000
          );
        });
      } finally {
        running.current = false;
      }
      return { outcome, failedCount };
    },
    [projectId, spawnResultNode]
  );

  return { start };
}
