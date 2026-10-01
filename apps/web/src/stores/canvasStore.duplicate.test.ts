// canvasStore.duplicate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100)] as any,
    edges: [{ id: 'e1', source: 'a', target: 'b' }] as any,
    selectedId: null,
  });
  // 2a-6：薄壳取数走 resolveNodeData（普通节点=ns 全量，缺即红）——ns 与 cs 同步播种（生产态恒双写）
  useNodeStore.setState({
    nodes: {
      a: { id: 'a', type: 'imageGen', data: { status: 'done', fileId: 'f-a' } },
      b: { id: 'b', type: 'imageGen', data: { status: 'done', fileId: 'f-b' } },
    },
  } as any);
});

// duplicateGroup/paste 走 runCommand canEdit 门（2a-6 薄壳化）——rw 会话电平注入
const unlockCollab = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, projectId: 'p1' });

describe('duplicateGroup', () => {
  it('深拷贝新 ID + fileId 复用 + 组内边复制 + 跨组边不复制', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    unlockCollab();
    const newGid = useCanvasStore.getState().duplicateGroup(gid);
    const s = useCanvasStore.getState();
    const orig = s.nodes.find((n) => n.id === gid)!;
    const copy = s.nodes.find((n) => n.id === newGid)!;
    expect(copy.position.x).toBeCloseTo(orig.position.x + 40);
    expect((copy.data as any).cells).toHaveLength(2);
    expect((copy.data as any).cells!.every((id: string) => id !== 'a' && id !== 'b')).toBe(true); // 新 ID
    const copyChildren = s.nodes.filter((n) => n.parentId === newGid);
    expect(copyChildren).toHaveLength(2);
    expect((copyChildren[0].data as any).fileId).toMatch(/^f-/); // fileId 复用
    // 分镜组组内边（a→b 原有边保留原节点；复制边存在于新节点之间）
    const copyIds = copyChildren.map((n) => n.id);
    expect(s.edges.filter((e) => copyIds.includes(e.source) && copyIds.includes(e.target))).toHaveLength(1);
    expect(s.edges.filter((e) => e.id === 'e1')).toHaveLength(1); // 原边不动
  });
});

describe('copy/paste clipboard', () => {
  it('粘贴副本到指定位置', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    unlockCollab();
    const newGid = useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    expect(useCanvasStore.getState().nodes.find((n) => n.id === newGid)).toBeTruthy();
  });
});
