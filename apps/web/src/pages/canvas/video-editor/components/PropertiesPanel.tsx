import { InputNumber, Slider, Switch, Select, Segmented } from 'antd';
import { useEditorStore } from '../store/editorStore';
import type { AudioClip, SubtitleClip, VideoClip, ImageClip, Transform } from '../types';

const TRANSITION_TYPES = [
  { value: 'fadeIn', label: '淡入' }, { value: 'fadeOut', label: '淡出' },
  { value: 'crossfade', label: '交叉淡化' }, { value: 'toBlack', label: '渐黑' }, { value: 'toWhite', label: '渐白' },
];

function StopwatchButton({ clip, property, label }: { clip: VideoClip | ImageClip; property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'; label: string }) {
  // A5/决策 20：订阅派生布尔而非 playhead（zustand Object.is 比较——播放 30fps 时布尔不变即不重渲整个 PropertiesPanel）
  const active = useEditorStore(s =>
    clip.keyframes.some(k => k.property === property && Math.abs(k.t - (s.playhead - clip.start)) < 0.5 / 30));
  return (
    <button type="button" data-testid={`stopwatch-${property}`} title={`${active ? '删除' : '添加'} ${label} 关键帧`}
      onClick={() => {
        const es = useEditorStore.getState();
        const tl = es.playhead - clip.start; // 点击时取最新播放头（订阅不持有它）
        const hit = clip.keyframes.find(k => k.property === property && Math.abs(k.t - tl) < 0.5 / 30);
        if (hit) es.removeKeyframe(clip.id, hit.id);
        else es.addKeyframe(clip.id, property);
      }}
      className={`text-[12px] bg-transparent border-0 px-1 ${active ? 'text-[var(--ve-accent-text)]' : 'text-[var(--ve-text-dim)]'}`}>⏱</button>
  );
}

/** 五属性全部配秒表（spec 第四节：每属性行旁秒表按钮）；keyof Transform 恰为五属性联合，无需 cast */
const TRANSFORM_ROWS: { property: keyof Transform; label: string; step?: number; min?: number; max?: number }[] = [
  { property: 'x', label: 'x' },
  { property: 'y', label: 'y' },
  { property: 'scale', label: '缩放', step: 0.1 },
  { property: 'rotation', label: '旋转' },
  { property: 'opacity', label: '不透明', step: 0.1, min: 0, max: 1 },
];

function TransformRow({ clip, row }: { clip: VideoClip | ImageClip; row: (typeof TRANSFORM_ROWS)[number] }) {
  const { property, label } = row;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">{label}</span>
      <InputNumber aria-label={label} size="small" step={row.step} min={row.min} max={row.max} value={clip.transform[property]}
        onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { transform: { ...clip.transform, [property]: v } }); }}
        className="flex-1" />
      <StopwatchButton clip={clip} property={property} label={label} />
    </div>
  );
}

function TransitionEditor({ clip, edge }: { clip: VideoClip | ImageClip; edge: 'transitionIn' | 'transitionOut' }) {
  const t = clip[edge];
  const patch = (type: string | undefined) =>
    useEditorStore.getState().updateClip(clip.id, type ? { [edge]: { type, duration: t?.duration ?? 0.5 } } : { [edge]: undefined });
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">{edge === 'transitionIn' ? '入场转场' : '出场转场'}</span>
      <Select size="small" allowClear placeholder="无" value={t?.type} options={TRANSITION_TYPES} onChange={v => patch(v)}
        className="flex-1" />
      {t && (
        <InputNumber size="small" min={0.2} max={2} step={0.1} value={t.duration}
          onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { [edge]: { ...t, duration: v } }); }}
          className="w-16" addonAfter="s" />
      )}
    </div>
  );
}

