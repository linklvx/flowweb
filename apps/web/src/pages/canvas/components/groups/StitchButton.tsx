import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { message } from 'antd';
import type { StitchResolution } from '@/types/group';
import { useCanvasStore } from '@/stores/canvasStore';
import { useStitchTask } from '@/hooks/useStitchTask';

interface Props {
  groupId: string;
  resolution: StitchResolution;
  onResolutionChange: (value: StitchResolution) => void;
  running?: boolean;
}

const RESOLUTIONS: { label: string; value: StitchResolution }[] = [
  { label: '2K', value: '2K' },
  { label: '4K', value: '4K' },
];

const btn = (disabled?: boolean): React.CSSProperties => ({
  background: 'none',
  border: 'none',
  color: disabled ? '#666' : '#fff',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

function StitchButtonComponent({
  groupId,
  resolution,
  onResolutionChange,
  running: externalRunning,
}: Props) {
  const [open, setOpen] = useState(false);
  const [internalRunning, setInternalRunning] = useState(false);
  const projectId = useCanvasStore((s) => s.projectId);
  const { start } = useStitchTask(projectId ?? '');
  const paramsRef = useRef<Parameters<typeof start>[0] | null>(null);

  const running = externalRunning ?? internalRunning;

  // 首用提示
  useEffect(() => {
    const shown = localStorage.getItem('stitch-upscale-tip-shown');
    if (!shown) {
      message.info('图片分辨率不足时将被强制放大，可能影响清晰度');
      localStorage.setItem('stitch-upscale-tip-shown', '1');
    }
  }, []);

  const handleResolutionChange = useCallback(
    (value: StitchResolution) => {
      onResolutionChange(value);
      setOpen(false);
    },
    [onResolutionChange]
  );

  const handleStitch = useCallback(async () => {
    if (!projectId) {
      message.error('项目未加载');
      return;
    }

    const nodes = useCanvasStore.getState().nodes;
    const groupNode = nodes.find((n) => n.id === groupId);
    if (!groupNode?.data.cells) {
      message.error('分镜组数据缺失');
      return;
    }

    // 收集 cells 对应节点的 fileId（跳过 null/无 fileId 的空位）
    const fileIds = (groupNode.data.cells as (string | null)[])
      .map((cellId) => {
        if (!cellId) return null;
        const node = nodes.find((n) => n.id === cellId);
        return (node?.data as any)?.fileId ?? null;
      })
      .filter((f): f is string => f !== null);

    if (fileIds.length === 0) {
      message.error('没有可拼接的图片（宫格为空或图片未生成）');
      return;
    }

    const storyboard = groupNode.data.storyboard as
      | { gridRows: number; gridCols: number; aspectRatio: string; showIndex: boolean }
      | undefined;
    if (!storyboard) {
      message.error('分镜配置缺失');
      return;
    }

    const params = {
      fileIds,
      gridRows: storyboard.gridRows,
      gridCols: storyboard.gridCols,
      aspectRatio: storyboard.aspectRatio as any,
      showIndex: storyboard.showIndex,
      resolution,
      sourceGroupId: groupId,
    };

    // 快照参数：触发时刻固定，后续宫格调整不影响进行中任务
    paramsRef.current = params;

    setInternalRunning(true);
    try {
      const outcome = await start(params);
      if (outcome === 'COMPLETED') {
        message.success('拼接完成');
      } else if (outcome === 'FAILED') {
        message.error({
          content: '拼接失败',
          duration: 5,
          onClick: () => {
            if (paramsRef.current) {
              handleStitch();
            }
          },
        });
      } else {
        message.error({
          content: '拼接超时（65s），请重试',
          duration: 5,
          onClick: () => {
            if (paramsRef.current) {
              handleStitch();
            }
          },
        });
      }
    } catch (err: any) {
      message.error(`拼接出错：${err.message ?? '未知错误'}`);
    } finally {
      setInternalRunning(false);
    }
  }, [projectId, groupId, resolution, start]);

  return (
    <div
      className="relative"
      style={{ display: 'flex', gap: 2 }}
    >
      <button
        disabled={running}
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn(running), padding: '6px 8px', minWidth: 50 }}
      >
        {resolution} ▾
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-30"
          style={{
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: 6,
            minWidth: 80,
          }}
        >
          {RESOLUTIONS.map((res) => (
            <button
              key={res.value}
              disabled={running}
              onClick={() => handleResolutionChange(res.value)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                background: 'none',
                border: 'none',
                color: running ? '#666' : '#fff',
                cursor: running ? 'not-allowed' : 'pointer',
              }}
            >
              {res.label}
            </button>
          ))}
        </div>
      )}
      <button disabled={running} onClick={handleStitch} style={btn(running)}>
        {running ? '拼接中…' : `拼接(${resolution})`}
      </button>
    </div>
  );
}

export const StitchButton = memo(StitchButtonComponent);
