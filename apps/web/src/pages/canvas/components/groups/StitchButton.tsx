import { memo, useState, useCallback, useRef } from 'react';
import { message } from 'antd';
import type { StitchResolution } from '@/types/group';
import { useCanvasStore, computeStoryboardCellsPatch } from '@/stores/canvasStore';
import { useNodeStore } from '@/stores/nodeStore';
import { useStitchTask } from '@/hooks/useStitchTask';
import { hasStoryboardConfig, resolveStoryboardConfig } from '@/utils/storyboardConfig';
import { resolvePrimaryMediaId } from '@flowweb/shared';   // Y2 B3：拼接主槽判定单源

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
  color: disabled ? 'var(--canvas-controls-icon)' : 'var(--canvas-controls-text)',
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

  const handleResolutionChange = useCallback(
    (value: StitchResolution) => {
      onResolutionChange(value);
      setOpen(false);
    },
    [onResolutionChange]
  );

  const handleStitch = useCallback(async () => {
    // 首用提示（spec 7.3「首次使用」= 首次点击拼接时，非组件首见）
    const shown = localStorage.getItem('flowweb.stitch-upscale-tip');
    if (!shown) {
      message.info('图片分辨率不足时将被强制放大，可能影响清晰度');
      localStorage.setItem('flowweb.stitch-upscale-tip', '1');
    }

    if (!projectId) {
      message.error('项目未加载');
      return;
    }

    const nodes = useCanvasStore.getState().nodes;
    const groupNode = nodes.find((n) => n.id === groupId);
    if (!groupNode) {
      message.error('分镜组数据缺失');
      return;
    }

    // Y2 A5：cells 缓存退役——槽序读侧现算（computeStoryboardCellsPatch：slot 真源）。
    // Y2 B3：拼接收集改 resolvePrimaryMediaId 单源（fileId||referenceImage 退役；上传图作者键=mediaId）
    const cells = computeStoryboardCellsPatch(nodes, useNodeStore.getState().nodes, groupId)[0]?.cells ?? [];
    const fileIds = cells
      .map((cellId) => {
        if (!cellId) return null;
        const node = nodes.find((n) => n.id === cellId);
        const d = (node?.data as any) ?? {};
        const resolved = resolvePrimaryMediaId({ type: node?.type ?? '', data: d }, undefined);
        return resolved !== '' ? resolved : null;
      })
      .filter((f): f is string => f !== null);

    if (fileIds.length === 0) {
      message.error('没有可拼接的图片（宫格为空或图片未生成）');
      return;
    }

    if (!hasStoryboardConfig(groupNode.data)) {
      message.error('分镜配置缺失');
      return;
    }

    const cfg = resolveStoryboardConfig(groupNode.data);
    const params = {
      fileIds,
      gridRows: cfg.gridRows,
      gridCols: cfg.gridCols,
      aspectRatio: cfg.aspectRatio,
      showIndex: cfg.showIndex,
      resolution,
      sourceGroupId: groupId,
    };

    // params 即触发时刻快照（闭包固化，宫格调整不影响进行中任务）；
    // paramsRef 供重试入口判断，重试本身按最新宫格重新收集（新任务语义）
    paramsRef.current = params;

    setInternalRunning(true);
    try {
      const { outcome, failedCount } = await start(params);
      if (outcome === 'COMPLETED') {
        message.success(
          failedCount && failedCount > 0
            ? `拼接完成，${failedCount} 张图片加载失败，已用占位图替代`
            : '拼接完成'
        );
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
            background: 'var(--canvas-controls-bg)',
            border: '1px solid var(--canvas-controls-border)',
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
                color: running ? 'var(--canvas-controls-icon)' : 'var(--canvas-controls-text)',
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
