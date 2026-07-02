import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoTrimPanel } from './VideoTrimPanel';

// ─── Mocks ─────────────────────────────────────────────────────

// Mock VideoTrimTimeline component
let mockTimelineProps: any = {};
vi.mock('./VideoTrimTimeline', () => ({
  VideoTrimTimeline: vi.fn((props: any) => {
    mockTimelineProps = props;
    return (
      <div data-testid="mock-timeline">
        <button
          data-testid="mock-timeline-range"
          onClick={() => props.onRangeChange?.(3, 10)}
        />
      </div>
    );
  }),
}));

// Mock Ant Design Button only (keep Button, remove Slider)
vi.mock('antd', async () => {
  const React = await import('react');
  return {
    Button: ({ onClick, disabled, children, ...rest }: any) => {
      const React2 = require('react');
      return React2.createElement('button', {
        onClick,
        disabled: disabled || false,
        'aria-disabled': disabled ? 'true' : 'false',
        type: 'button',
        ...rest,
      }, typeof children === 'string' ? children : children);
    },
  };
});

// ─── Helpers ───────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
}

describe('VideoTrimPanel', () => {
  const baseProps = {
    duration: 30,
    initialTrimStart: 0,
    initialTrimEnd: 30,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTimelineProps = {};
  });

  // ─── Integration tests (new) ────────────────────────────────

  it('should render VideoTrimTimeline component', () => {
    render(<VideoTrimPanel {...baseProps} />);
    expect(screen.getByTestId('mock-timeline')).toBeDefined();
  });

  it('should pass correct props to VideoTrimTimeline', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={4} initialTrimEnd={12} />);
    expect(mockTimelineProps.duration).toBe(30);
    expect(mockTimelineProps.trimStart).toBe(4);
    expect(mockTimelineProps.trimEnd).toBe(12);
  });

  it('should pass disabled=true when taskStatus is processing', () => {
    render(<VideoTrimPanel {...baseProps} taskStatus="processing" />);
    expect(mockTimelineProps.disabled).toBe(true);
  });

  it('should pass disabled=true when taskStatus is queued', () => {
    render(<VideoTrimPanel {...baseProps} taskStatus="queued" />);
    expect(mockTimelineProps.disabled).toBe(true);
  });

  it('should call onRangeChange when timeline range changes', () => {
    const onRangeChange = vi.fn();
    render(<VideoTrimPanel {...baseProps} onRangeChange={onRangeChange} />);

    fireEvent.click(screen.getByTestId('mock-timeline-range'));

    // Should have called both internal setRange and external onRangeChange
    expect(onRangeChange).toHaveBeenCalledWith(3, 10);
  });

  // ─── Existing tests (preserved) ──────────────────────────────

  it('should display current trim start/end time labels', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5.2} initialTrimEnd={18.7} />);
    expect(screen.getByText(formatTime(5.2))).toBeDefined();
    expect(screen.getByText(formatTime(18.7))).toBeDefined();
  });

  it('should display trim duration', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={10} />);
    const elements = screen.getAllByText('00:05.0');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('should call onConfirm with current values when confirm clicked', () => {
    const onConfirm = vi.fn();
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={10} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('确认裁剪'));
    expect(onConfirm).toHaveBeenCalledWith(5, 10);
  });

  it('should call onCancel when cancel clicked', () => {
    const onCancel = vi.fn();
    render(<VideoTrimPanel {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('should disable confirm button when trim range < 0.5s', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={5.2} />);
    const btn = screen.getByText('确认裁剪');
    expect(btn).toBeDisabled();
  });

  it('should have nodrag nopan nowheel class on root container', () => {
    const { container } = render(<VideoTrimPanel {...baseProps} />);
    const root = container.firstElementChild!;
    expect(root.className).toContain('nodrag');
    expect(root.className).toContain('nopan');
    expect(root.className).toContain('nowheel');
  });

  it('should show loading state when taskStatus is processing', () => {
    render(<VideoTrimPanel {...baseProps} taskStatus="processing" />);
    expect(screen.getByText('裁剪中...')).toBeDefined();
  });

  it('should have aria-disabled on confirm button when disabled', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={5.2} />);
    const btn = screen.getByText('确认裁剪');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('should not create new video element', () => {
    const { container } = render(<VideoTrimPanel {...baseProps} />);
    expect(container.querySelector('video')).toBeNull();
  });

  it('should clamp start to 0 when dragging beyond minimum', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={-1} />);
    // Component clamps negative values to 0 in useState initialization
    expect(mockTimelineProps.trimStart).toBe(0);
  });

  it('should enforce 0.5s minimum gap between sliders', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={5.5} />);
    const btn = screen.getByText('确认裁剪');
    expect(btn).not.toBeDisabled();
  });

  it('should show error message when taskStatus is error', () => {
    render(<VideoTrimPanel {...baseProps} taskStatus="error" error="连接超时" />);
    expect(screen.getByText('连接超时')).toBeDefined();
  });
});
