// canvasStore.t25b-binding.spec.ts
// Y1c T25b 四读径③ web 接线（plan :337）：复制/粘贴后副本媒体的服务端 typed BindMedia 绑定。
// ★红形态=「现零消费」——粘贴/duplicate 现状零 REST 调用（shared 契约+api 端点在位、web 无接线）：
// 修前 bindMedia mock 零调用（红）。doc 副本保留 fileId=既有裁决（Z11''-v14 消灭空图窗口），
// 服务端 NodeArtifact/MediaBinding 权威面经本接线建立（expectedRev=0 新槽 INSERT）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const bindMediaMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/collabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/collabApi')>()),
  bindMedia: bindMediaMock,
}));

import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { status: 'done', fileId: `f-${id}` } });

beforeEach(() => {
  bindMediaMock.mockReset().mockResolvedValue({ type: 'BindMedia', rev: 1, mediaId: 'f-a' });
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100)] as any,
    edges: [{ id: 'e1', source: 'a', target: 'b' }] as any,
    selectedId: null,
    projectId: 'p1',
  });
  useNodeStore.setState({
    nodes: {
      a: { id: 'a', type: 'imageGen', data: { status: 'done', fileId: 'f-a' } },
      b: { id: 'b', type: 'imageGen', data: { status: 'done', fileId: 'f-b' } },
    },
  } as any);
});

const unlockCollab = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });

describe('T25b 四读径③ web 接线：复制/粘贴→typed BindMedia', () => {
  it('★duplicateNodes：携 fileId 的副本对源节点发 BindMedia（src→dst+expectedRev=0）——修前零调用（红）', () => {
    unlockCollab();
    useCanvasStore.getState().duplicateNodes(['a']);
    const s = useCanvasStore.getState();
    const copy = s.nodes.find((n) => n.id !== 'a' && (n.data as any).fileId === 'f-a')!;
    expect(copy).toBeTruthy();
    expect(bindMediaMock).toHaveBeenCalledWith('p1', { type: 'BindMedia', sourceNodeId: 'a', mediaId: 'f-a', targetNodeId: copy.id, expectedRev: 0 });
  });

  it('★pasteGroupClipboard：粘贴副本同接线（源=剪贴板冻结快照成员）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    unlockCollab();
    useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    expect(bindMediaMock).toHaveBeenCalledTimes(2);   // a+b 两携媒体副本
    const args = bindMediaMock.mock.calls.map((c) => c[1]);
    expect(args.every((cmd: any) => cmd.type === 'BindMedia' && cmd.expectedRev === 0)).toBe(true);
    expect(new Set(args.map((cmd: any) => cmd.mediaId))).toEqual(new Set(['f-a', 'f-b']));
  });

  it('命令失败（跨团队/网络）不阻断粘贴主链（fail-soft toast 面——副本 doc 引用保留）', async () => {
    bindMediaMock.mockRejectedValue(new Error('跨团队媒体引用被拒'));
    unlockCollab();
    const first = useCanvasStore.getState().duplicateNodes(['a']);
    expect(first).toBeTruthy();   // 粘贴照常完成
    await vi.waitFor(() => expect(bindMediaMock).toHaveBeenCalled());
  });
});
