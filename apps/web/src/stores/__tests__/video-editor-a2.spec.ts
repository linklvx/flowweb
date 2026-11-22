// apps/web/src/stores/__tests__/video-editor-a2.spec.ts
// Y4b Task 3：A2 零放大测试锚（spec 条 9 A2 终裁=零放大登记）。
// census 实证（page.tsx:396 VideoEditorShell 同窗挂载）：编辑器 Modal 与画布协作会话
// 同 WS 同 doc——本锚钉死「开编辑器不增会话不换 doc」：
//   - 会话判据=FakeHocuspocusProvider.instances.length（构造计数——放大即新建 provider）；
//   - doc 判据=getTimelineDocRef()（runtime initCollab setTimelineDocRef 挂接，canvasCollabRuntime.ts:2076）
//     与 runtime.getDoc()（:107 导出）同源核对——openEditor/loadProject 前后同引用。
// 夹具=conn.spec 先例（canvasCollabRuntime.conn.spec.ts）：vi.mock('@hocuspocus/provider')→
// FakeHocuspocusProvider + 真事件序驱动 runtime 就绪（connected 双发→authenticated→synced）。
// 单 client 即可——双端协作形态留给 Task 12。预期纯锚即绿（现状零放大 census 实证）；
// 若红=真放大缺陷→BLOCKED 呈报，禁改产品码。
// timelines 水合前置（裁定附录⑥）：runtime doc 物化 set('edit1', seedEmptyTimeline('edit1'))
// 〔禁空 Y.Map——readTimelineFromDoc 返 null，loadProject :268 早退〕。
// 生产接线口径（VideoEditorShell.tsx:56-62）：open → reset + loading → loadProject(sourceNodeId)；
// 关闭效应 cleanup=reset。本锚同序直调 store 面（openEditor→reset→loadProject）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { seedEmptyTimeline } from '@flowweb/shared';
import { useCanvasStore } from '../canvasStore';
import * as runtime from '../canvasCollabRuntime';
import { getTimelineDocRef } from '../timelineUndo';
import { useVideoEditorStore } from '../videoEditorStore';
import { useEditorStore } from '@/pages/canvas/video-editor/store/editorStore';

vi.mock('@hocuspocus/provider', async () => {
  const { FakeHocuspocusProvider } = await import('@/test/fixtures/fakeHocuspocusProvider');
  return { HocuspocusProvider: FakeHocuspocusProvider };
});

const lastInstance = () => (HocuspocusProvider as any).instances.at(-1) as any;
/** 一个 macrotask——flush initCollab 入口 destroyCollab 的微任务链（provider 构造完成） */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** 启动会话并取到已构造的 provider 实例（conn.spec 先例同款） */
async function beginCollab(pid: string): Promise<{ done: Promise<void>; p: any }> {
  const done = runtime.initCollab(pid);
  await tick();
  return { done, p: lastInstance() };
}

/** 完整健康序（conn.spec 先例同款）：connected 双发 → authenticated → synced */
async function driveToSynced(pid = 'p1') {
  const { done, p } = await beginCollab(pid);
  p.emit('status', { status: 'connected' });   // 双发第一发（onOpen）
  p.emit('status', { status: 'connected' });   // 双发第二发（resolveConnectionAttempt）
  p.isAuthenticated = true;
  p.emit('authenticated', { scope: 'read-write' });
  p.isSynced = true;
  p.emit('synced', {});
  await done;
  return p;
}

/** 编辑器打开全序（VideoEditorShell :56-60 同产线时序）：openEditor → reset+loading → loadProject */
function openEditorFull(nodeId: string) {
  useVideoEditorStore.getState().openEditor(nodeId);
  useEditorStore.getState().reset();
  useEditorStore.setState({ status: 'loading' });
  return useEditorStore.getState().loadProject(nodeId);
}

describe('A2 零放大锚：开编辑器不增会话不换 doc（纯锚——现状即绿）', () => {
  beforeEach(() => {
    (HocuspocusProvider as any).instances.length = 0;
    useCanvasStore.setState({ connStatus: 'connecting', nodes: [], edges: [], hydration: 'idle' });
  });
  afterEach(async () => {
    useVideoEditorStore.getState().close();
    useEditorStore.getState().reset();
    await runtime.destroyCollab();   // 摘 runtime 会话（undo manager/doc/监听/doc ref 置空），防跨用例泄漏
  });

  it('runtime 就绪 → openEditor+loadProject → 会话数不变+doc 引用不变；close → 再 open 同断言（循环档）', async () => {
    // 画布协作会话就绪（真事件序驱动）
    await driveToSynced('p1');
    const runtimeDoc = runtime.getDoc();
    expect(runtimeDoc).not.toBeNull();
    expect(getTimelineDocRef()).toBe(runtimeDoc);   // 同源前提：runtime doc ref 已挂接
    // timelines 水合前置（裁定附录⑥）：物化 edit1 工程 Map（禁空 Y.Map）
    runtimeDoc!.getMap('timelines').set('edit1', seedEmptyTimeline('edit1'));

    // ── 第一轮：开编辑器 ──
    const sessionCountBefore = (HocuspocusProvider as any).instances.length;
    const docRefBefore = getTimelineDocRef();
    expect(openEditorFull('edit1')).toBe(true);   // 水合成功进 ready
    expect(useEditorStore.getState().status).toBe('ready');
    expect((HocuspocusProvider as any).instances.length).toBe(sessionCountBefore);   // ★不增会话
    expect(getTimelineDocRef()).toBe(docRefBefore);                                  // ★不换 doc
    expect(runtime.getDoc()).toBe(docRefBefore);                                    // runtime 面同源核对

    // ── 循环档：close → 再 open 同两断言 ──
    useVideoEditorStore.getState().close();
    useEditorStore.getState().reset();            // Shell 卸载 cleanup（VideoEditorShell :61 同产线序）
    const sessionCountMid = (HocuspocusProvider as any).instances.length;
    const docRefMid = getTimelineDocRef();
    expect(sessionCountMid).toBe(sessionCountBefore);   // close 亦零会话增减
    expect(openEditorFull('edit1')).toBe(true);
    expect((HocuspocusProvider as any).instances.length).toBe(sessionCountMid);   // ★再开不增会话
    expect(getTimelineDocRef()).toBe(docRefMid);                                  // ★再开不换 doc
    expect(runtime.getDoc()).toBe(docRefMid);                                    // runtime 面同源核对
  });
});
