import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { seedEmptyTimeline } from '@flowweb/shared';
import { setTimelineDocRef, executeTimelineCommit } from '@/stores/timelineUndo';

vi.mock('@/stores/canvasUndo', () => ({ stopCapturing: vi.fn() }));
vi.mock('../timeline/auto-edges', () => ({ ensureAutoEdges: vi.fn() }));
// Y4b T2：timelineUndo 部分 mock——只接管 executeTimelineCommit（主用例 B 拒绝路径注入点，
// writeTimelineToDoc 对 doc ref/entry 缺席返 true=本地推进，故须 mock 到执行器这层才拒得下来）；
// 其余导出（setTimelineDocRef/loadProject 水合/undo 管线）全走真实实现，本套其余用例零感知。
vi.mock('@/stores/timelineUndo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/timelineUndo')>();
  return { ...actual, executeTimelineCommit: vi.fn(actual.executeTimelineCommit) };
});

import { useEditorStore } from './editorStore';
import { createDefaultProjectData, type ProjectData, type VideoClip } from '../types';
import { stopCapturing } from '@/stores/canvasUndo';
import { ensureAutoEdges } from '../timeline/auto-edges';
import { useVideoEditorStore } from '@/stores/videoEditorStore';

// Y4a T7（spec §4）：undo/redo=时间轴栈（Y-backed——editorStore.timeline.spec 锁 doc 管线）；
// 本套只锁纯本地数据面（placement/guard/keyframe 归一化——离线无 doc ref：commit 本地推进、
// undo() 返 false）。history JSON 快照史随 REST 链退场——本套不再有 history.past 断言。
const ready = (data?: ProjectData) => {
  const d = data ?? createDefaultProjectData();
  useEditorStore.setState({ status: 'ready', data: d, sourceNodeId: 'edit1', playhead: 0 });
  return d;
};

/** 实水合夹具（Y4b T1，Task 2 复用）：timelines 根 set('edit1', seedEmptyTimeline('edit1'))
 *  〔禁用空 Y.Map——readTimelineFromDoc 对空 Map 返 null（version!==1/缺 tracks/clips）、
 *  loadProject :263 早退到不了 :279、对账计数停 0=夹具不合法非产品缺陷〕+nodes Map 一个
 *  非剪辑节点；edges 根空。doc ref 直登（setTimelineDocRef——生产接线 canvasCollabRuntime）。 */
const hydratedDocFixture = (): Y.Doc => {
  const doc = new Y.Doc();
  doc.transact(() => {
    const node = new Y.Map();
    node.set('id', 'n0');
    node.set('type', 'note');
    doc.getMap('nodes').set('n0', node);
    doc.getMap('timelines').set('edit1', seedEmptyTimeline('edit1'));
  }, 'local-user');
  setTimelineDocRef(doc);
  return doc;
};

