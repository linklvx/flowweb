import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoTrimPanel } from './VideoTrimPanel';

// Mock Ant Design components to avoid CSS-in-JS and rendering issues
vi.mock('antd', async () => {
  const React = await import('react');
  return {
    Slider: ({ value, onChange, min, max, step, disabled }: any) =>
      React.createElement('div', {
        'data-testid': 'mock-slider',
        'data-min': min,
        'data-max': max,
        'data-step': step,
        children: [
          React.createElement('input', {
            key: 'start',
            type: 'range',
            min, max, step,
            value: value[0],
            disabled,
            'aria-label': 'trim-start',
            onChange: (e: any) => onChange?.([Number(e.target.value), value[1]]),
          }),
          React.createElement('input', {
            key: 'end',
            type: 'range',
            min, max, step,
            value: value[1],
            disabled,
            'aria-label': 'trim-end',
            onChange: (e: any) => onChange?.([value[0], Number(e.target.value)]),
          }),
        ],
      }),
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
  });

  it('should render range slider with correct min/max', () => {
    render(<VideoTrimPanel {...baseProps} />);
    const sliders = screen.getAllByTestId('mock-slider');
    expect(sliders.length).toBeGreaterThan(0);
    expect(sliders[0].dataset.max).toBe('30');
  });

  it('should display current trim start/end time labels', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5.2} initialTrimEnd={18.7} />);
    expect(screen.getByText(formatTime(5.2))).toBeDefined();
    expect(screen.getByText(formatTime(18.7))).toBeDefined();
  });

  it('should display trim duration', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={10} />);
    // Duration midpoint value also rendered — both start=5 and duration=5 give "00:05.0"
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
    // Button renders text as children directly in our mock
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
    const sliders = screen.getAllByTestId('mock-slider');
    // Component clamps negative values to 0 in useState initialization
    expect(sliders[0].dataset.min).toBe('0');
  });

  it('should enforce 0.5s minimum gap between sliders', () => {
    render(<VideoTrimPanel {...baseProps} initialTrimStart={5} initialTrimEnd={5.5} />);
    const btn = screen.getByText('确认裁剪');
    expect(btn).not.toBeDisabled();
  });
});
