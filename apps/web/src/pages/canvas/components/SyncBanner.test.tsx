// apps/web/src/pages/canvas/components/SyncBanner.test.tsx
// Y0b-3 T9 Step6：协作横幅分档 UI 测试——四/五/六档终态+瞬态族+write-frozen+connUi 分级
// （优先级：terminal 鉴权 > write-frozen > connUi banner > connUi hint；全清不渲染）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SyncBanner } from './SyncBanner';
import { useCanvasStore } from '@/stores/canvasStore';

vi.mock('@/stores/canvasCollabRuntime', () => ({ escapeWithLocalExport: vi.fn() }));

const reset = () => useCanvasStore.setState({
  connUi: 'ok', wsAuthNotice: null, writeFrozen: false, collabEscapePending: false,
});

beforeEach(reset);
afterEach(cleanup);

describe('SyncBanner 分档（T9 Step6）', () => {
  it('版本族终态（schema-outdated）+逃生 pending→逃生按钮（导出本地画布并刷新）', () => {
    useCanvasStore.setState({ wsAuthNotice: { reason: 'schema-outdated', terminal: true }, collabEscapePending: true });
    render(<SyncBanner />);
    expect(screen.getByText('系统已更新，页面版本过期')).toBeInTheDocument();
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
