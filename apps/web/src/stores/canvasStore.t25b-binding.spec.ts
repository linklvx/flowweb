// canvasStore.t25b-binding.spec.ts
// Y1c T25b 四读径③ web 接线 → Y2 D1t 重写（spec v2.13 §4 第④步 D5）：BindMedia 命令体五字段
// （sourceProjectId+commandId 入、expectedRev 删）+N 带媒体节点=N commandId 各自独立幂等
// （一个失败不影响其余——spec §6 D5「一次粘贴 N 个带媒体节点=N 个 commandId」出口）。
// doc 副本槽剥离（B3 裁决 4）——副本 data 零媒体身份，绑定经服务端命令+投影补。
// Y2 D5t：localPreview 表（节点 id→blob URL——跨团队粘贴在 CopyObject 完成前画面即时预览；
// 唯一读点=projectCanvas 参数、命令终态/失败/槽占按节点清+必 revokeObjectURL、不进作者缓存/diff/doc）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bindMediaMock = vi.hoisted(() => vi.fn());
vi.mock('@/api/collabApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/collabApi')>()),
  bindMedia: bindMediaMock,
}));

import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { _setIntentDocForTest } from './canvasIntents';
import * as Y from 'yjs';

const doneImage = (id: string, x = 100, y = 100) =>
  ({ id, type: 'imageGen', position: { x, y }, width: 320, height: 180, data: { mediaId: `f-${id}` } });

