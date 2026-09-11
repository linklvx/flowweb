import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/canvasUndo', () => ({ stopCapturing: vi.fn() }));
vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }));

import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData, type VideoClip } from '../types';
import { stopCapturing } from '@/stores/canvasUndo';
import { ensureAutoEdges } from '../timeline/auto-edges';

const proj = (data?: ProjectData) => ({
  id: 'p1', sourceNodeId: 'edit1', updatedAt: '2026-09-10T00:00:00Z',
  data: data ?? createDefaultProjectData(),
});

describe('editorStore（normalized + transient 历史）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  it('loadProject → ready，data/baseUpdatedAt 就位', () => {
    useEditorStore.getState().loadProject(proj());
    const s = useEditorStore.getState();
    expect(s.status).toBe('ready');
    expect(s.projectId).toBe('p1');
    expect(s.baseUpdatedAt).toBe('2026-09-10T00:00:00Z');
  });

  it('addClip 视频片：duration 取 mediaInfo，track.clips 按 start 有序，push 前态历史', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: '素材A', durationSec: 8 });
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId, start: 2 });
    expect(id).toBeTruthy();
    const d = useEditorStore.getState().data!;
    expect(d.clips[id!].duration).toBe(8);
    expect(d.tracks[0].clips).toEqual([id]);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(ensureAutoEdges).toHaveBeenCalled();
  });

  it('addClip 同轨冲突自动吸附最近空位', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 }); // 占 0-3
    useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId, start: 1 }); // 冲突 → 吸附 3
    const d = useEditorStore.getState().data!;
    const second = d.tracks[0].clips.map(id => d.clips[id]).sort((a, b) => a.start - b.start)[1];
    expect(second.start).toBe(3);
  });

  it('addClip 图片默认 5s；素材时长未知兜底 5s 且不阻塞', () => {
    useEditorStore.getState().loadProject(proj());
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'img1', trackId, start: 0 });
    expect(useEditorStore.getState().data!.clips[id!].duration).toBe(5);
  });

  it('addSubtitleClip：3s + 默认文本', () => {
    useEditorStore.getState().loadProject(proj());
    const subTrackId = useEditorStore.getState().addTrack('subtitle'); // 单轨默认值下显式建字幕轨（与生产动态建轨对齐）
    const id = useEditorStore.getState().addSubtitleClip(subTrackId, 1);
    const c = useEditorStore.getState().data!.clips[id] as any;
    expect(c.type).toBe('subtitle');
    expect(c.duration).toBe(3);
    expect(c.text).toBe('新字幕');
  });

  it('transient 拖动：begin → move×N 不入栈 → end 一次入栈', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const historyDepthAfterAdd = useEditorStore.getState().history.past.length; // 1

    useEditorStore.getState().beginTransient();
    for (let i = 1; i <= 3; i++) {
      useEditorStore.getState().moveClip(id, i, undefined, { transient: true });
    }
    expect(useEditorStore.getState().history.past.length).toBe(historyDepthAfterAdd); // rAF 不入栈
    const changed = useEditorStore.getState().endTransient();
    expect(changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(historyDepthAfterAdd + 1); // pointerup 一次
    expect(stopCapturing).toHaveBeenCalled(); // 断画布 500ms 合并窗
    expect(useEditorStore.getState().data!.clips[id].start).toBe(3);
  });

  it('undo/redo：数据还原 + clip 集合回滚触发 ensureAutoEdges', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId, start: 0 })!;
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(0); // 片没了
    expect(ensureAutoEdges).toHaveBeenCalled(); // 边跟随回滚（spec 验收 4）
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toEqual([id]);
  });

  it('splitClip：两片 + 撤销还原一片', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const backId = useEditorStore.getState().splitClip(id, 4);
    expect(backId).toBeTruthy();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().data!.tracks[0].clips).toEqual([id]);
  });

  it('removeClip + removeTrack 连片段删', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 });
    const before = useEditorStore.getState().data!.tracks.length;
    useEditorStore.getState().removeTrack(trackId);
    const d = useEditorStore.getState().data!;
    expect(d.tracks).toHaveLength(before - 1);
    expect(Object.keys(d.clips)).toHaveLength(0); // 片段一起删
  });

  it('addTrack 新轨追加；toggleTrack 切换', () => {
    useEditorStore.getState().loadProject(proj());
    const before = useEditorStore.getState().data!.tracks.length;
    const id = useEditorStore.getState().addTrack('audio');
    expect(useEditorStore.getState().data!.tracks).toHaveLength(before + 1);
    useEditorStore.getState().toggleTrack(id, 'muted');
    expect(useEditorStore.getState().data!.tracks.find(t => t.id === id)!.muted).toBe(true);
  });

  it('trimClip：guard 夹取 + 非 transient 入栈', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().trimClip(id, 'right', 999); // 超素材时长 → 夹到 10
    expect(useEditorStore.getState().data!.clips[id].duration).toBe(10);
  });

  it('undo 后 selectedClipId 清理（快照里 clip 可能没了）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().selectClip(id);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().selectedClipId).toBeNull();
  });

  it('trimClip 同轨邻居 clamp：右缘延长不得越过/加深后片（I1）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 60 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const a = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!; // [0,60)
    const b = useEditorStore.getState().splitClip(a, 30)!; // a→[0,30) sourceStart 0；b→[30,60) sourceStart 30
    // 素材 60s 富余：a 右延素材界 = 30、b 左拉素材界 = -30——邻居界（0）才是唯一约束，
    // addClip 直建的片 sourceStart=0 素材界会掩盖邻居界，故经 split 造出 sourceStart 余量
    useEditorStore.getState().trimClip(b, 'left', -10); // b 左缘左拉 → prev.end=30 是下界 → 夹 0（不产生重叠）
    let d = useEditorStore.getState().data!;
    expect(d.clips[b].start).toBe(30);
    useEditorStore.getState().trimClip(a, 'right', 10); // a 右缘延长 → next.start=30 是上界 → 夹 0
    d = useEditorStore.getState().data!;
    expect(d.clips[a].start + d.clips[a].duration).toBe(30); // a 仍终于 30
  });

  it('moveClip 跨轨：clip 从原轨迁到目标轨（store 直测）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const audioTrackId = useEditorStore.getState().addTrack('audio'); // 单轨默认值下显式建音频轨（与生产动态建轨对齐）
    const ok = useEditorStore.getState().moveClip(id, 5, audioTrackId);
    expect(ok).toBe(true);
    const d = useEditorStore.getState().data!;
    expect(d.clips[id].trackId).toBe(audioTrackId);
    expect(d.tracks.find(t => t.id === trackId)!.clips).not.toContain(id);
    expect(d.tracks.find(t => t.id === audioTrackId)!.clips).toContain(id);
  });

  it('setCanvasSize：canvasSize 落库 + transform/keyframes 中心点重映射 + commit 入栈 undo 可回退', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().updateClip(id, {
      transform: { x: 1920, y: 540, scale: 1, rotation: 0, opacity: 1 },
      keyframes: [{ id: 'k1', t: 1, property: 'x', value: 1920, easing: 'linear' }],
    });
    const depth = useEditorStore.getState().history.past.length;
    useEditorStore.getState().setCanvasSize({ width: 1080, height: 1920 });
    const d = useEditorStore.getState().data!;
    expect(d.canvasSize).toEqual({ width: 1080, height: 1920 });
    const clip = d.clips[id] as VideoClip;
    expect(clip.transform.x).toBeCloseTo(1080);  // 1920/1920*1080
    expect(clip.transform.y).toBeCloseTo(960);   // 540/1080*1920
    expect(clip.keyframes[0].value).toBeCloseTo(1080); // 关键帧绝对值同步（spec 5.1）
    expect(useEditorStore.getState().history.past.length).toBe(depth + 1); // commit 完整入栈
    useEditorStore.getState().undo();
    const d0 = useEditorStore.getState().data!;
    expect(d0.canvasSize).toBeUndefined();
    expect((d0.clips[id] as VideoClip).transform.x).toBe(1920);
  });

  it('endTransient 无变更返回 false（begin 后未动直接 end）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().beginTransient();
    expect(useEditorStore.getState().endTransient()).toBe(false);
    expect(useEditorStore.getState().history.past).toHaveLength(0); // 不入栈
  });

  it('undo/redo 清 pendingSnapshot（拖拽中 Ctrl+Z 不产生 bogus 记录）', () => {
    useEditorStore.getState().loadProject(proj());
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const depth = useEditorStore.getState().history.past.length;
    useEditorStore.getState().beginTransient();
    useEditorStore.getState().undo(); // 拖拽中撤销
    expect(useEditorStore.getState().pendingSnapshot).toBeNull(); // 会话作废
    expect(useEditorStore.getState().endTransient()).toBe(false); // 不产生 bogus 记录
    expect(useEditorStore.getState().data!.tracks[0].clips).not.toContain(id); // undo 生效
    expect(useEditorStore.getState().history.past.length).toBe(depth - 1);
  });

  it('setMediaInfo 第四字段 thumbnailUrl 只补缺不覆盖（白名单同步）', () => {
    const es = useEditorStore.getState();
    es.setMediaInfo('m1', { name: 'a', durationSec: 5, thumbnailUrl: 't1' } as never);
    es.setMediaInfo('m1', { name: 'b', durationSec: 6, thumbnailUrl: undefined } as never);
    expect(useEditorStore.getState().mediaInfo.m1.thumbnailUrl).toBe('t1'); // 不被 undefined 覆盖
  });

  it('mergeMediaInfo 同法补缺 thumbnailUrl', () => {
    const es = useEditorStore.getState();
    es.mergeMediaInfo({ m2: { name: 'a', durationSec: 5, thumbnailUrl: 't2' } as never });
    es.mergeMediaInfo({ m2: { name: 'b', durationSec: 6 } }); // 同 id 不带 thumbnailUrl
    expect(useEditorStore.getState().mediaInfo.m2.thumbnailUrl).toBe('t2'); // 保留
  });

  it('P0-7：setMediaInfo 整条替换不擦既有 url/mimeType/durationSec（drop 回调 payload 字段不全场景）', () => {
    const s = useEditorStore.getState();
    s.setMediaInfo('m1', { name: 'a', durationSec: 3, url: 'http://old', mimeType: 'video/mp4' });
    s.setMediaInfo('m1', { name: 'a', durationSec: undefined }); // TimelinePanel drop 形状（无 url/mimeType，durationSec 可 undefined）
    const kept = useEditorStore.getState().mediaInfo['m1'];
    expect(kept.url).toBe('http://old'); // 修复前 undefined
    expect(kept.mimeType).toBe('video/mp4'); // 修复前 undefined
    expect(kept.durationSec).toBe(3); // 修复前 undefined → addClip 兜 5s
  });

  it('shadowJobs 状态机字段：startShadowJob/updateShadowJob/removeShadowJob + generatedMediaIds', () => {
    const s = useEditorStore.getState();
    s.startShadowJob('shadow-video-1', 'video');
    expect(useEditorStore.getState().shadowJobs['shadow-video-1']).toEqual({ kind: 'video', status: 'running' });
    s.updateShadowJob('shadow-video-1', { status: 'downloading' });
    expect(useEditorStore.getState().shadowJobs['shadow-video-1'].status).toBe('downloading');
    s.addGeneratedMedia('media-9', { name: '生成音频', durationSec: 10 });
    expect(useEditorStore.getState().generatedMediaIds).toEqual(['media-9']);
    expect(useEditorStore.getState().mediaInfo['media-9']).toMatchObject({ name: '生成音频', durationSec: 10 });
    s.removeShadowJob('shadow-video-1');
    expect(useEditorStore.getState().shadowJobs['shadow-video-1']).toBeUndefined();
  });
});
