// apps/web/src/stores/canvasStore.storyboard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { _setIntentDocForTest } from './canvasIntents';
import { fillDoc } from '@/collab/ydocBuilder';
import { GROUP_PADDING, GROUP_PADDING_TOP } from '@flowweb/shared';

const doneImage = (id: string, x: number, y: number) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180,
     data: { mediaId: `file-${id}` } });

// O0b-4：hidden 派生并入 reconcile（挂点=命令尾 diff 首行/漏斗尾——消费前提=会话 doc 在）；
// 裸 store 无 doc 形态不再是合法装置（旧聚合入口无 doc 也能跑——已整删）
// Y2 A3：cs=作者缓存≡doc——种子同步播 doc（快照以 doc 真值收口，直播 cs 不播会被刷没）
beforeEach(() => {
  const seeded = [
    doneImage('a', 100, 100), doneImage('b', 500, 100),
    doneImage('c', 100, 400), doneImage('d', 500, 400),
    { id: 'text', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
    { id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
      data: { images: [
        { id: 'm1', url: 'u1', name: 'n', status: 'success' },
        { id: 'm2', url: 'u2', name: 'n', status: 'success' },
      ], mainImageIndex: 0, expanded: false, nodeStatus: 'done' } },
  ];
  const doc = new Y.Doc();
  _setIntentDocForTest(doc);
  fillDoc(doc, seeded as any, []);
  // Y2 A3：rw 电平（dispatch 门+窗尾快照以 doc 收口——早退面 cs 也会被空 doc 刷没）
  useCanvasStore.setState({ nodes: seeded as any, edges: [], selectedId: null,
    hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });
  useNodeStore.setState({ nodes: {} });
});

afterEach(() => {
  _setIntentDocForTest(null);
});

describe('mergeStoryboard', () => {
  it('4 张完成图 → 2x2 分镜组，cells 按字典序，组尺寸 642x362', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
    expect((useCanvasStore.getState().renderNodes as any[]).find((n: any) => n.id === gid)!.width).toBeCloseTo(642);   // Y2 A3：分镜组帧=渲染列表内核派生
    expect(g.data.storyboard).toMatchObject({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false });
    // Y2 A3：分镜子不在渲染列表（内核剔除——cs 零 hidden 派生键）
    expect((useCanvasStore.getState().renderNodes as any[]).find((n: any) => n.id === 'a')).toBeUndefined();
  });

  it('multiImageGen 展开为独立隐藏 imageGen 节点', () => {
    const before = useCanvasStore.getState().nodes.length;
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'multi']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    // T17：派生 cells 长度恰=capacity（2x2=4；成员 3：a+2 展开图占槽 0..2，槽 3 空）
    expect(g.data.cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
    const expanded = s.nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded).toHaveLength(2);
    // Y2 B3：展开节点=放置写 mediaId（status 禁键——断言翻键）
    expect(expanded.every((n) => n.type === 'imageGen' && typeof (n.data as any).mediaId === 'string')).toBe(true);
    // R2b-6 写入面清零（F37）：展开节点 data 不得持久化 presigned URL（mediaUrl 键删除）
    expect(expanded.every((n) => !JSON.stringify(n.data).includes('mediaUrl'))).toBe(true);
    expect(s.nodes.find((n) => n.id === 'multi')).toBeUndefined(); // 原节点移除
    expect(s.nodes.length).toBe(before + 2 - 1 + 1); // +2 展开 -1 原节点 +1 组
    // 展开节点必须挂组（parentId）且入格隐藏（Y2 A3：可见集合=内核剔除——分镜子不在渲染列表）
    expect(expanded.every((n) => n.parentId === gid)).toBe(true);
    expect(expanded.every((n) => !(useCanvasStore.getState().renderNodes as any[]).some((r) => r.id === n.id))).toBe(true);
  });

  it('含非完成图节点抛错', () => {
    expect(() => useCanvasStore.getState().mergeStoryboard(['a', 'text'])).toThrow(/完成图片/);
  });
});

describe('convertGroup', () => {
  it('分镜组 → 普通组：取消 hidden、cells 顺序网格重排（40px 间距、320 单格）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    useCanvasStore.getState().convertGroup(gid, 'normal');
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('normal');
    expect(g.data.cells).toBeUndefined();
    const a = s.nodes.find((n) => n.id === 'a')!;
    expect((useCanvasStore.getState().renderNodes as any[]).find((n: any) => n.id === 'a')).toBeTruthy();   // Y2 A3：可见=渲染列表在场
    // cells 顺序 [a,b,c,d]（T17 读序单源），cols=2：网格间距 40px、单格 320。守恒 refit
    //（applyGroupFrame）后首槽 rel 归位 padding 下界 (20,50)，40px 间距判据（相对差）不受影响
    const c = s.nodes.find((n) => n.id === 'c')!;
    const b = s.nodes.find((n) => n.id === 'b')!;
    // Y2 A3：sb→normal 后组=auto 档——帧=内核派生（bbox−padding），首槽 rel 归位 padding 下界
    const rf = (useCanvasStore.getState().renderNodes as any[]).find((n: any) => n.id === gid);
    expect(a.position.x - rf.position.x).toBe(GROUP_PADDING);
    expect(a.position.y - rf.position.y).toBe(GROUP_PADDING_TOP);
    expect(b.position.x - a.position.x).toBeCloseTo(320 + 40); // b 在第二列
    expect(c.position.y - a.position.y).toBeCloseTo(180 + 40); // c 在第二行
    expect(a.width).toBe(320);
  });

  it('普通组（全完成图）→ 分镜组', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toBeUndefined();   // Y2 A3：cs cells 派生缓存退役（写域⑥ 收口——渲染面 cellNodes 派生；格位真源=子 slot）
  });

  it('普通组含非完成图 → 抛错', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'text']);
    expect(() => useCanvasStore.getState().convertGroup(gid, 'storyboard')).toThrow(/仅包含.*图片/);
  });
});
