// apps/web/src/stores/canvasStore.async-landing.spec.ts
// 批2-3 R20 异步落地：canEdit 假（断连/只读/未水合）时生成回调 addChildNode(s) 静默丢弃
// （返回 null/[]，节点/边零加入——无"先改后回弹"）+ toast「生成完成，但画布会话不可用，
// 未插入画布——可从素材库手动插入」；canEdit 真时正常加（回归锚）。
// 产物已落素材库（presign/confirm 先于本回调）——丢弃的仅是"插入画布"这一步，可手动补。
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import * as Y from 'yjs';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { _setIntentDocForTest } from './canvasIntents';

/** 会话电平：默认 idle+readonly（无会话）/ pending+rw（未水合窗口）/ ready+rw（编辑者） */
const noSession = () =>
  useCanvasStore.setState({ hydration: 'idle', collabReadOnly: true, wsAuthNotice: null });
const pendingSession = () =>
  useCanvasStore.setState({ hydration: 'pending', collabReadOnly: false, wsAuthNotice: null });
const readWriteSession = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });

const seedSource = () => {
  useCanvasStore.setState((s) => ({
    nodes: [...s.nodes.filter((n: any) => n.id !== 'src1'), { id: 'src1', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } as any],
    edges: s.edges.filter((e: any) => e.source !== 'src1' && e.target !== 'src1'),
  }));
};

describe('批2-3 R20：生成回调异步落地 canEdit 门（addChildNode/addChildNodes）', () => {
  let warnSpy: MockInstance<typeof message.warning>;
  beforeEach(() => {
    useNodeStore.setState({ nodes: {} });
    useCanvasStore.setState({ nodes: [], edges: [] });
    noSession();
    seedSource();
    warnSpy = vi.spyOn(message, 'warning');
  });
  afterEach(() => {
    warnSpy.mockRestore();
    _setIntentDocForTest(null);
  });

  it('canEdit 假（无会话）：addChildNode 静默 null——节点/边零加入 + toast 指引素材库', () => {
    const ret = useCanvasStore.getState().addChildNode('src1', { fileId: 'f1', status: 'done' });
    expect(ret).toBeNull();
    expect(useCanvasStore.getState().nodes).toHaveLength(1); // 仅种子源节点
    expect(useCanvasStore.getState().edges).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('生成完成，但画布会话不可用，未插入画布——可从素材库手动插入');
  });

  it('canEdit 假（未水合 pending 窗口）：同拒——canEdit 合取判据', () => {
    pendingSession();
    const ret = useCanvasStore.getState().addChildNode('src1', { fileId: 'f1', status: 'done' });
    expect(ret).toBeNull();
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });

  it('canEdit 假：addChildNodes 静默 []——零节点零边 + toast 一次（批量单弹）', () => {
    const ret = useCanvasStore.getState().addChildNodes('src1', [
      { data: { fileId: 'f1', status: 'done' }, gridRow: 0, gridCol: 0 },
      { data: { fileId: 'f2', status: 'done' }, gridRow: 0, gridCol: 1 },
    ]);
    expect(ret).toEqual([]);
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
    expect(useCanvasStore.getState().edges).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('canEdit 真（回归锚）：addChildNode 正常加节点+边并返回 id', () => {
    readWriteSession();
    // O0b-2 exists 收口：dispatch 恒成功⇒投影恒 append（append 回退分支删除）——canEdit 真=完整
    // 漏斗可用，测试装置补 doc（生产 rw 会话 doc 恒在；doc 缺席=canEdit 假语义域，上方用例覆盖）
    _setIntentDocForTest(new Y.Doc());
    const ret = useCanvasStore.getState().addChildNode('src1', { fileId: 'f1', status: 'done' });
    expect(typeof ret).toBe('string');
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === ret)).toBeDefined();
    expect(useCanvasStore.getState().edges).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('canEdit 真（回归锚）：addChildNodes 正常加并返回 id 列表', () => {
    readWriteSession();
    _setIntentDocForTest(new Y.Doc());   // 同上——exists 收口后投影恒 append 的会话前提
    const ret = useCanvasStore.getState().addChildNodes('src1', [
      { data: { fileId: 'f1', status: 'done' }, gridRow: 0, gridCol: 0 },
    ]);
    expect(ret).toHaveLength(1);
    expect(useCanvasStore.getState().nodes.find((n: any) => n.id === ret[0])).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
