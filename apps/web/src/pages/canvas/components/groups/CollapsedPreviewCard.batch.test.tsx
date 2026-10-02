// CollapsedPreviewCard.batch.test.tsx（2d-4 折叠卡批量预取单飞）
// 与 CollapsedPreviewCard.test.tsx 的差异：不 mock useMediaUrl——真实 hook+mediaUrlCache 栈，
// 仅路由 mock apiFetch（/media/batch 与 /media/{id}/url 双端点），断言网络请求次数这一 spec §5 验收行。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CollapsedPreviewCard } from './CollapsedPreviewCard';
import { __setUserIdForTests, __resetMediaCacheForTests } from '@/utils/mediaUrlCache';
import { apiFetch } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

const cell = (id: string, fileId?: string) => ({ nodeId: id, fileId });
const SIX_CELLS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((f, i) => cell(`n${i}`, f));

const batchRow = (id: string) => ({
  id, originalName: id, mimeType: 'image/png', size: 1,
  url: `http://minio:9000/flowai/${id}`, thumbnailUrl: null, metadata: {}, ttlSec: 3600,
});

// 批量端点挂起（测试内 resolveBatch 放行）；单取端点即时成功——请求次数可精确计数
let resolveBatch!: () => void;
function routeBatchDeferred() {
  (apiFetch as any).mockImplementation((path: string, opts?: { body?: string }) => {
    if (path.startsWith('/media/batch')) {
      const ids = JSON.parse(opts?.body ?? '{}').ids as string[];
      return new Promise<ReturnType<typeof batchRow>[]>((resolve) => { resolveBatch = () => resolve(ids.map(batchRow)); });
    }
    const m = path.match(/^\/media\/(.+)\/url$/)!;
    return Promise.resolve({ url: `http://minio:9000/flowai/${m[1]}`, ttlSec: 3600 });
  });
}
const calls = (): string[] => (apiFetch as any).mock.calls.map((c: any[]) => c[0] as string);

beforeEach(() => {
  vi.clearAllMocks();
  __resetMediaCacheForTests();
  __setUserIdForTests('user-batch');
});

describe('折叠卡批量预取（三口径+两段渲染单飞）', () => {
  it('6 tile 同挂载 → 恰 1 次网络请求（spec §5 验收行"≤1 次 batch 请求"）——两段渲染：首渲染图标占位，卡片 effect 内 registerInFlight 完成后 setState 再挂 tile，tile 的 useMediaUrl 挂载时 pending 已就绪命中共享单 promise（StrictMode 双跑幂等位拦截 → ≤1 batch）', async () => {
    routeBatchDeferred();
    render(<StrictMode><CollapsedPreviewCard name="组" teamId="t1" cells={SIX_CELLS} /></StrictMode>);
    // phase1：batch 在飞——全占位无 img（useMediaUrl tile 未出图）
    expect(screen.getAllByTestId('collapsed-tile-placeholder')).toHaveLength(6);
    expect(screen.queryByTestId('collapsed-tile-img')).toBeNull();
    await act(async () => { resolveBatch(); });
    await waitFor(() => expect(screen.getAllByTestId('collapsed-tile-img')).toHaveLength(6));
    expect(calls()).toHaveLength(1);                 // 恰 1 次——零单取
    expect(calls()[0]).toBe('/media/batch?teamId=t1');
  });

  it('必须显式传 teamId（canvasStore 字段——经 prop 显式下行进 batch 查询串）；batch 失败不阻塞（tile 回落单取出图）', async () => {
    // 半场1：teamId 显式透传（成功路径锁查询串形态）
    routeBatchDeferred();
    const { unmount } = render(<CollapsedPreviewCard name="组" teamId="t9" cells={[cell('a', 'f1')]} />);
    await act(async () => { resolveBatch(); });
    await waitFor(() => expect(screen.getByTestId('collapsed-tile-img')).toBeTruthy());
    expect(calls()[0]).toBe('/media/batch?teamId=t9');
    unmount();
    __resetMediaCacheForTests();
    vi.clearAllMocks();
    // 半场2：batch 拒绝 → settle 后 ready，tile 挂载逐一单取（fallback 不被 batch 失败阻塞）
    (apiFetch as any).mockImplementation((path: string) => {
      if (path.startsWith('/media/batch')) return Promise.reject(new Error('batch boom'));
      const m = path.match(/^\/media\/(.+)\/url$/)!;
      return Promise.resolve({ url: `http://minio:9000/flowai/${m[1]}`, ttlSec: 3600 });
    });
    render(<CollapsedPreviewCard name="组" teamId="t9" cells={[cell('b', 'f2'), cell('c', 'f3')]} />);
    await waitFor(() => expect(screen.getAllByTestId('collapsed-tile-img')).toHaveLength(2));
    const batchCalls = calls().filter((p) => p.startsWith('/media/batch'));
    const singleCalls = calls().filter((p) => /^\/media\/.+\/url$/.test(p));
    expect(batchCalls).toHaveLength(1);
    expect(singleCalls).toHaveLength(2);             // 2 tile 各自单取
  });
});
