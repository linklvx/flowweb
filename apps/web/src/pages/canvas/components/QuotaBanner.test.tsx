// apps/web/src/pages/canvas/components/QuotaBanner.test.tsx
// Y0b-4 T11：配额三级横幅——软阈通告（非阻断+瘦身入口）/硬阈常驻（双主按钮）/4404·4410 终态档
// （4410=重建横幅无按钮；4404=硬阈+「重新连接」唯一复位动作）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { message } from 'antd';
import { QuotaBanner } from './QuotaBanner';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/api/collabApi', () => ({ exportFresh: vi.fn() }));
vi.mock('./ShrinkDialog', () => ({
  ShrinkDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="shrink-dialog-stub" /> : null),
}));
// location.reload jsdom [Unforgeable] 不可 spy——stubGlobal 整体替换（t9.spec 先例）
const reloadSpy = vi.fn();

const reset = () => useCanvasStore.setState({
  quotaOver: false, quotaLimitBytes: 0, quotaTxBytes: 0, quotaSoftLimitBytes: 0,
  quotaResidueBytes: undefined, localDocBytes: 0, localDelta: 0, wsQuotaTerminal: null,
  collabEscapePending: false,
});

beforeEach(() => {
  reset();
  reloadSpy.mockClear();
  vi.stubGlobal('location', { reload: reloadSpy });
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  reset();
});

describe('QuotaBanner 三级分档（T11）', () => {
  it('清态（quotaOver=false 无终态）→不渲染', () => {
    const { container } = render(<QuotaBanner projectId="p1" />);
    expect(container.querySelector('[data-testid="collab-quota-banner"]')).toBeNull();
  });

  it('软阈通告：quotaOver∧bytes<limit→黄档非阻断「接近容量上限」+「瘦身」入口（开 ShrinkDialog）', () => {
    useCanvasStore.setState({
      quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886, localDocBytes: 5_000,
    });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/接近容量上限/)).toBeInTheDocument();
    expect(screen.queryByTestId('quota-export-btn')).not.toBeInTheDocument();   // 软阈无双主按钮
    fireEvent.click(screen.getByTestId('quota-shrink-btn'));
    expect(screen.getByTestId('shrink-dialog-stub')).toBeInTheDocument();
  });

  it('软阈文案动态容量：quotaSoftLimitBytes 下发值驱动（约 6.4MB——1024 基与配额常量同口径）', () => {
    useCanvasStore.setState({
      quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886, localDocBytes: 6_800_000,
    });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/6\.4MB/)).toBeInTheDocument();
  });

  it('硬阈常驻：quotaOver∧bytes≥limit→红档+双主按钮「一键瘦身」「导出到新项目」（exportFresh 调用）', async () => {
    const { exportFresh } = await import('@/api/collabApi');
    (exportFresh as any).mockResolvedValue({ result: 'ok', projectId: 'np', name: '副本', bytes: 1_000 });
    const successSpy = vi.spyOn(message, 'success');
    useCanvasStore.setState({
      quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886, localDocBytes: 9_000_000,
    });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/已超出容量上限/)).toBeInTheDocument();
    expect(screen.getByTestId('quota-shrink-btn').textContent).toContain('一键瘦身');
    fireEvent.click(screen.getByTestId('quota-export-btn'));
    await vi.waitFor(() => expect(exportFresh).toHaveBeenCalledWith('p1'));
    expect(successSpy).toHaveBeenCalled();
  });

  it('4404 终态档：wsQuotaTerminal→横幅常驻+双主按钮+「重新连接」（location.reload——终态后唯一复位路径）', () => {
    useCanvasStore.setState({
      quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886, localDocBytes: 9_000_000,
      wsQuotaTerminal: { code: 4404, reason: 'doc-over-quota' },
    });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/已超出容量上限/)).toBeInTheDocument();
    expect(screen.getByTestId('quota-shrink-btn')).toBeInTheDocument();
    expect(screen.getByTestId('quota-export-btn')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quota-reconnect-btn'));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('4410 终态档（doc-vacuuming/doc-generation-stale）→「正在重建画布历史，即将自动刷新」无动作按钮', () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4410, reason: 'doc-vacuuming' } });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/正在重建画布历史，即将自动刷新/)).toBeInTheDocument();
    expect(screen.queryByTestId('quota-shrink-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-export-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quota-reconnect-btn')).not.toBeInTheDocument();
    // 同族 doc-generation-stale 同档（reload 后空 SV 放行——不循环）
    cleanup();
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4410, reason: 'doc-generation-stale' } });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/正在重建画布历史，即将自动刷新/)).toBeInTheDocument();
  });

  it('4410 终态优先于硬阈横幅（vacuum 代际通告压过超限文案——单横幅不叠层）', () => {
    useCanvasStore.setState({
      quotaOver: true, quotaLimitBytes: 8_388_608, quotaSoftLimitBytes: 6_710_886, localDocBytes: 9_000_000,
      wsQuotaTerminal: { code: 4410, reason: 'doc-vacuuming' },
    });
    render(<QuotaBanner projectId="p1" />);
    expect(screen.getByText(/正在重建画布历史/)).toBeInTheDocument();
    expect(screen.queryByText(/已超出容量上限/)).not.toBeInTheDocument();
  });

  it('T6 质量修复 C1：vacuuming 档 escape 分叉压盖——collabEscapePending 真（safeReload 被 dirty 分叉）→让位 SyncBanner escape 档，「即将自动刷新」假承诺不同屏', () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4410, reason: 'doc-vacuuming' }, collabEscapePending: true });
    const { container } = render(<QuotaBanner projectId="p1" />);
    expect(container.querySelector('[data-testid="collab-quota-banner"]')).toBeNull();
  });
});