describe('editorStore（纯本地数据面——Y4a T7 离线档）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  it('离线（无 doc ref）loadProject → false 不进 ready（编辑器无 doc 可读——键不在不创建）', () => {
    expect(useEditorStore.getState().loadProject('edit1')).toBe(false);
    expect(useEditorStore.getState().status).toBe('idle');
  });

  it('addClip 视频片：duration 取 mediaInfo，track.clips 按 start 有序', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: '素材A', durationSec: 8 });
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 's1', trackId, start: 2 });
    expect(id).toBeTruthy();
    const d = useEditorStore.getState().data!;
    expect(d.clips[id!].duration).toBe(8);
    expect(d.tracks[0].clips).toEqual([id]);
    expect(ensureAutoEdges).toHaveBeenCalled();
  });

  it('addClip 同轨冲突自动吸附最近空位', () => {
    ready();
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
    ready();
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const id = useEditorStore.getState().addClip({ type: 'image', mediaId: 'img1', trackId, start: 0 });
    expect(useEditorStore.getState().data!.clips[id!].duration).toBe(5);
  });

  it('addSubtitleClip：3s + 默认文本', () => {
    ready();
    const subTrackId = useEditorStore.getState().addTrack('subtitle'); // 单轨默认值下显式建字幕轨（与生产动态建轨对齐）
    const id = useEditorStore.getState().addSubtitleClip(subTrackId, 1);
    const c = useEditorStore.getState().data!.clips[id] as any;
    expect(c.type).toBe('subtitle');
    expect(c.duration).toBe(3);
    expect(c.text).toBe('新字幕');
  });

  it('transient 拖动：begin → move×N 本地跟手 → end 一次落定（离线无 doc 笔）', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;

    useEditorStore.getState().beginTransient();
    expect(useEditorStore.getState().pendingOverlay).not.toBeNull();   // 覆盖层会话已开（state 镜像）
    for (let i = 1; i <= 3; i++) {
      useEditorStore.getState().moveClip(id, i, undefined, { transient: true });
    }
    useEditorStore.getState().endTransient();
    expect(useEditorStore.getState().pendingOverlay).toBeNull();        // 会话收口
    expect(stopCapturing).toHaveBeenCalled(); // 断画布 500ms 合并窗（sourceNodeId 在位）
    expect(useEditorStore.getState().data!.clips[id].start).toBe(3);
  });

  it('离线 undo/redo → false（时间轴栈 Y-backed——无 doc 无栈可弹）', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 });
    expect(useEditorStore.getState().undo()).toBe(false);   // 离线无栈——doc 管线 undo 由 timeline.spec 锁
    expect(useEditorStore.getState().redo()).toBe(false);
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(1);   // 数据不动
  });

  it('splitClip：两片（离线档）', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    const backId = useEditorStore.getState().splitClip(id, 4);
    expect(backId).toBeTruthy();
    expect(useEditorStore.getState().data!.tracks[0].clips).toHaveLength(2);
  });

  it('removeClip + removeTrack 连片段删', () => {
    ready();
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
    ready();
    const before = useEditorStore.getState().data!.tracks.length;
    const id = useEditorStore.getState().addTrack('audio');
    expect(useEditorStore.getState().data!.tracks).toHaveLength(before + 1);
    useEditorStore.getState().toggleTrack(id, 'muted');
    expect(useEditorStore.getState().data!.tracks.find(t => t.id === id)!.muted).toBe(true);
  });

  it('trimClip：guard 夹取', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 10 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().trimClip(id, 'right', 999); // 超素材时长 → 夹到 10
    expect(useEditorStore.getState().data!.clips[id].duration).toBe(10);
  });

  it('trimClip 同轨邻居 clamp：右缘延长不得越过/加深后片（I1）', () => {
    ready();
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
    ready();
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

  it('setCanvasSize：canvasSize 落库 + transform/keyframes 中心点重映射', () => {
    ready();
    useEditorStore.getState().setMediaInfo('m1', { name: 'A', durationSec: 3 });
    const st = useEditorStore.getState();
    const trackId = st.data!.tracks[0].id;
    const id = st.addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 })!;
    useEditorStore.getState().updateClip(id, {
      transform: { x: 1920, y: 540, scale: 1, rotation: 0, opacity: 1 },
      keyframes: [{ id: 'k1', t: 1, property: 'x', value: 1920, easing: 'linear' }],
    });
    useEditorStore.getState().setCanvasSize({ width: 1080, height: 1920 });
    const d = useEditorStore.getState().data!;
    expect(d.canvasSize).toEqual({ width: 1080, height: 1920 });
    const clip = d.clips[id] as VideoClip;
    expect(clip.transform.x).toBeCloseTo(1080);  // 1920/1920*1080
    expect(clip.transform.y).toBeCloseTo(960);   // 540/1080*1920
    expect(clip.keyframes[0].value).toBeCloseTo(1080); // 关键帧绝对值同步（spec 5.1）
  });

  it('endTransient 无变更返回 false（begin 后未动直接 end）', () => {
    ready();
    useEditorStore.getState().beginTransient();
    expect(useEditorStore.getState().endTransient()).toBe(false);
    expect(useEditorStore.getState().pendingOverlay).toBeNull(); // 会话收口
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

  it('批5 删信箱锚：shadowJobs/generatedMediaIds 及其 action 不再存在（接触面零回流）', () => {
    const s = useEditorStore.getState() as unknown as Record<string, unknown>;
    expect(s.shadowJobs).toBeUndefined();
    expect(s.generatedMediaIds).toBeUndefined();
    expect(s.startShadowJob).toBeUndefined();
    expect(s.updateShadowJob).toBeUndefined();
    expect(s.removeShadowJob).toBeUndefined();
    expect(s.addGeneratedMedia).toBeUndefined();
  });

  it('Y4a T7 状态面锚：projectId/baseUpdatedAt/title/teamId/saveState/history 字段随 REST 链退场', () => {
    const s = useEditorStore.getState() as unknown as Record<string, unknown>;
    expect(s.projectId).toBeUndefined();
    expect(s.baseUpdatedAt).toBeUndefined();
    expect(s.title).toBeUndefined();
    expect(s.teamId).toBeUndefined();
    expect(s.saveState).toBeUndefined();
    expect(s.history).toBeUndefined();
  });
});

