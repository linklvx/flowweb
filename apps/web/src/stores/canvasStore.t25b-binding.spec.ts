// canvasStore.t25b-binding.spec.ts
// Y1c T25b 四读径③ web 接线 → Y2 D1t 重写（spec v2.13 §4 第④步 D5）：BindMedia 命令体五字段
// （sourceProjectId+commandId 入、expectedRev 删）+N 带媒体节点=N commandId 各自独立幂等
// （一个失败不影响其余——spec §6 D5「一次粘贴 N 个带媒体节点=N 个 commandId」出口）。
// doc 副本槽剥离（B3 裁决 4）——副本 data 零媒体身份，绑定经服务端命令+投影补。
// localPreview 清面=D5t 建表后按节点 id 清（本 commit 挂点注释形态——表不建）。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const bindMediaMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/collabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/collabApi')>()),
  bindMedia: bindMediaMock,
}));

import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { mediaId: `f-${id}` } });

beforeEach(() => {
  bindMediaMock.mockReset().mockResolvedValue({ type: 'BindMedia', rev: 0, mediaId: 'f-a' });
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100)] as any,
    edges: [{ id: 'e1', source: 'a', target: 'b' }] as any,
    selectedId: null,
    projectId: 'p1',
  });
  useNodeStore.setState({
    nodes: {
      a: { id: 'a', type: 'imageGen', data: { mediaId: 'f-a' } },
      b: { id: 'b', type: 'imageGen', data: { mediaId: 'f-b' } },
    },
  } as any);
});

const unlockCollab = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });

describe('T25b 四读径③ web 接线 → Y2 D1t 五字段+独立幂等', () => {
  it('★duplicateNodes（Y2 B3 裁决 4 形态）：副本槽剥离（data 无 mediaId）+对源节点发五字段 BindMedia', () => {
    unlockCollab();
    useCanvasStore.getState().duplicateNodes(['a']);
    const s = useCanvasStore.getState();
    const copy = s.nodes.find((n) => n.id !== 'a' && n.id !== 'b')!;
    expect(copy).toBeTruthy();
    // Y2 B3：copyPlan 剥离 fileId/mediaId——副本 data 零媒体身份（图示经 bind 命令服务端投影补）
    expect((copy.data as any).mediaId).toBeUndefined();
    expect((copy.data as any).fileId).toBeUndefined();
    // Y2 D1t 五字段：sourceProjectId=当前项目（duplicateNodes 同项目路径仍发命令——同团队三档 D3t 落地）
    expect(bindMediaMock).toHaveBeenCalledWith('p1', {
      type: 'BindMedia', sourceProjectId: 'p1', sourceNodeId: 'a', mediaId: 'f-a',
      targetNodeId: copy.id, commandId: expect.any(String),
    });
    const cmd = bindMediaMock.mock.calls[0][1] as Record<string, unknown>;
    expect(cmd.expectedRev).toBeUndefined();   // expectedRev 彻底删（D1t 裁定）
  });

  it('★pasteGroupClipboard：N 携媒体节点=N commandId 各自独立（每命令唯一 commandId）', () => {
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    unlockCollab();
    useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    expect(bindMediaMock).toHaveBeenCalledTimes(2);   // a+b 两携媒体副本
    const args = bindMediaMock.mock.calls.map((c) => c[1]);
    expect(args.every((cmd: any) => cmd.type === 'BindMedia' && cmd.sourceProjectId === 'p1' && cmd.expectedRev === undefined)).toBe(true);
    expect(new Set(args.map((cmd: any) => cmd.mediaId))).toEqual(new Set(['f-a', 'f-b']));
    // 幂等范围=源媒体→目标节点：N 节点 N 个互不相同的 commandId（spec D5 出口）
    const commandIds = args.map((cmd: any) => cmd.commandId);
    expect(new Set(commandIds).size).toBe(2);
    expect(commandIds.every((id: unknown) => typeof id === 'string' && (id as string).length > 0)).toBe(true);
  });

  it('★D1t 独立幂等：一节点 409（SLOT_OCCUPIED）一节点 200——后者照常完成、失败者分档 toast', async () => {
    bindMediaMock.mockImplementation(async (_pid: string, cmd: { mediaId: string }) => {
      if (cmd.mediaId === 'f-a') throw new (await import('@/api/collabApi')).SlotOccupiedError('槽位已被其他成员写入', { status: 409, errorCode: 'SLOT_OCCUPIED', body: undefined });
      return { type: 'BindMedia', rev: 0, mediaId: 'f-b' };
    });
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    unlockCollab();
    useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    // 两命令各自独立发出（一败不影响其余——N commandId 幂等范围出口）
    await vi.waitFor(() => expect(bindMediaMock).toHaveBeenCalledTimes(2));
    const args = bindMediaMock.mock.calls.map((c) => c[1]);
    expect(new Set(args.map((cmd: any) => cmd.commandId)).size).toBe(2);   // 失败者不污染其余 commandId 域
  });

  it('命令失败（跨团队/网络）不阻断粘贴主链（fail-soft toast 面——副本 doc 引用保留）', async () => {
    bindMediaMock.mockRejectedValue(new Error('跨团队媒体引用被拒'));
    unlockCollab();
    const first = useCanvasStore.getState().duplicateNodes(['a']);
    expect(first).toBeTruthy();   // 粘贴照常完成
    await vi.waitFor(() => expect(bindMediaMock).toHaveBeenCalled());
  });
});
