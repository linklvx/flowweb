// apps/web/src/pages/canvas/components/SyncBanner.test.tsx
// Y0b-3 T9 Step6：协作横幅分档 UI 测试——四/五/六档终态+瞬态族+write-frozen+connUi 分级
// （优先级：terminal 鉴权 > write-frozen > connUi banner > connUi hint；全清不渲染）。
// Y0b-5 T6：单链仲裁扩测（spec §5.7 v2.2 互斥裁定）——九级优先链+能力位+denylist 面。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { isTerminalReason, SS2_OVER_LIMIT_TERMINAL_REASON } from '@flowweb/shared';
import { SyncBanner } from './SyncBanner';
import { useCanvasStore } from '@/stores/canvasStore';
import { escapeWithLocalExport } from '@/stores/canvasCollabRuntime';

vi.mock('@/stores/canvasCollabRuntime', () => ({
  escapeWithLocalExport: vi.fn(),
  safeReload: vi.fn(),
  getDoc: vi.fn(() => null),
  discardLocalDiverged: vi.fn(),
}));

const reset = () => useCanvasStore.setState({
  connUi: 'ok', wsAuthNotice: null, writeFrozen: false, collabEscapePending: false, readyProbeHint: null,
  wsQuotaTerminal: null, canvasDiverged: false, canvasOversized: false, canvasDegraded: false,
  persistUnhealthy: false, syncLagOver60s: false, localCacheReady: false,
});

beforeEach(reset);
afterEach(cleanup);

describe('SyncBanner 分档（T9 Step6）', () => {
  it('T6 质量修复 C1：版本族终态+逃生 pending→escape 档优先于 version-family 自有分支（「正在自动刷新」是假承诺——reload 已被 dirty 分叉）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'schema-outdated', terminal: true }, collabEscapePending: true });
    render(<SyncBanner />);
    expect(screen.getByText(/有未同步本地编辑，已阻止刷新/)).toBeInTheDocument();
    expect(screen.getByTestId('collab-escape-btn')).toBeInTheDocument();
    expect(screen.queryByText('系统已更新，页面版本过期')).not.toBeInTheDocument();
  });

  it('T6 质量修复 C1：escape 分叉独立高位分支——非 terminal 上下文（重试连接等 8 处 reload 点分叉）横幅可见+导出按钮可点', () => {
    useCanvasStore.setState({ connUi: 'banner', collabEscapePending: true });
    render(<SyncBanner />);
    expect(screen.getByText(/有未同步本地编辑，已阻止刷新——可导出本地副本/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('collab-escape-btn'));
    expect(escapeWithLocalExport).toHaveBeenCalledTimes(1);
  });

  it('T6 质量修复 C1：escape 档位次=配额终态之前（4410 分叉场景——QuotaBanner vacuuming 档同时压盖让位）', () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4410, reason: 'doc-vacuuming' }, collabEscapePending: true });
    render(<SyncBanner />);
    expect(screen.getByTestId('collab-escape-btn')).toBeInTheDocument();
  });

  it('版本族终态未到逃生档→「正在自动刷新…」无按钮', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'client-version-missing', terminal: true } });
    render(<SyncBanner />);
    expect(screen.getByText(/正在自动刷新/)).toBeInTheDocument();
    expect(screen.queryByTestId('collab-escape-btn')).not.toBeInTheDocument();
  });

  it('message-too-big 第六终态档→逃生按钮（与版本逃生同一按钮——内容确定性无 reload 自救）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'message-too-big', terminal: true } });
    render(<SyncBanner />);
    expect(screen.getByText(/超出单帧大小限制/)).toBeInTheDocument();
    expect(screen.getByTestId('collab-escape-btn')).toBeInTheDocument();
  });

  it('会话过期终态→重登链接（/login?next=——loginRedirect 收口）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'session-expired', terminal: true } });
    render(<SyncBanner />);
    const link = screen.getByTestId('collab-relogin-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('/login');
  });

  it('无权/不存在终态→返回工作区行动', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'forbidden', terminal: true } });
    render(<SyncBanner />);
    expect(screen.getByText('无权访问该画布')).toBeInTheDocument();
    expect(screen.getByTestId('collab-back-works-btn')).toBeInTheDocument();
  });

  it('未知终态 reason→通用文案兜底（映射表显式列档缺失时禁白屏）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'some-future-reason', terminal: true } });
    render(<SyncBanner />);
    expect(screen.getByText('协作连接已终止')).toBeInTheDocument();
  });

  it('瞬态 reason（非 terminal）→「服务繁忙，正在自动重试」提示档', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'server-overloaded', terminal: false } });
    render(<SyncBanner />);
    expect(screen.getByText(/服务繁忙，正在自动重试/)).toBeInTheDocument();
  });

  it('Y0b-5 T4：六瞬态误入终态反向断言（isTerminalReason 全 false + SyncBanner 落自动重试档——死亡线延长/自动重试的前提锁）', () => {
    const transientReasons = [
      'server-overloaded', 'db-unavailable', 'draining', 'lease-not-ready', 'rate-limited', 'server-outdated',
    ];
    for (const reason of transientReasons) {
      expect(isTerminalReason(reason)).toBe(false);   // shared 单源分型——误入终态=一次尖峰钉死且不自愈
      cleanup();   // 先卸载上一轮再 setState（有挂载消费者时 store 通知不裹 act——消 act warning）
      useCanvasStore.setState({ wsAuthNotice: { reason, terminal: false } });
      render(<SyncBanner />);
      expect(screen.getByText(/服务繁忙，正在自动重试/)).toBeInTheDocument();
    }
  });

  it('Y0b-5 T4：probeReadyReason 探测 hint（readyProbeHint——重连成功但状态异常的服务端 reason 可见）', () => {
    useCanvasStore.setState({ readyProbeHint: 'lease-held' });
    render(<SyncBanner />);
    expect(screen.getByText(/lease-held/)).toBeInTheDocument();
  });

  it('write-frozen→「服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）」', () => {
    useCanvasStore.setState({ writeFrozen: true });
    render(<SyncBanner />);
    expect(screen.getByText(/服务维护中，编辑已暂停/)).toBeInTheDocument();
    expect(screen.getByText(/请勿刷新页面/)).toBeInTheDocument();
  });

  it('connUi=banner→「连接已断开，正在自动重连」', () => {
    useCanvasStore.setState({ connUi: 'banner' });
    render(<SyncBanner />);
    expect(screen.getByText(/连接已断开，正在自动重连/)).toBeInTheDocument();
  });

  it('connUi=hint→「连接不稳定」提示级', () => {
    useCanvasStore.setState({ connUi: 'hint' });
    render(<SyncBanner />);
    expect(screen.getByText(/连接不稳定，正在自动重连/)).toBeInTheDocument();
  });

  it('terminal 优先于 writeFrozen（鉴权已死时维护横幅让位）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'forbidden', terminal: true }, writeFrozen: true });
    render(<SyncBanner />);
    expect(screen.getByText('无权访问该画布')).toBeInTheDocument();
    expect(screen.queryByText(/服务维护中/)).not.toBeInTheDocument();
  });

  it('全清→不渲染', () => {
    const { container } = render(<SyncBanner />);
    expect(container.querySelector('[data-testid="collab-sync-banner"]')).toBeNull();
  });
});

