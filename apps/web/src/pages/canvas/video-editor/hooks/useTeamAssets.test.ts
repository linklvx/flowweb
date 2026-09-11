import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react'; // R5：act 支撑 teamId 后置写入用例

const { getFiles } = vi.hoisted(() => ({ getFiles: vi.fn() })); // vi.mock 工厂提升后引用外部句柄须经 vi.hoisted（PreviewPlayer.ai.test 同款）
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => getFiles(...a) } }));

import { useTeamAssets } from './useTeamAssets';

/** 响应实形（执行核实点）：TransformInterceptor 全局包 {code,data,message} → res.data.data = {success,data:files}
 *  （materialLibraryStore.loadFiles 双层 data 消费同款） */
const ok = (data: unknown[]) => ({ data: { code: 0, message: 'ok', data: { success: true, data } } });

beforeEach(() => { getFiles.mockReset(); });

describe('useTeamAssets（团队素材库实化——spec §4 左面板"全集资产 = 画布产物 + 团队素材库"）', () => {
  it('GET /api/material/files（无 folderId 全量）→ 过滤 video/audio/image mimeType → mediaId 条目', async () => {
    getFiles.mockResolvedValue(ok([
      { id: 'mv1', originalName: 'a.mp4', mimeType: 'video/mp4', url: 'https://minio/flowai/a', thumbnailUrl: null },
      { id: 'ma1', originalName: 'b.mp3', mimeType: 'audio/mpeg', url: 'https://minio/flowai/b' },
      { id: 'mi1', originalName: 'c.png', mimeType: 'image/png', url: 'https://minio/flowai/c' },
      { id: 'mx1', originalName: 'd.pdf', mimeType: 'application/pdf', url: 'https://minio/flowai/d' },
    ]));
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.mediaId)).toEqual(['mv1', 'ma1', 'mi1']); // pdf 剔除
    expect(result.current.items[0].url).toContain('/flowai/a');
  });
  it('接口失败 → 空列表不抛错', async () => {
    getFiles.mockRejectedValue(new Error('net'));
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });
  it('editorStore.teamId 非空 → 请求带 teamId query（R4-9：画布团队对齐，material files 回落默认团队）', async () => {
    getFiles.mockResolvedValue(ok([]));
    const { useEditorStore } = await import('../store/editorStore');
    useEditorStore.setState({ teamId: 'team-9' } as never);
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getFiles).toHaveBeenCalledWith('/api/material/files?teamId=team-9');
    useEditorStore.setState({ teamId: null } as never); // 清理——不污染其它用例
  });
  it('R5-P1-5：挂载时 teamId 为 null（loadProject 未回）→ 先默认团队；teamId 到达后自动重拉带 query', async () => {
    getFiles.mockResolvedValue(ok([]));
    const { useEditorStore } = await import('../store/editorStore');
    useEditorStore.setState({ teamId: null } as never);
    const { result } = renderHook(() => useTeamAssets());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getFiles).toHaveBeenLastCalledWith('/api/material/files'); // 首次：默认团队
    act(() => useEditorStore.setState({ teamId: 'team-9' } as never)); // loadProject 异步回写（真实时序）
    await waitFor(() => expect(getFiles).toHaveBeenLastCalledWith('/api/material/files?teamId=team-9'));
    useEditorStore.setState({ teamId: null } as never); // 清理
  });
});
