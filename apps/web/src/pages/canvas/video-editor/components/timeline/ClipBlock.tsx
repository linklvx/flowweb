import { memo, useRef, useEffect } from 'react';
import type { Clip, VideoClip } from '../../types';
import { formatTimecode } from '../../timeline/timecode';
import { timeToPx } from '../../timeline/view-scale';
import { useAudioPeaks } from '../../hooks/useAudioPeaks';
import { useEditorStore } from '../../store/editorStore';

// opencut 轨道色表（批3-4）：video/image 兜底暗底走 --ve-track-video，音频紫、字幕青；BAR 同步暗化
const BLOCK_BG: Record<Clip['type'], string> = { video: 'var(--ve-track-video)', image: 'var(--ve-track-video)', audio: '#8F5DBA', subtitle: '#5DBAA0' };
const BLOCK_BAR: Record<Clip['type'], string> = { video: '#6C5CE7', image: '#5B7CFA', audio: '#8F5DBA', subtitle: '#5DBAA0' };

export const CLIP_BLOCK_MIN_PX = 8;

// 文件顶层新增（与 ClipBlock 同级，模块作用域）——R7：若声明在 ClipBlock 函数体内则成嵌套组件定义，
// ClipBlock 每次重渲（选中/pxPerSec/拖拽 transient）都产生新组件类型 → canvas 子树卸载重建、effect 反复跑：
function WaveformCanvas({ mediaId }: { mediaId: string }) {
  const url = useEditorStore(s => s.mediaInfo[mediaId]?.url);
  const peaks = useAudioPeaks(mediaId, url);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...peaks, 1e-6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // 波形白：色表深底（#8F5DBA）上可读，替代旧绿
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const barH = (peaks[i] / max) * (h * 0.8);
      ctx.fillRect(i * bw, (h - barH) / 2, Math.max(1, bw - 0.5), barH);
    }
  }, [peaks]);
  return <canvas ref={ref} width={260} height={30} data-testid={`waveform-${mediaId}`}
    className="absolute inset-x-1 bottom-0.5 w-[calc(100%-8px)] h-[30px] pointer-events-none" />;
}

interface ClipBlockProps {
  clip: Clip;
  pxPerSec: number;
  selected: boolean;
  /** 素材缺失态（sourceNodeId 对应画布节点已删）→ 红底红边 + "素材已删除"角标 */
  missing?: boolean;
  mediaName?: string;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyframePointerDown?: (kfId: string, e: React.PointerEvent<HTMLDivElement>) => void;
}

export const ClipBlock = memo(function ClipBlock({ clip, pxPerSec, selected, missing, mediaName, onPointerDown, onKeyframePointerDown }: ClipBlockProps) {
  const left = timeToPx(clip.start, pxPerSec);
  const width = Math.max(CLIP_BLOCK_MIN_PX, timeToPx(clip.duration, pxPerSec));
  // selector 订阅（非 getState）：poster 异步写回 mediaInfo 后要触发已挂载片段重渲染
  const thumb = useEditorStore((s) => (clip.type === 'video' || clip.type === 'image') ? s.mediaInfo[clip.mediaId]?.thumbnailUrl : undefined);
  const label = clip.type === 'subtitle'
    ? clip.text
    : `${mediaName ?? clip.mediaId} · ${formatTimecode(clip.type === 'video' || clip.type === 'audio' ? clip.sourceStart : 0)}`;
  return (
    <div
      data-testid={`clip-block-${clip.id}`}
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()} // pointerdown 的 stopPropagation 挡不住后续 click 冒泡到轨道体的 selectClip(null)（Task 14 I2）
      className="absolute top-1 bottom-1 rounded-md overflow-hidden box-border cursor-grab select-none"
      style={{
        left, width,
        // 长写并行声明——禁 background 简写与 backgroundImage 混排（简写会清掉 image）
        backgroundColor: missing ? '#7f1d1d' : BLOCK_BG[clip.type],
        ...(thumb ? { backgroundImage: `url(${thumb})`, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%' } : {}),
        // 边框优先级（R6 定案）：missing 红边压过选中边（素材缺失是更高优先级的告警态）
        border: `1px solid ${missing ? '#EF4444' : selected ? BLOCK_BAR[clip.type] : 'transparent'}`,
        boxShadow: selected ? `0 0 0 2px ${BLOCK_BAR[clip.type]}40` : undefined,
      }}
    >
      <div className="h-full flex items-center px-1.5" style={{ borderLeft: `3px solid ${BLOCK_BAR[clip.type]}` }}>
        <span className="text-[11px] text-white/85 truncate whitespace-nowrap" style={{ minWidth: 0 }}>
          {label}
        </span>
        {missing && <span className="text-[10px] text-[#EF4444] ml-1 shrink-0">素材已删除</span>}
      </div>
      {/* 波形层：audio 片在 label 容器之后叠加 Canvas 自绘静态波形（peaks 归一化渲染端处理） */}
      {clip.type === 'audio' && <WaveformCanvas mediaId={clip.mediaId} />}
      {/* 关键帧菱形（video/image 变换 + audio 音量同款分支；as VideoClip 单型视图同 store R5 先例，
          audio 的 title 走音量文案挡 VolumeKeyframe 无 property 的运行时 undefined） */}
      {(clip.type === 'video' || clip.type === 'image' || clip.type === 'audio') && (clip as VideoClip).keyframes.map(k => (
        <div key={k.id} data-testid={`kf-${k.id}`}
          title={clip.type === 'audio' ? `音量 @ ${k.t.toFixed(2)}s` : `${k.property} @ ${k.t.toFixed(2)}s`}
          onPointerDown={(e) => onKeyframePointerDown?.(k.id, e)}
          className="absolute w-2 h-2 bg-[var(--ve-panel)] border border-[#6C5CE7] rotate-45 cursor-pointer z-[1]"
          style={{ left: timeToPx(k.t, pxPerSec) - 4, top: '50%', marginTop: -4 }} />
      ))}
    </div>
  );
});
