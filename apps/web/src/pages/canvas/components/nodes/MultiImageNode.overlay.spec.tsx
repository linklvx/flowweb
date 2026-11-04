// apps/web/src/pages/canvas/components/nodes/MultiImageNode.overlay.spec.tsx
// Y1c T32（T22 G5 末轮收口——卡文第二 checkbox 前置）：MultiImageNode overlay 反应性红→绿锚。
// 修前形态（G5 登记）：selector 集仅 nodeStore 五 selector，runtimeMediaIdOf 为非响应直读——
// feed exec.artifact 投影落 runtimeStore→nodeStore.execStatus（projectRuntimeExecToNodeStore 整替）
// 不触发重渲染 ⇒ stacked 主图 overlay 不刷新（红基线：投影到达后 img src 仍为 images fallback）。
// 修后=selectExecEntry 订阅补位（与 AudioGen/ImageGen/VideoGen 族同形——投影变化触发重渲染，
// runtimeMediaIdOf 直读随之重求值）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MultiImageNode } from './MultiImageNode';
import { ReactFlowProvider } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { resetRuntimeFeed, useRuntimeFeedStore } from '@/stores/runtimeStore';

// useMediaUrl 载荷捕获（overlay 优先级断言面——真 src 由 <img> 回显）
const useMediaUrlArgs: Array<string | null | undefined> = [];
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null | undefined) => {
    useMediaUrlArgs.push(fileId);
    return fileId
      ? { url: `http://media/${fileId}`, loading: false, error: null, onError: vi.fn() }
      : { url: null, loading: false, error: null, onError: vi.fn() };
  },
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, useStore: (selector: any) => selector({ nodes: [{ id: 'mimg1', selected: true } as any] }) };
});

/** 真投影注入（生产写径同构——feed reducer 合并后 projectRuntimeExecToNodeStore 整替 nodeStore.execStatus）。 */
function projectArtifact(mediaId?: string): void {
  useRuntimeFeedStore.setState({
    projectId: 'test-project',
    cursor: { historyId: 'h', generation: 0, feedSeq: '2' },
    projection: {
      projectId: 'test-project', generation: 0, feedSeq: '2', pgSeq: '0',
      nodes: mediaId ? { mimg1: { artifact: { mediaId, artifactRev: 1, nodeVersion: '2' } } } : {},
    },
    fetchedAtMs: Date.now(),
  });
  const m = new Map(useNodeStore.getState().execStatus);
  if (mediaId) m.set('mimg1', { status: 'done', fileId: mediaId });
  else m.delete('mimg1');
  useNodeStore.setState({ execStatus: m });
}

const renderNode = () => render(
  <ReactFlowProvider>
    <MultiImageNode id="mimg1" data={{}} selected={false} type="multiImageGen" draggable={true} dragging={false} selectable={true} deletable={true} zIndex={0} {...{} as any} />
  </ReactFlowProvider>,
);

describe('Y1c T32：MultiImageNode overlay 反应性（G5 末轮收口——投影订阅补位）', () => {
  afterEach(() => {
    useMediaUrlArgs.length = 0;
    resetRuntimeFeed();
    useNodeStore.setState({
      nodes: {},
      execStatus: new Map(),
    });
  });

  it('红→绿：feed exec.artifact 投影到达（execStatus 条目 fileId=artifact.mediaId）→ stacked 主图重渲染为 overlay 值', () => {
    useNodeStore.setState({
      nodes: { mimg1: { id: 'mimg1', type: 'multiImageGen', data: { images: [{ id: 'img-user', url: 'u', name: 'a', status: 'success' }], mainImageIndex: 0, expanded: false } as any } },
      execStatus: new Map(),
    });
    projectArtifact(undefined);
    const { unmount } = renderNode();
    // 无投影：主图=用户上传 images fallback（非展开态 stacked 主图）
    expect(useMediaUrlArgs).toContain('img-user');
    // feed exec.artifact 到达（投影落 runtimeStore+nodeStore.execStatus——projectRuntimeExecToNodeStore 同构）
    act(() => { projectArtifact('m-overlay'); });
    expect(useMediaUrlArgs).toContain('m-overlay');   // 修前红：订阅缺失→不重渲染→读径不重求值
    unmount();
  });

  it('投影清空（换代全量重建前窗）→ 主图回落 images fallback', () => {
    useNodeStore.setState({
      nodes: { mimg1: { id: 'mimg1', type: 'multiImageGen', data: { images: [{ id: 'img-user', url: 'u', name: 'a', status: 'success' }], mainImageIndex: 0, expanded: false } as any } },
      execStatus: new Map(),
    });
    projectArtifact('m-overlay');
    const { unmount } = renderNode();
    expect(useMediaUrlArgs).toContain('m-overlay');
    act(() => { projectArtifact(undefined); });
    expect(useMediaUrlArgs[useMediaUrlArgs.length - 1]).toBe('img-user');   // 回落（投影移除语义）
    unmount();
  });
});
