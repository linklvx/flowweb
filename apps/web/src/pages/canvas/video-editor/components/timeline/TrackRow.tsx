import { Popconfirm } from 'antd';
import type { ProjectData, Track } from '../../types';
import { totalDuration } from '../../timeline/timecode';
import { timeToPx } from '../../timeline/view-scale';
import { ClipBlock } from './ClipBlock';
import { useEditorStore } from '../../store/editorStore';

const TRACK_ICON: Record<Track['type'], string> = { video: '🎬', subtitle: '字幕', audio: '🎵' };

interface TrackRowProps {
  track: Track;
  data: ProjectData;
  onDropClip?: (e: React.DragEvent<HTMLDivElement>) => void;
  onSubtitleAdd?: (trackId: string) => void;
}

export function TrackRow({ track, data, onDropClip, onSubtitleAdd }: TrackRowProps) {
  const pxPerSec = useEditorStore(s => s.pxPerSec);
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const mediaInfo = useEditorStore(s => s.mediaInfo);
  const toggleTrack = useEditorStore(s => s.toggleTrack);
  const removeTrack = useEditorStore(s => s.removeTrack);
  const selectClip = useEditorStore(s => s.selectClip);

  return (
    <div data-testid={`track-row-${track.id}`} className="flex border-b border-[#F2F3F5] [border-bottom-style:solid]">
      {/* 轨道头 */}
      <div className="w-[140px] shrink-0 flex items-center gap-1 px-2 py-1.5 border-r border-[#E5E7EB] [border-right-style:solid] bg-[#FAFBFC] box-border">
        <span className="text-[12px] text-[#4E5969] truncate" style={{ minWidth: 0 }}>{TRACK_ICON[track.type]} {track.name}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {track.type === 'subtitle' && (
            <button type="button" title="该轨内新增字幕" onClick={() => onSubtitleAdd?.(track.id)}
              className="text-[12px] text-[#6C5CE7] bg-transparent border-0 cursor-pointer px-1">➕</button>
          )}
          <button type="button" title={track.muted ? '取消静音' : '静音'} onClick={() => toggleTrack(track.id, 'muted')}
            className={`text-[11px] bg-transparent border-0 cursor-pointer px-0.5 ${track.muted ? 'text-[#F53F3F]' : 'text-[#86909C]'}`}>M</button>
          <button type="button" title={track.hidden ? '取消隐藏' : '隐藏'} onClick={() => toggleTrack(track.id, 'hidden')}
            className={`text-[11px] bg-transparent border-0 cursor-pointer px-0.5 ${track.hidden ? 'text-[#F53F3F]' : 'text-[#86909C]'}`}>H</button>
          <Popconfirm title="删除轨道将连同片段一起删除" okText="删 除" cancelText="取 消"
            onConfirm={() => removeTrack(track.id)}>
            <button type="button" title="删除轨道"
              className="text-[11px] text-[#86909C] bg-transparent border-0 cursor-pointer px-0.5">✕</button>
          </Popconfirm>
        </div>
      </div>
      {/* 轨道体（minWidth 对齐标尺宽度——absolute 片段不撑容器，无 minWidth 时超宽片段被滚动区裁掉） */}
      <div
        className="relative flex-1 h-[52px] bg-white"
        style={{ minWidth: Math.max(600, timeToPx(totalDuration(data), pxPerSec) + 60) }}
        data-track-id={track.id} data-track-type={track.type}
        onDragOver={e => { if (onDropClip) { e.preventDefault(); } }}
        onDrop={onDropClip}
        onClick={() => selectClip(null)}
      >
        {track.clips.map(cid => {
          const c = data.clips[cid];
          if (!c) return null;
          return (
            <ClipBlock key={cid} clip={c} pxPerSec={pxPerSec} selected={selectedClipId === c.id}
              mediaName={c.type === 'subtitle' ? undefined : mediaInfo[c.mediaId]?.name} />
          );
        })}
      </div>
    </div>
  );
}
