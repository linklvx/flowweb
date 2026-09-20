import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoHDPanel } from './VideoHDPanel';

describe('VideoHDPanel', () => {
  it('renders title 视频高清', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    expect(screen.getByText('视频高清')).toBeInTheDocument();
  });

  it('renders three select row labels', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    expect(screen.getByText('模型选择')).toBeInTheDocument();
    expect(screen.getByText('分辨率')).toBeInTheDocument();
    expect(screen.getByText('帧率')).toBeInTheDocument();
  });

  it('displays correct default values', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    expect(screen.getByTestId('hd-model-trigger')).toHaveTextContent('HuoShan-画质增强');
    expect(screen.getByTestId('hd-resolution-trigger')).toHaveTextContent('1080P');
    expect(screen.getByTestId('hd-fps-trigger')).toHaveTextContent('自适应(原帧数)');
  });

  it('opens resolution dropdown menu and renders inside panel container', async () => {
    const user = userEvent.setup();
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    await user.click(screen.getByTestId('hd-resolution-trigger'));

    await waitFor(() => {
      // 1080P appears in both trigger (default) and menu; verify menu renders via 2K
      expect(screen.getByText('2K')).toBeInTheDocument();
      expect(screen.getByText('4K')).toBeInTheDocument();
    });

    // Verify menu is rendered as a descendant of the panel root (getPopupContainer)
    const panelRoot = screen.getByTestId('hd-panel-root');
    const menuItem = screen.getByText('4K');
    expect(panelRoot.contains(menuItem)).toBe(true);
  });

  it('changes resolution value when menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    await user.click(screen.getByTestId('hd-resolution-trigger'));

    await waitFor(() => {
      expect(screen.getByText('4K')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('4K'));
    expect(screen.getByTestId('hd-resolution-trigger')).toHaveTextContent('4K');
  });

  it('changes frame rate value when menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    await user.click(screen.getByTestId('hd-fps-trigger'));

    await waitFor(() => {
      expect(screen.getByText('60fps')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('60fps'));
    expect(screen.getByTestId('hd-fps-trigger')).toHaveTextContent('60fps');
  });

  it('renders submit button matching bottom panel style', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    const btn = screen.getByTestId('hd-submit-btn');
    expect(btn).toBeInTheDocument();
    expect(btn.className).toContain('bg-[var(--canvas-controls-bg)]');
  });

  it('submit button calls stopPropagation on click', () => {
    const outerSpy = vi.fn();
    render(
      <div onClick={outerSpy}>
        <VideoHDPanel nodeId="n1" fileId="f1" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('hd-submit-btn'));
    expect(outerSpy).not.toHaveBeenCalled();
  });

  it('root element has nodrag nopan class', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    const root = screen.getByTestId('hd-panel-root');
    expect(root.classList.contains('nodrag')).toBe(true);
    expect(root.classList.contains('nopan')).toBe(true);
  });

  it('renders credits placeholder value', () => {
    render(<VideoHDPanel nodeId="n1" fileId="f1" />);
    expect(screen.getByText('11')).toBeInTheDocument();
  });

  it('submit button is disabled when fileId is undefined', () => {
    render(<VideoHDPanel nodeId="n1" />);
    expect(screen.getByTestId('hd-submit-btn')).toBeDisabled();
  });
});