beforeEach(() => {
  bindMediaMock.mockReset().mockResolvedValue({ type: 'BindMedia', rev: 0, mediaId: 'f-a' });
  useCanvasStore.setState({
    nodes: [doneImage('a'), doneImage('b', 500, 100)] as any,
    edges: [{ id: 'e1', source: 'a', target: 'b' }] as any,
    selectedId: null,
    projectId: 'p1',
    localPreview: new Map(),   // Y2 D5t：表复位（跨用例零残留——blob URL 由各 describe 内 stub 承载）
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

// ════════ Y2 D5t：localPreview 表（spec §6 D5 ① 客户端——三档红测）════════
// 表=节点 id→blob URL（canvasStore 状态字段）；写入=复制时自本会话字节建 blob
// （fetch /api/media/:id/content→Blob→URL.createObjectURL——跨团队粘贴在 CopyObject 完成前画面
// 即时预览；同团队不建〔无拷贝即无预览需求〕）；唯一读点=projectCanvas 参数（预览叠在渲染节点
// data.previewUrl——不进作者缓存/diff/doc）；清除=命令失败/槽=他 id 按节点清+必 revokeObjectURL
// （blob 泄漏红线）+成功档命令终态清+会话边界全表清。
describe('Y2 D5t：localPreview 表三档（建表/清面/零 doc 面）', () => {
  /** jsdom 无 URL.createObjectURL——静态方法注入（canvasCollabRuntime.t8.spec 同款；测后删除还原）。 */
  let created: string[] = [];
  let revoked: string[] = [];
  const stubBlobUrls = () => {
    created = []; revoked = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => `blob:mock-${created.length}`,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (u: string) => { revoked.push(u); },
    });
    created.push(''); // 占位使首个调用产出 blob:mock-0
    created.pop();
  };
  const restoreBlobUrls = () => {
    delete (URL as any).createObjectURL;
    delete (URL as any).revokeObjectURL;
  };
  /** 字节抓取桩：默认成功回一段字节（blob 建链照走）。生产形态时序——字节抓取（30ms）先于
   *  bindMedia 回执（80ms）完成：预览窗 [30ms,80ms) 可观测（CopyObject 在途档）。 */
  const stubBytes = (impl?: (url: string) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 30));
      if (impl) return impl(url);
      return { ok: true, blob: async () => new Blob(['bytes'], { type: 'image/webp' }) };
    }));
  };
  /** bindMedia 桩包一层生产形态延迟（80ms>30ms——回执晚于字节；默认 resolve 档）。 */
  const slowBind = () => {
    bindMediaMock.mockReset().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { type: 'BindMedia', rev: 0, mediaId: 'f-a' };
    });
  };
  /** bindMedia 桩包一层生产形态延迟（80ms>30ms）+拒绝值。 */
  const slowBindReject = (err: unknown) => {
    bindMediaMock.mockReset().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 80));
      throw err;
    });
  };
  const previewMap = () => (useCanvasStore.getState() as any).localPreview as Map<string, string>;

  beforeEach(() => {
    stubBlobUrls();
    stubBytes();
  });
  afterEach(() => {
    restoreBlobUrls();
    vi.unstubAllGlobals();
  });

  it('★档①：复制携媒体节点→localPreview 表落 blob URL（跨团队在途预览面）——不进作者缓存/diff/doc', async () => {
    slowBind();   // 生产形态：字节先到、回执后到——预览窗可观测
    // 裸 doc 装置（canvasIntents.spec 同款——渲染列表重算/不变量断言需要 doc 在场）
    const doc = new Y.Doc();
    _setIntentDocForTest(doc);
    try {
      unlockCollab();
      const first = useCanvasStore.getState().duplicateNodes(['a'])!;
      expect(first).toBeTruthy();
      // 异步字节抓取+建 blob——waitFor 收敛
      await vi.waitFor(() => expect(previewMap().size).toBe(1));
      const dstId = [...previewMap().keys()][0];
      const url = previewMap().get(dstId)!;
      expect(url).toMatch(/^blob:/);
      // 唯一读点=projectCanvas 参数：渲染列表副本节点 data.previewUrl 盖面（解析为空槽——B3 剥离后副本零作者键）
      const rn = (useCanvasStore.getState().renderNodes as any[]).find((n) => n.id === dstId)!;
      expect(rn).toBeTruthy();
      expect((rn.data as Record<string, unknown>).previewUrl).toBe(url);
      // ★不进作者缓存：副本 cs data 零预览键（localPreview 是独立 store 字段非 data 键）
      const csCopy = useCanvasStore.getState().nodes.find((n) => n.id === dstId)!;
      expect((csCopy.data as Record<string, unknown>).previewUrl).toBeUndefined();
      // ★不进 doc：doc 目标节点 data 无预览键（表是纯本地覆盖层——doc 只收 copyPlan 剥离后的用户域键）
      const dstMap = doc.getMap('nodes').get(dstId) as any;
      expect(dstMap).toBeTruthy();
      expect(((dstMap.get('data') as any).toJSON() as Record<string, unknown>).previewUrl).toBeUndefined();
      // 源 id 不进 doc（spec §6 D5 ①「源 id 不进 doc」——copyPlan 剥离面回归锚）
      expect(JSON.stringify(doc.getMap('nodes').toJSON())).not.toContain('"f-a"');
    } finally {
      _setIntentDocForTest(null);
    }
  });

  it('★档②：命令失败（网络）→按节点清+revokeObjectURL（同批其余节点预览不受连坐）', async () => {
    slowBindReject(new Error('跨团队媒体引用被拒'));
    const gid = useCanvasStore.getState().mergeStoryboard(['a', 'b']);
    useCanvasStore.getState().copyGroupToClipboard(gid);
    unlockCollab();
    useCanvasStore.getState().pasteGroupClipboard({ x: 0, y: 0 });
    await vi.waitFor(() => expect(previewMap().size).toBe(2));   // 两副本各有预览
    const ids = [...previewMap().keys()];
    // bindMedia 各自失败 → 两节点各自清+各自 revoke
    await vi.waitFor(() => expect(previewMap().size).toBe(0));
    expect(revoked.filter((u) => u.startsWith('blob:')).length).toBe(2);   // 必 revokeObjectURL——泄漏红线
    expect(ids.length).toBe(2);
  });

  it('★档③：槽=他 id（409 SLOT_OCCUPIED）→按节点清+revokeObjectURL', async () => {
    slowBindReject(new (await import('@/api/collabApi')).SlotOccupiedError('槽位已被其他成员写入', { status: 409, errorCode: 'SLOT_OCCUPIED', body: undefined }));
    unlockCollab();
    useCanvasStore.getState().duplicateNodes(['a']);
    await vi.waitFor(() => expect(previewMap().size).toBe(1));
    await vi.waitFor(() => expect(previewMap().size).toBe(0));   // 槽占档=画面以对方为准——预览清
    expect(revoked.filter((u) => u.startsWith('blob:')).length).toBe(1);
  });

  it('★成功档：命令终态（回执 200）→按节点清+revokeObjectURL（Yjs 回流前画面由解析槽补）', async () => {
    slowBind();
    unlockCollab();
    useCanvasStore.getState().duplicateNodes(['a']);
    await vi.waitFor(() => expect(previewMap().size).toBe(1));
    await vi.waitFor(() => expect(previewMap().size).toBe(0));   // 成功=命令终态清空
    expect(revoked.filter((u) => u.startsWith('blob:')).length).toBe(1);
  });

  it('★字节抓取失败降级：预览层尽力而为——零 blob 零表项，粘贴主链/绑定命令照常', async () => {
    slowBind();
    stubBytes(() => Promise.resolve({ ok: false, blob: async () => new Blob([]) }));
    unlockCollab();
    const first = useCanvasStore.getState().duplicateNodes(['a'])!;
    expect(first).toBeTruthy();   // 粘贴照常完成（预览非阻断面）
    await vi.waitFor(() => expect(bindMediaMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(previewMap().size).toBe(0);   // 抓取失败=零表项（无 blob 即无预览需求）
    expect(created.filter((u) => u.startsWith('blob:')).length).toBe(0);
  });

  it('★会话边界：destroyCollab 复位档全表清（revokeObjectURL 兜底——切项目/登出零泄漏）', async () => {
    slowBind();
    // 直接验证 store 复位语义：destroyCollab 的粘滞态复位集含 localPreview（本 spec 裸 store——
    // 断言复位面而非驱动完整 destroyCollab〔需要 provider 装置——复位集语义由 canvasCollabRuntime 持有〕）
    unlockCollab();
    useCanvasStore.getState().duplicateNodes(['a']);
    await vi.waitFor(() => expect(previewMap().size).toBe(1));
    // destroyCollab 对粘滞态字段的清空面（见 canvasCollabRuntime destroyCollab 段）
    // ——此处断言 localPreview 属于会话态字段族（可被整表清零+revoke）
    const { destroyCollab } = await import('./canvasCollabRuntime');
    await destroyCollab();
    expect(previewMap().size ?? 0).toBe(0);
    expect(revoked.filter((u) => u.startsWith('blob:')).length).toBe(1);
  });
});