export function PropertiesPanel() {
  const selectedClipId = useEditorStore(s => s.selectedClipId);
  const data = useEditorStore(s => s.data);
  const clip = selectedClipId ? data?.clips[selectedClipId] : undefined;
  if (!clip) {
    return (
      <div data-testid="properties-panel" data-testid-empty="1"
        className="h-full border-l border-[var(--ve-border)] bg-[var(--fw-surface-dim)] p-3">
        <div data-testid="properties-empty" className="text-[12px] text-[var(--ve-text-dim)] text-center py-8">未选中片段</div>
      </div>
    );
  }
  return (
    <div data-testid="properties-panel"
      className="h-full border-l border-[var(--ve-border)] bg-[var(--fw-surface-dim)] p-3 overflow-y-auto">
      {clip.type === 'video' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[var(--fw-text)] py-1.5">视频片段</div>
          {TRANSFORM_ROWS.map(row => <TransformRow key={row.property} clip={clip} row={row} />)}
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">播放速度</span>
            <Segmented aria-label="播放速度" size="small" value={String(clip.playbackSpeed)}
              options={[{ label: '0.5×', value: '0.5' }, { label: '1×', value: '1' }, { label: '2×', value: '2' }]}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { playbackSpeed: Number(v) as 0.5 | 1 | 2 })} />
          </div>
          <TransitionEditor clip={clip} edge="transitionIn" />
          <TransitionEditor clip={clip} edge="transitionOut" />
        </div>
      )}
      {clip.type === 'image' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[var(--fw-text)] py-1.5">图片片段</div>
          {TRANSFORM_ROWS.map(row => <TransformRow key={row.property} clip={clip} row={row} />)}
          <TransitionEditor clip={clip} edge="transitionIn" />
          <TransitionEditor clip={clip} edge="transitionOut" />
        </div>
      )}
      {clip.type === 'audio' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[var(--fw-text)] py-1.5">音频片段</div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">音量</span>
            <InputNumber aria-label="音量" size="small" min={0} max={2} step={0.1} value={clip.volume}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { volume: v }); }}
              className="flex-1" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">淡入</span>
            <InputNumber aria-label="淡入" size="small" min={0} max={5} step={0.1} value={clip.fade.in}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { fade: { ...clip.fade, in: v } }); }}
              className="flex-1" addonAfter="s" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">淡出</span>
            <InputNumber aria-label="淡出" size="small" min={0} max={5} step={0.1} value={clip.fade.out}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { fade: { ...clip.fade, out: v } }); }}
              className="flex-1" addonAfter="s" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">播放速度</span>
            <Segmented aria-label="播放速度" size="small" value={String(clip.playbackSpeed)}
              options={[{ label: '0.5×', value: '0.5' }, { label: '1×', value: '1' }, { label: '2×', value: '2' }]}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { playbackSpeed: Number(v) as 0.5 | 1 | 2 })} />
          </div>
        </div>
      )}
      {clip.type === 'subtitle' && (
        <div className="flex flex-col">
          <div className="text-[13px] font-medium text-[var(--fw-text)] py-1.5">字幕</div>
          <textarea aria-label="字幕文本" value={clip.text} rows={3}
            onChange={e => useEditorStore.getState().updateClip(clip.id, { text: e.target.value })}
            className="w-full text-[12px] bg-[var(--fw-surface-dim)] text-[var(--fw-text)] border border-[var(--ve-border)] rounded-md p-1.5" />
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">显示字幕</span>
            <Switch aria-label="显示字幕" size="small" checked={clip.visible}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { visible: v })} />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">字号</span>
            <Slider aria-label="字号" className="flex-1" min={12} max={120} value={clip.style.fontSize}
              onChange={v => useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, fontSize: v as number } })} />
            <InputNumber size="small" min={12} max={120} value={clip.style.fontSize}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, fontSize: v } }); }}
              className="w-16" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">字体颜色</span>
            <input type="color" aria-label="字体颜色" value={clip.style.color}
              onChange={e => useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, color: e.target.value } })}
              className="w-8 h-6 border border-[var(--ve-border)] rounded cursor-pointer" />
          </div>
          <div className="flex items-center gap-2 py-1">
            <span className="text-[12px] text-[var(--fw-text)] w-14 shrink-0">字间距</span>
            <InputNumber aria-label="字间距" size="small" min={0} max={20} step={0.5} value={clip.style.letterSpacing}
              onChange={v => { if (v !== null) useEditorStore.getState().updateClip(clip.id, { style: { ...clip.style, letterSpacing: v } }); }}
              className="flex-1" />
          </div>
        </div>
      )}
    </div>
  );
}
