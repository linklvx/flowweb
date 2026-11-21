import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';

const ready = (d?: ProjectData) => {
  const data = d ?? createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data, sourceNodeId: 'edit1', playhead: 0 });
  return data;
};
const addVideo = () => {
  const d = useEditorStore.getState().data!;
  return useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId: d.tracks[0].id, start: 0 })!;
};

describe('keyframe actions（spec 第四节关键帧 UI 支撑）', () => {
  beforeEach(() => useEditorStore.getState().reset());

  it('addKeyframe：播放头处添加当前插值值关键帧（t 局部坐标）', () => {
    ready();
    const id = addVideo(); // duration 5（mediaInfo 缺省）
    useEditorStore.getState().setPlayhead(2);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale');
    expect(kfId).toBeTruthy();
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes).toHaveLength(1);
    expect(clip.keyframes[0]).toMatchObject({ t: 2, property: 'scale', value: 1 }); // 当前显示值
  });
  it('addKeyframe 幂等：±半帧内已有同属性关键帧返回既有 id', () => {
    ready();
    const id = addVideo();
    useEditorStore.getState().setPlayhead(2);
    const a = useEditorStore.getState().addKeyframe(id, 'scale')!;
    const b = useEditorStore.getState().addKeyframe(id, 'scale')!;
    expect(a).toBe(b);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes).toHaveLength(1);
  });
  it('addKeyframe 取当前插值值而非基准（单点通道恒值覆盖基准——变异守护：恒基准变异体必红）', () => {
    ready();
    const id = addVideo();
    useEditorStore.getState().setPlayhead(1);
    useEditorStore.getState().addKeyframe(id, 'scale')!; // t=1 记录 v=1（单点通道）
    useEditorStore.getState().updateClip(id, { transform: { ...(useEditorStore.getState().data!.clips[id] as any).transform, scale: 2 } }); // 基准改 2
    useEditorStore.getState().setPlayhead(2);
    useEditorStore.getState().addKeyframe(id, 'scale')!; // 正确实现：单点通道恒值 1（基准被覆盖）；变异体：基准 2
    const clip = useEditorStore.getState().data!.clips[id] as any;
    expect(clip.keyframes).toHaveLength(2);
    expect(clip.keyframes[1]).toMatchObject({ t: 2, value: 1 });
  });
  it('addKeyframe 音频片 volume 通道（VolumeKeyframe 无 property 字段）', () => {
    ready();
    const trackId = useEditorStore.getState().addTrack('audio'); // 单轨默认值下显式建音频轨（与生产动态建轨对齐）
    const auId = useEditorStore.getState().addClip({ type: 'audio', mediaId: 'ma', trackId, start: 0 })!;
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(auId, 'volume');
    const clip = useEditorStore.getState().data!.clips[auId] as any;
    expect(clip.keyframes[0]).toMatchObject({ t: 1, value: 1 });
    expect('property' in clip.keyframes[0]).toBe(false);
  });
  it('addKeyframe 类型不匹配（音频片加 transform 属性/视频片加 volume）→ null', () => {
    ready();
    const id = addVideo();
    const trackId = useEditorStore.getState().addTrack('audio'); // 单轨默认值下显式建音频轨（与生产动态建轨对齐）
    const auId = useEditorStore.getState().addClip({ type: 'audio', mediaId: 'ma', trackId, start: 0 })!;
    expect(useEditorStore.getState().addKeyframe(auId, 'scale')).toBeNull();
    expect(useEditorStore.getState().addKeyframe(id, 'volume')).toBeNull();
  });
  it('removeKeyframe / moveKeyframe（clamp [0,duration] + 量化 + transient）', () => {
    ready();
    const id = addVideo(); // duration 5
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale')!;
    expect(useEditorStore.getState().moveKeyframe(id, kfId, 99, { transient: true })).toBe(true);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes[0].t).toBe(5); // clamp duration
    useEditorStore.getState().removeKeyframe(id, kfId);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes).toHaveLength(0);
  });
  it('moveKeyframe transient=本地覆盖层（零 doc 笔），removeKeyframe 直删本地', () => {
    ready();
    const id = addVideo();
    useEditorStore.getState().setPlayhead(1);
    const kfId = useEditorStore.getState().addKeyframe(id, 'scale')!;
    // Y4a T7（spec §4）：JSON 快照史退场——栈行为由 editorStore.timeline.spec 锁 doc 管线；
    // 本档只锁本地数据面：transient 跟手改 t、removeKeyframe 直删。
    useEditorStore.getState().moveKeyframe(id, kfId, 2, { transient: true });
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes[0].t).toBe(2);
    useEditorStore.getState().removeKeyframe(id, kfId);
    expect((useEditorStore.getState().data!.clips[id] as any).keyframes).toHaveLength(0);
  });
  it('字幕片 addKeyframe → null（无关键帧语义）', () => {
    ready();
    const subTrackId = useEditorStore.getState().addTrack('subtitle'); // 单轨默认值下显式建字幕轨（与生产动态建轨对齐）
    const subId = useEditorStore.getState().addSubtitleClip(subTrackId, 0);
    expect(useEditorStore.getState().addKeyframe(subId, 'scale')).toBeNull();
  });
});
