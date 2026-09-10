import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/stores/canvasUndo', () => ({ stopCapturing: vi.fn() }));
vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }));

import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData } from '../types';
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
    const subTrack = useEditorStore.getState().data!.tracks.find(t => t.type === 'subtitle')!;
    const id = useEditorStore.getState().addSubtitleClip(subTrack.id, 1);
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
});
