// apps/web/src/pages/canvas/video-editor/hooks/shadowJob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const statusHandlers = new Set<(p: unknown) => void>();
vi.mock('@/services/executionSocket', () => ({
  subscribeNodeStatus: (h: (p: unknown) => void) => { statusHandlers.add(h); return () => statusHandlers.delete(h); },
}));
const readDoc = vi.fn();
vi.mock('@/stores/canvasCollabRuntime', () => ({ readNodeFileIdFromDoc: (...a: unknown[]) => readDoc(...a) }));
const removeShadowApi = vi.fn();
const batchApi = vi.fn();
vi.mock('@/api/videoProjectApi', () => ({ removeShadowNode: (...a: unknown[]) => removeShadowApi(...a), regenerateNode: vi.fn() }));
vi.mock('@/api/mediaApi', () => ({ batchGetMedia: (...a: unknown[]) => batchApi(...a) }));
vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn() } }));

import { watchShadowJob } from './shadowJob';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';

beforeEach(() => {
  vi.resetModules(); statusHandlers.clear();
  readDoc.mockReset(); removeShadowApi.mockReset(); batchApi.mockReset();
  batchApi.mockResolvedValue([{ id: 'm9', url: 'http://u', originalName: 'a.mp3', mimeType: 'audio/mpeg', metadata: { durationSec: 9 } }]);
  removeShadowApi.mockResolvedValue(undefined);
  // 适配登记：plan 稿 vi.resetModules() 对顶层静态 import 的 store 单例无效——generatedMediaIds 跨用例泄漏
  // （用例 3/4 的 toEqual([]) 恒红）；按 editorStore.test.ts 既有惯例显式 reset()
  useEditorStore.getState().reset();
  useCanvasStore.setState({ projectId: 'wf1' } as never); // R1（P1-7）：不设 projectId 则 finally 不调 removeShadowNode——断言必红
});

describe('watchShadowJob（A1 影子状态机——决策 2 读 doc 判完成）', () => {
  // R6-P1-B：readNodeFileIdFromDoc 是同步函数（string|null）——mock 必须用 mockReturnValue 系；
  // mockResolvedValue 返回 thenable（恒 truthy）会被 if (fid) 当"已命中"，用例 1 假通过、用例 2 必红
  it('doc 已有 fileId（轮询立即命中）：全流程成功（含 mimeType 回填）', async () => {
    readDoc.mockReturnValue('m9');
    const p = watchShadowJob('shadow-audio-1', 'audio', { name: 'x', durationSec: 9 });
    await p;
    const st = useEditorStore.getState();
    expect(readDoc).toHaveBeenCalledWith('shadow-audio-1');
    expect(batchApi).toHaveBeenCalledWith(['m9']);
    expect(st.generatedMediaIds).toContain('m9');
    expect(st.mediaInfo['m9'].url).toBe('http://u');
    expect(st.mediaInfo['m9'].mimeType).toBe('audio/mpeg'); // P1-7：拖拽判轨依据
    expect(removeShadowApi).toHaveBeenCalledWith('wf1', 'shadow-audio-1');
  });

  it('doc 未回写 → 2s 轮询直至出现；期间 done 到达被忽略（R5-P1-4：判完成唯一依据是 doc——fake timers）', async () => {
    vi.useFakeTimers();
    try { // R7-P3：失败路径不污染同文件后续用例（fake timers 必须恢复）
      readDoc.mockReturnValueOnce(null).mockReturnValueOnce(null).mockReturnValueOnce('m8');
      const p = watchShadowJob('shadow-audio-2', 'audio', { name: 'y' });
      // 干扰输入：注入 done 事件——断言它被忽略（轮询仍按 2s 节奏独立推进，不被 done 提前/错结）
      statusHandlers.forEach((h) => h({ nodeId: 'shadow-audio-2', status: 'done' }));
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(2100);
      await p;
      expect(readDoc).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('error 事件 → 失败提示 + removeShadow + 不入生成结果', async () => {
    const p = watchShadowJob('shadow-audio-3', 'audio', { name: 'z' });
    statusHandlers.forEach((h) => h({ nodeId: 'shadow-audio-3', status: 'error', error: '模型超时' }));
    await p;
    expect(removeShadowApi).toHaveBeenCalled();
    expect(useEditorStore.getState().generatedMediaIds).toEqual([]); // R1：原 not.toContain(expect.anything()) 是恒真无效断言
  });

  it('R6-P2-1：initial success=false（regenerate HTTP 已带失败结果）→ 立即失败不进轮询', async () => {
    readDoc.mockReturnValue(null); // 即便 doc 永无 fileId 也不该等到 120s
    const p = watchShadowJob('shadow-audio-4', 'audio', { name: 'w' }, { success: false, errors: ['扣费失败'] });
    await p;
    expect(removeShadowApi).toHaveBeenCalled();
    expect(useEditorStore.getState().generatedMediaIds).toEqual([]);
    expect(readDoc).not.toHaveBeenCalled(); // 未进轮询
  });
});
