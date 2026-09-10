// apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx
import { memo, useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Tooltip } from 'antd';
import { NodeHandle } from './NodeHandle';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { detectVideoEditorCapabilities } from '@/pages/canvas/video-editor/capabilities';
import { formatShortTime, totalDuration } from '@/pages/canvas/video-editor/timeline/timecode';
import { getProjectByNode } from '@/api/videoProjectApi';
import type { ProjectData } from '@/pages/canvas/video-editor/types';

const TRACK_COLORS: Record<string, string> = { video: '#6C5CE7', image: '#6C5CE7', audio: '#95DE64', subtitle: '#FFD666' };

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="#6C5CE7" strokeWidth="1.2" />
    </svg>
  );
}

function VideoEditNodeComponent({ id, selected }: NodeProps) {
  const openEditor = useVideoEditorStore((s) => s.openEditor);
  const closedAt = useVideoEditorStore((s) => s.closedAt);
  const closedSource = useVideoEditorStore((s) => s.sourceNodeId);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [{ canPreview }] = useState(detectVideoEditorCapabilities);

  useEffect(() => {
    let cancelled = false;
    getProjectByNode(id)
      .then((p) => { if (!cancelled) setProjectData(p?.data ?? null); })
      .catch(() => { if (!cancelled) setProjectData(null); });
    return () => { cancelled = true; };
    // closedAt 递增且匹配本节点 → 编辑器关闭后刷新缩略
  }, [id, closedAt, closedSource]);

  const dur = projectData ? totalDuration(projectData) : 0;
  const ratio = dur > 0 ? 288 / dur : 0; // 缩略区有效宽 288（316 - padding）

  return (
    <div className="relative canvas-node" data-testid={`video-edit-node-${id}`}>
      <div
        className="bg-white rounded-lg overflow-hidden box-border"
        style={{
          width: 316,
          border: '1px solid #E5E7EB',
          margin: 2,
          ...(selected ? { border: '1px solid transparent', boxShadow: '0 0 0 3px #9CA3AF' } : {}),
        }}
      >
        <NodeHandle type="target" testId="video-edit-target" />
        {/* 标题栏 */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#F0F0F0] [border-bottom-style:solid]">
          <GridIcon />
          <span className="text-[14px] font-medium text-[#1F2329]">多轨道剪辑</span>
        </div>
        {/* 工具栏：播放占位（Plan 3）+ 简略时间码 + 全屏编辑 */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <button type="button" disabled title="播放（预览能力 Plan 3 开放）"
            className="text-[12px] text-[#86909C] bg-transparent border-0 cursor-not-allowed px-1">▶</button>
          <span className="text-[12px] text-[#86909C]">{formatShortTime(0)} / {formatShortTime(dur)}</span>
          <Tooltip title={canPreview ? '' : '当前浏览器不支持 WebCodecs，请使用最新版 Chrome/Edge'}>
            <button
              type="button"
              className="ml-auto text-[12px] text-[#6C5CE7] bg-transparent border-0 px-1 py-0.5 cursor-pointer disabled:text-[#C9CDD4] disabled:cursor-not-allowed"
              disabled={!canPreview}
              onClick={() => openEditor(id)}
            >
              ⤢ 全屏编辑
            </button>
          </Tooltip>
        </div>
        {/* 轨道区只读缩略：片段色块（thumbnail 拼贴 Plan 3 接，色块先行）+ 播放头位置 */}
        <div className="px-3 pb-3 flex flex-col gap-1" data-testid="node-track-thumb">
          {projectData && projectData.tracks.length > 0 ? (
            projectData.tracks.map((t) => (
              <div key={t.id} className="relative h-[6px] rounded-sm bg-[#F2F3F5] overflow-hidden" data-testid={`node-track-${t.id}`}>
                {t.clips.map((cid) => {
                  const c = projectData.clips[cid];
                  if (!c) return null;
                  return (
                    <div key={cid} data-testid={`node-clip-${cid}`}
                      className="absolute top-0 bottom-0 rounded-sm"
                      style={{ left: c.start * ratio, width: Math.max(2, c.duration * ratio), background: TRACK_COLORS[c.type] ?? '#6C5CE7' }} />
                  );
                })}
              </div>
            ))
          ) : (
            <div className="h-[28px] rounded-md border border-dashed border-[#E5E7EB] [border-top-style:dashed] flex items-center justify-center">
              <span className="text-[12px] text-[#86909C]">+ 添加素材</span>
            </div>
          )}
        </div>
        <NodeHandle type="source" testId="video-edit-source" />
      </div>
    </div>
  );
}

export const VideoEditNode = memo(VideoEditNodeComponent);
