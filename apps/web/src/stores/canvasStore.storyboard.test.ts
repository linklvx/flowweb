// apps/web/src/stores/canvasStore.storyboard.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { GROUP_PADDING, GROUP_PADDING_TOP } from '@flowweb/shared';

const doneImage = (id: string, x: number, y: number) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180,
     data: { status: 'done', fileId: `file-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [
      doneImage('a', 100, 100), doneImage('b', 500, 100),
      doneImage('c', 100, 400), doneImage('d', 500, 400),
      { id: 'text', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '' } },
      { id: 'multi', type: 'multiImageGen', position: { x: 1000, y: 100 }, width: 320, height: 200,
        data: { images: [
          { id: 'm1', url: 'u1', name: 'n', status: 'success' },
          { id: 'm2', url: 'u2', name: 'n', status: 'success' },
        ], mainImageIndex: 0, expanded: false, nodeStatus: 'done' } },
    ] as any,
    edges: [], selectedId: null,
  });
  useNodeStore.setState({ nodes: {} });
});

describe('mergeStoryboard', () => {
  it('4 张完成图 → 2x2 分镜组，cells 按字典序，组尺寸 642x362', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c', 'd']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toEqual(['a', 'c', 'b', 'd']); // x: 100(a,c) < 500(b,d)；a.y<c.y
    expect(g.width).toBeCloseTo(642);
    expect(g.data.storyboard).toMatchObject({ aspectRatio: '16:9', gridRows: 2, gridCols: 2, showIndex: false });
    expect(s.nodes.find((n) => n.id === 'a')!.hidden).toBe(true);
  });

  it('multiImageGen 展开为独立隐藏 imageGen 节点', () => {
    const before = useCanvasStore.getState().nodes.length;
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'multi']);
    const s = useCanvasStore.getState();
    const g = s.nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).toHaveLength(3); // a + 2 张展开图
    expect((g.data.cells as any)[0]).toBe('a'); // a.x=100 < multi.x=1000 → 展开图不插队（P1-新1）
    const expanded = s.nodes.filter((n) => (n.data as any).__fromMulti === 'multi');
    expect(expanded).toHaveLength(2);
    expect(expanded.every((n) => n.type === 'imageGen' && (n.data as any).status === 'done')).toBe(true);
    // R2b-6 写入面清零（F37）：展开节点 data 不得持久化 presigned URL（mediaUrl 键删除）
    expect(expanded.every((n) => !JSON.stringify(n.data).includes('mediaUrl'))).toBe(true);
    expect(s.nodes.find((n) => n.id === 'multi')).toBeUndefined(); // 原节点移除
    expect(s.nodes.length).toBe(before + 2 - 1 + 1); // +2 展开 -1 原节点 +1 组
    // 展开节点必须挂组（parentId + hidden），否则游离在画布上不隐藏也不入格
    expect(expanded.every((n) => n.parentId === gid && n.hidden === true)).toBe(true);
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
    expect(a.hidden).toBe(false);
    // cells 顺序 [a,c,b,d]，cols=2：网格间距 40px、单格 320。守恒 refit（applyGroupFrame）后
    // 首槽 rel 归位 padding 下界 (20,50)，40px 间距判据（相对差）不受影响
    const c = s.nodes.find((n) => n.id === 'c')!;
    const b = s.nodes.find((n) => n.id === 'b')!;
    expect(a.position).toEqual({ x: GROUP_PADDING, y: GROUP_PADDING_TOP });
    expect(c.position.x - a.position.x).toBeCloseTo(320 + 40); // c 在第二列
    expect(b.position.y - a.position.y).toBeCloseTo(180 + 40); // b 在第二行
    expect(a.width).toBe(320);
  });

  it('普通组（全完成图）→ 分镜组', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().convertGroup(gid, 'storyboard');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toHaveLength(2);
  });

  it('普通组含非完成图 → 抛错', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'text']);
    expect(() => useCanvasStore.getState().convertGroup(gid, 'storyboard')).toThrow(/仅包含.*图片/);
  });
});