// ══════════ Y0b-5 T6：横幅单链仲裁（spec §5.7 v2.2 互斥裁定） ══════════
describe('Y0b-5 T6 单链仲裁：terminal 鉴权>配额终态>diverged>oversized>degraded>persist>write-frozen>syncLag>connUi', () => {
  afterEach(cleanup);

  it('diverged 高于 persist/write-frozen：服务端已明确拒收,"自动合并"承诺为假——diverged∧persistUnhealthy 只渲 diverged', () => {
    useCanvasStore.setState({ canvasDiverged: true, persistUnhealthy: true, writeFrozen: true });
    render(<SyncBanner />);
    expect(screen.getByText(/有本地未上行副本/)).toBeInTheDocument();
    expect(screen.queryByText(/尚未保存/)).not.toBeInTheDocument();
    expect(screen.queryByText(/服务维护中/)).not.toBeInTheDocument();
  });

  it('persist∧syncLagOver60s 同真→只渲 persist 档（禁「可尝试刷新」与「请勿刷新」同屏）；syncLag 单真→降级文案「请导出本地副本」零刷新词', () => {
    useCanvasStore.setState({ persistUnhealthy: true, syncLagOver60s: true });
    render(<SyncBanner />);
    expect(screen.getByText(/尚未保存/)).toBeInTheDocument();
    expect(screen.queryByText(/同步延迟较高/)).not.toBeInTheDocument();
    cleanup();
    useCanvasStore.setState({ persistUnhealthy: false });
    render(<SyncBanner />);
    const lag = screen.getByText(/同步延迟较高，请导出本地副本/);
    expect(lag.textContent).not.toContain('刷新');   // 降级文案禁刷新词（persist 同真时矛盾文案不可达）
  });

  it('配额终态委托：wsQuotaTerminal 4404/4410→SyncBanner 静默（渲染权=QuotaBanner——单链仲裁位次仍生效,压 diverged 以下全档）', () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4404, reason: 'doc-over-quota' }, canvasDiverged: true, persistUnhealthy: true });
    const { container } = render(<SyncBanner />);
    expect(container.querySelector('[data-testid="collab-sync-banner"]')).toBeNull();
    expect(screen.queryByText(/有本地未上行副本/)).not.toBeInTheDocument();
  });

  it('4404 ss2-over-limit 档：文案=导出 .yjs→丢弃本地副本（diverged 放弃出边形态,非瘦身）；破坏性次序锚=「放弃」排在「导出」之后', () => {
    useCanvasStore.setState({ wsQuotaTerminal: { code: 4404, reason: SS2_OVER_LIMIT_TERMINAL_REASON } });
    render(<SyncBanner />);
    expect(screen.getByText(/超出单文档上限/)).toBeInTheDocument();
    const exportBtn = screen.getByTestId('diverged-export-btn');
    const discardBtn = screen.getByTestId('diverged-discard-btn');
    expect(exportBtn.compareDocumentPosition(discardBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/瘦身/)).not.toBeInTheDocument();
  });

  it('diverged 分支双动作：导出 .yjs（保全）+ 放弃本地副本（不可逆,二次确认通过才 discardLocalDiverged）', async () => {
    const { discardLocalDiverged } = await import('@/stores/canvasCollabRuntime');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCanvasStore.setState({ canvasDiverged: true });
    render(<SyncBanner />);
    fireEvent.click(screen.getByTestId('diverged-discard-btn'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(discardLocalDiverged).not.toHaveBeenCalled();   // 未确认不放弃
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('diverged-discard-btn'));
    expect(discardLocalDiverged).toHaveBeenCalledTimes(1); // 确认后放弃
  });

  it('能力位【T6 只落字段不落承诺】：localCacheReady=true（T8 禁用路径反例）→persist 档文案恒维持「未保存」档永不谎报', () => {
    useCanvasStore.setState({ persistUnhealthy: true, localCacheReady: true });
    render(<SyncBanner />);
    const banner = screen.getByTestId('collab-sync-banner');
    expect(banner.textContent).toContain('尚未保存');
    expect(banner.textContent).not.toContain('已保存');
    expect(banner.textContent).not.toContain('已缓存');
  });

  it('oversized/degraded 档结构就位（T8 字段驱动——本批恒 false 不渲染）', () => {
    useCanvasStore.setState({ canvasOversized: true });
    render(<SyncBanner />);
    expect(screen.getByText(/超出单文档上限/)).toBeInTheDocument();
    cleanup();
    useCanvasStore.setState({ canvasOversized: false, canvasDegraded: true });
    render(<SyncBanner />);
    expect(screen.getByText(/降级/)).toBeInTheDocument();
  });

  it('文案 denylist 面=单链全分支——逐档实例化扫描：跨刷新承诺词「可尝试刷新」零命中', () => {
    const branchStates: Array<Parameters<typeof useCanvasStore.setState>[0]> = [
      { wsAuthNotice: { reason: 'schema-outdated', terminal: true }, collabEscapePending: true },
      { connUi: 'banner' as const, collabEscapePending: true },   // T6 质量修复 C1：非 terminal escape 档
      { wsAuthNotice: { reason: 'message-too-big', terminal: true } },
      { wsAuthNotice: { reason: 'session-expired', terminal: true } },
      { wsAuthNotice: { reason: 'forbidden', terminal: true } },
      { wsAuthNotice: { reason: 'unknown-x', terminal: true } },
      { wsAuthNotice: { reason: 'server-overloaded', terminal: false } },
      { wsQuotaTerminal: { code: 4404, reason: SS2_OVER_LIMIT_TERMINAL_REASON } },
      { canvasDiverged: true },
      { canvasOversized: true },
      { canvasDegraded: true },
      { persistUnhealthy: true },
      { writeFrozen: true },
      { syncLagOver60s: true },
      { connUi: 'banner' },
      { connUi: 'hint' },
    ];
    for (const st of branchStates) {
      cleanup();
      useCanvasStore.setState(resetPartial());
      useCanvasStore.setState(st);
      render(<SyncBanner />);
      const el = document.querySelector('[data-testid="collab-sync-banner"]');
      if (el) expect(el.textContent).not.toContain('可尝试刷新');
    }
    function resetPartial() {
      return {
        connUi: 'ok' as const, wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
        readyProbeHint: null, wsQuotaTerminal: null, canvasDiverged: false, canvasOversized: false,
        canvasDegraded: false, persistUnhealthy: false, syncLagOver60s: false,
      };
    }
  });

  it('write-frozen 与 persist 档互斥（persist 位次更高——同真只渲 persist,write-frozen 维护文案结构性不可达）', () => {
    useCanvasStore.setState({ persistUnhealthy: true, writeFrozen: true });
    render(<SyncBanner />);
    expect(screen.getByText(/尚未保存/)).toBeInTheDocument();
    expect(screen.queryByText(/服务维护中/)).not.toBeInTheDocument();
  });
});