describe('m#4 水合 AutoEdge 对账锚（Y4a 终审批外债）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  afterEach(() => {
    useEditorStore.getState().reset();   // 拆监听+卸时间轴栈（reset 内含 detachDocListeners/detachTimelineUndo）
    setTimelineDocRef(null);   // doc ref 摘除（模块级单源——reset 不摘 ref，此处补位）
  });

  it("主用例 1：loadProject('edit1') 水合 → afterStructuralChange 恰对账一次（ensureAutoEdges 调用 1 次）", () => {
    hydratedDocFixture();
    expect(useEditorStore.getState().loadProject('edit1')).toBe(true);   // 水合成功（键在+可读）——对账已发生的前置
    expect(useEditorStore.getState().status).toBe('ready');
    expect(ensureAutoEdges).toHaveBeenCalledTimes(1);   // m#4：水合完成 AutoEdge 对账一次（:279——补崩溃窗没写上的边）
  });

  it('主用例 2：水合后 timelines 根键 Map 替换（另一棵 seedEmptyTimeline）→ :186 路径恰再对账一次（累计 2）', () => {
    const doc = hydratedDocFixture();
    expect(useEditorStore.getState().loadProject('edit1')).toBe(true);
    expect(ensureAutoEdges).toHaveBeenCalledTimes(1);   // 基线=水合对账一次
    // 根键替换（远端换键同款语义——装置直写模拟；禁用空 Y.Map 替换：readTimelineFromDoc
    // 返 null、:186 next!==null 守卫不再对账）
    doc.transact(() => {
      doc.getMap('timelines').set('edit1', seedEmptyTimeline('edit1'));
    }, 'remote-peer');
    expect(ensureAutoEdges).toHaveBeenCalledTimes(2);   // Map 替换路径 :186 对账恰一次（累计+1）
  });

  it('用例 3（裁决附录 2）：替换后再删 timelines 键 → status idle+编辑器壳关（:158/:185 复活——修前替换后监听绑 null id 恒早退）', async () => {
    const doc = hydratedDocFixture();
    expect(useEditorStore.getState().loadProject('edit1')).toBe(true);
    doc.transact(() => {
      doc.getMap('timelines').set('edit1', seedEmptyTimeline('edit1'));
    }, 'remote-peer');
    useVideoEditorStore.setState({ open: true, sourceNodeId: 'edit1', miniPlaybackNodeId: null });   // 壳开着——键删除该关掉
    doc.transact(() => {
      doc.getMap('timelines').delete('edit1');
    }, 'remote-peer');
    expect(useEditorStore.getState().status).toBe('idle');
    expect(useVideoEditorStore.getState().open).toBe(false);
  });
});

describe('Y4b T2：m#5 addClip 写前检查锚 + commit boolean 返形统一', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  afterEach(() => {
    useEditorStore.getState().reset();   // 拆监听+卸时间轴栈（reset 内含 detachDocListeners/detachTimelineUndo）
    setTimelineDocRef(null);   // doc ref 摘除（模块级单源——reset 不摘 ref，此处补位）
  });

  it('主用例 A（m#5 写前检查锚——回归锁）：水合态 addClip 指向不存在源节点 → 返 null、doc 零 update、本地不含新片', () => {
    const doc = hydratedDocFixture();
    const updateListener = vi.fn();
    doc.on('update', updateListener);
    expect(useEditorStore.getState().loadProject('edit1')).toBe(true);   // 水合（key 前置——非空本地态；sourceNodeId 已随水合落位）
    updateListener.mockClear();   // 水合装载笔不计入（本用例只量 addClip 之后的写面）
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const before = useEditorStore.getState().data!;
    const result = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', sourceNodeId: 'src1', trackId, start: 0 });   // nodes 根无 'src1'（夹具只含 n0）
    expect(result).toBeNull();   // 悬挂引用不产生（写前检查拒——不发事务不建片）
    expect(updateListener).not.toHaveBeenCalled();   // doc 零 update 事件（不发事务=真行为面）
    expect(useEditorStore.getState().data!.clips).toEqual(before.clips);   // 本地不含新片
    doc.destroy();
  });

  it('主用例 B（commit 返形统一——红锚）：水合态执行器拒（executeTimelineCommit→false）→ addClip 返 null 且本地保持 prev', () => {
    const doc = hydratedDocFixture();
    expect(useEditorStore.getState().loadProject('edit1')).toBe(true);
    const trackId = useEditorStore.getState().data!.tracks[0].id;
    const prev = useEditorStore.getState().data!;
    vi.mocked(executeTimelineCommit).mockReturnValue(false);   // 写拒注入（writeTimelineToDoc 只在此层可拒）
    const result = useEditorStore.getState().addClip({ type: 'video', mediaId: 'm1', trackId, start: 0 });
    expect(result).toBeNull();   // 现状红在拒时仍返 id——commit 须返 false、addClip 据此返 null
    expect(useEditorStore.getState().data).toBe(prev);   // 本地保持 prev（拒不落 next）
    doc.destroy();
  });
});
