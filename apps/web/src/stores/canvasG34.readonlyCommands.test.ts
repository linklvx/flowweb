// apps/web/src/stores/canvasG34.readonlyCommands.test.ts
// T17 红测（G34 VIEWER 矩阵·spec §3.3）：canEditCommand 单源门+七命令补门——viewer 会话
// （ready∧readOnly）提交七命令 → 零 cs/doc/DB 写（漏门即红）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { message } from 'antd';
import { useCanvasStore } from './canvasStore';
import { useNodeStore } from './nodeStore';
import { _setIntentDocForTest, dispatchCanvasIntent } from './canvasIntents';
import { canEditCommand, EDITABLE_COMMAND_NAMES, isActiveViewerSession } from './syncStatus';
import type { CanvasState } from './canvasStore';

const viewerSession = (over: Partial<CanvasState> = {}) =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: true, wsAuthNotice: null, ...over } as any);
const editorSession = () =>
  useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null } as any);

const fakeState = (over: Partial<CanvasState>): CanvasState =>
  ({ hydration: 'idle', collabReadOnly: true, wsAuthNotice: null, ...over } as CanvasState);

describe('canEditCommand 单源裁决（G34）', () => {
  it('七命令实名清单=CanvasIntent 七型', () => {
    expect([...EDITABLE_COMMAND_NAMES]).toEqual([
      'addNode', 'updateNodeData', 'deleteNode', 'moveNode', 'updateNodeEnvelope', 'upsertEdge', 'deleteEdge',
    ]);
  });
  it('viewer 会话（ready∧readOnly / ready∧terminal）：七命令全拒', () => {
    for (const cmd of EDITABLE_COMMAND_NAMES) {
      expect(canEditCommand(cmd, fakeState({ hydration: 'ready', collabReadOnly: true }))).toBe(false);
      expect(canEditCommand(cmd, fakeState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: { reason: 'x', terminal: true } }))).toBe(false);
    }
  });
  it('编辑者/非会话态：七命令放行（doc 面另由 canEdit 会话门拦——本谓词只裁角色）', () => {
    for (const cmd of EDITABLE_COMMAND_NAMES) {
      expect(canEditCommand(cmd, fakeState({ hydration: 'ready', collabReadOnly: false }))).toBe(true);
      expect(canEditCommand(cmd, fakeState({ hydration: 'idle' }))).toBe(true);
    }
    expect(isActiveViewerSession(fakeState({ hydration: 'ready', collabReadOnly: false }))).toBe(false);
  });
});

describe('G34 viewer 零写矩阵（七命令补门）', () => {
  let doc: Y.Doc;
  beforeEach(() => {
    doc = new Y.Doc();
    _setIntentDocForTest(doc);
    useCanvasStore.setState({ nodes: [], edges: [], selectedId: null } as any);
    useNodeStore.setState({ nodes: {} } as any);
  });
  afterEach(() => {
    _setIntentDocForTest(null);
    vi.restoreAllMocks();
  });

  const snap = () => JSON.stringify({
    nodes: useCanvasStore.getState().nodes.map((n) => [n.id, n.parentId, JSON.stringify(n.position), n.width, n.height, JSON.stringify((n.data as any).slot ?? null)]),
    edges: useCanvasStore.getState().edges.map((e) => [e.id, e.source, e.target]),
  });

  it('viewer：addNode/deleteNode/addEdge/removeEdge/onConnect → cs/doc 双零写（漏门即红）', () => {
    viewerSession();
    const before = snap();
    const beforeDoc = Y.encodeStateAsUpdate(doc);
    expect(useCanvasStore.getState().addNode('image', { x: 0, y: 0 })).toBe('');
    useCanvasStore.getState().deleteNode('any');
    useCanvasStore.getState().removeEdge('any');
    useCanvasStore.getState().onConnect({ source: 'a', target: 'b' } as any);
    expect(snap()).toBe(before);                                   // cs 零写
    expect(Buffer.from(Y.encodeStateAsUpdate(doc))).toEqual(Buffer.from(beforeDoc)); // doc 零写
  });

  it('viewer：dispatchCanvasIntent 七命令各型 → doc 零写（单源门挂总口）', () => {
    viewerSession();
    const beforeDoc = Y.encodeStateAsUpdate(doc);
    for (const intent of [
      { type: 'addNode', node: { id: 'x', type: 'imageGen', position: { x: 0, y: 0 }, data: {} } },
      { type: 'updateNodeData', id: 'x', patch: { prompt: 'p' } },
      { type: 'deleteNode', id: 'x' },
      { type: 'moveNode', id: 'x', position: { x: 1, y: 1 } },
      { type: 'updateNodeEnvelope', id: 'x', patch: { width: 10 } },
      { type: 'upsertEdge', edge: { id: 'e', source: 'a', target: 'b' } },
      { type: 'deleteEdge', id: 'e' },
    ] as any[]) {
      dispatchCanvasIntent(intent, 'local-user');
    }
    expect(Buffer.from(Y.encodeStateAsUpdate(doc))).toEqual(Buffer.from(beforeDoc));
  });

  it('编辑者：addNode 放行（补门不误伤——rw 会话照常建点）', () => {
    editorSession();
    const id = useCanvasStore.getState().addNode('image', { x: 5, y: 5 });
    expect(id).not.toBe('');
    expect(useCanvasStore.getState().nodes.some((n: any) => n.id === id)).toBe(true);
  });
});
