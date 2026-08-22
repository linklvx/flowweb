import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from './canvasStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100), doneImage('c', 100, 400)] as any,
    edges: [], selectedId: null, nodeProcessMap: {},
  });
});

describe('deleteNode 组清理', () => {
  it('分镜组：删子节点 → cells 移除、组保留', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b', 'c']);
    useCanvasStore.getState().deleteNode('a');
    const g = useCanvasStore.getState().nodes.find((n) => n.id === gid)!;
    expect(g.data.cells).not.toContain('a');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeTruthy();
  });

  it('普通组：删空后自动解组', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.getState().deleteNode('a');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeTruthy(); // 还剩 b
    useCanvasStore.getState().deleteNode('b');
    expect(useCanvasStore.getState().nodes.find((n) => n.id === gid)).toBeUndefined(); // 空组自动解组
  });
});

describe('hasActiveProcessInGroup（执行中禁令）', () => {
  it('组内节点有活跃进程 → true', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    useCanvasStore.setState({ nodeProcessMap: { a: { processType: 'generating', status: 'processing' } } } as any);
    expect(useCanvasStore.getState().hasActiveProcessInGroup(gid)).toBe(true);
  });

  it('无进程 → false', () => {
    const gid = useCanvasStore.getState().groupNodes(['a', 'b']);
    expect(useCanvasStore.getState().hasActiveProcessInGroup(gid)).toBe(false);
  });
});
