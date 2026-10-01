// apps/web/src/stores/nodeStore.viewer.spec.ts
// 批2-2 VIEWER 第二层（UX 预检）——ns 内容写收口 wrapper（applyNodeDataPatch）+ nodeStore 桥改走 action：
// 判据（spec canEdit 门组三类入口之 AI 状态落地 + VIEWER 组 toast 节流）：
//   ①canEdit 假（readOnly/pending）→ 早退：ns 零变更 + cs 零变更（被拒时 store 从未变更——无"先改后回弹"）
//   ②toast 节流：同一节点 2s 内不重复弹；异节点不共享节流窗；2s 窗过后恢复弹
//   ③canEdit 真 → 等价现 setState 行为（data merge 保留既有键）+ 白名单键桥接 cs（fileId/status）
//   ④setFileResult（AI 落地路径——原 nodeStore:243 桥直灌）readOnly 时 fileId/status 不写入 store
//     （拒本地写非丢数据：服务端产物经 doc exec map 投影照旧可见——批1-6 双源）
//   ⑤setFileResult rw 等价旧行为（ns fileId/status done + cs 桥）
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { message } from 'antd';
import { useNodeStore, _resetViewerToastForTest } from './nodeStore';
import { useCanvasStore } from './canvasStore';

/** 会话电平：ready+readOnly（VIEWER）/ ready+read-write（编辑者） */
const readOnlySession = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: true, wsAuthNotice: null });
const readWriteSession = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });

const seedNode = () => {
  useNodeStore.getState().addNode({ id: 'n1', type: 'imageGen', data: { model: 'm0', status: 'idle' } as any });
  useCanvasStore.setState((s) => ({
    nodes: [...s.nodes.filter((n: any) => n.id !== 'n1'), { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
  }));
};

const nsData = () => useNodeStore.getState().nodes.n1?.data as any;
const csNode = () => useCanvasStore.getState().nodes.find((n: any) => n.id === 'n1') as any;

describe('批2-2 第二层：applyNodeDataPatch（ns 内容写收口 wrapper）', () => {
  let warnSpy: MockInstance<typeof message.warning>;
  beforeEach(() => {
    useNodeStore.setState({ nodes: {}, execStatus: new Map(), execAligned: new Map() });
    useCanvasStore.setState({ nodes: [], edges: [] });
    readOnlySession();
    seedNode();
    _resetViewerToastForTest();
    warnSpy = vi.spyOn(message, 'warning');
  });
  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('①readOnly：早退——ns 零变更 + cs 零变更 + toast 提示一次', () => {
    const nsBefore = useNodeStore.getState().nodes;
    const csBefore = useCanvasStore.getState().nodes;
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'm9' });
    expect(nsData().model).toBe('m0');                      // ns 零变更
    expect(useNodeStore.getState().nodes).toBe(nsBefore);   // 无 set（引用不变——严格零变更）
    expect(useCanvasStore.getState().nodes).toBe(csBefore); // cs 零变更
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('①hydration 非 ready（pending 会话建立窗口）同拒——canEdit 合取判据', () => {
    useCanvasStore.setState({ hydration: 'pending', collabReadOnly: false });
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'm9' });
    expect(nsData().model).toBe('m0');
  });

  it('②toast 节流：同一节点 2s 内不重复弹；2s 窗过后恢复弹（fake timers）', () => {
    vi.useFakeTimers();
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'a' });
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'b' });
    expect(warnSpy).toHaveBeenCalledTimes(1);               // 2s 内第二次被节流
    vi.advanceTimersByTime(2_000);
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'c' });
    expect(warnSpy).toHaveBeenCalledTimes(2);               // 窗过后恢复
  });

  it('②toast 节流：异节点不共享节流窗', () => {
    useNodeStore.getState().addNode({ id: 'n2', type: 'imageGen', data: { status: 'idle' } as any });
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'a' });
    useNodeStore.getState().applyNodeDataPatch('n2', { model: 'b' });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('③rw 等价现 setState 行为：merge 保留既有键 + 白名单键（fileId/status）桥接 cs', () => {
    readWriteSession();
    useNodeStore.getState().applyNodeDataPatch('n1', { fileId: 'f-1', status: 'done' });
    expect(nsData().fileId).toBe('f-1');
    expect(nsData().status).toBe('done');
    expect(nsData().model).toBe('m0');                      // 既有键保留（等价 {...data, ...patch}）
    expect((csNode().data as any).fileId).toBe('f-1');      // 桥白名单键
    expect((csNode().data as any).status).toBe('done');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('③rw 非白名单键不桥接 cs（防高频重渲染——桥白名单语义不变）', () => {
    readWriteSession();
    useNodeStore.getState().applyNodeDataPatch('n1', { model: 'm9' });
    expect(nsData().model).toBe('m9');
    expect((csNode().data as any).model).toBeUndefined();   // model 不在 CANVAS_BRIDGE_KEYS
  });

  it('③rw mediaUrl 不桥接 cs（R2b-6 写入面清零——F37：presigned URL 不得经桥镜像持久化）', () => {
    readWriteSession();
    useNodeStore.getState().applyNodeDataPatch('n1', { mediaUrl: 'http://stale/presigned' });
    expect((csNode().data as any).mediaUrl).toBeUndefined(); // 已从 CANVAS_BRIDGE_KEYS 移除
  });

  it('④setFileResult（AI 落地）readOnly：fileId/status 不写入 ns 也不桥接 cs（拒本地写非丢数据）', () => {
    const nsBefore = useNodeStore.getState().nodes;
    useNodeStore.getState().setFileResult('n1', 'file-9');
    expect(nsData().fileId).toBeUndefined();
    expect(nsData().status).toBe('idle');
    expect(useNodeStore.getState().nodes).toBe(nsBefore);
    expect((csNode().data as any).fileId).toBeUndefined();
  });

  it('⑤setFileResult rw 等价旧行为：ns fileId+status done + cs 桥', () => {
    readWriteSession();
    useNodeStore.getState().setFileResult('n1', 'file-9');
    expect(nsData().fileId).toBe('file-9');
    expect(nsData().status).toBe('done');
    expect((csNode().data as any).fileId).toBe('file-9');
    expect((csNode().data as any).status).toBe('done');
  });

  it('④readOnly 幽灵节点不抛（门先行早退——既有 no-throw 契约保持）', () => {
    expect(() => useNodeStore.getState().setFileResult('ghost', 'f')).not.toThrow();
  });
});
