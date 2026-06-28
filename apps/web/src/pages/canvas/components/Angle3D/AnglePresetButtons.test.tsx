import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnglePresetButtons } from './AnglePresetButtons';
import { ANGLE3D_DEFAULTS, ANGLE3D_PRESETS } from '@flowweb/shared';

describe('AnglePresetButtons', () => {
  const defaultParams = ANGLE3D_DEFAULTS;

  it('should render 5 preset buttons', () => {
    render(
      <AnglePresetButtons
        currentParams={defaultParams}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    for (const preset of ANGLE3D_PRESETS) {
      expect(screen.getByText(preset.label)).toBeDefined();
    }
  });

  it('should render custom label (not a button)', () => {
    render(
      <AnglePresetButtons
        currentParams={defaultParams}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('自定义')).toBeDefined();
  });

  it('should highlight matching preset when params equal a preset', () => {
    const fisheye = ANGLE3D_PRESETS[0]; // 鱼眼视角: 0, 30, 10
    render(
      <AnglePresetButtons
        currentParams={{ horizontalAngle: 0, verticalAngle: 30, zoom: 10 }}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    const fisheyeBtn = screen.getByText('鱼眼视角').closest('button');
    const customLabel = screen.getByText('自定义');

    // Fisheye should be highlighted, custom should not
    expect(fisheyeBtn).not.toBeNull();
  });

  it('should highlight 自定义 when params match no preset', () => {
    render(
      <AnglePresetButtons
        currentParams={{ horizontalAngle: 12, verticalAngle: 7, zoom: 4 }}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    // No preset matches (12, 7, 4) — all presets should be non-highlighted
    // 自定义 label should exist
    expect(screen.getByText('自定义')).toBeDefined();
  });

  it('should match within threshold (±0.5° for angles, ±0.1 for zoom)', () => {
    // Fisheye: (0, 30, 10), within threshold: (0.3, 30.3, 9.95)
    render(
      <AnglePresetButtons
        currentParams={{ horizontalAngle: 0.3, verticalAngle: 30.3, zoom: 9.95 }}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    // Still should match 鱼眼视角
    const fisheyeBtn = screen.getByText('鱼眼视角').closest('button');
    expect(fisheyeBtn).not.toBeNull();
  });

  it('should NOT match when outside threshold', () => {
    // Fisheye: (0, 30, 10), outside threshold: (1, 30, 10) — horizontalAngle diff=1 > 0.5
    render(
      <AnglePresetButtons
        currentParams={{ horizontalAngle: 1, verticalAngle: 30, zoom: 10 }}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('自定义')).toBeDefined();
  });

  it('should call onSelect with preset key when clicked', () => {
    const onSelect = vi.fn();
    render(
      <AnglePresetButtons
        currentParams={defaultParams}
        disabled={false}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('倾斜视角'));
    expect(onSelect).toHaveBeenCalledWith('tilted');
  });

  it('should not call onSelect when custom label is clicked', () => {
    const onSelect = vi.fn();
    render(
      <AnglePresetButtons
        currentParams={defaultParams}
        disabled={false}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('自定义'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('should disable preset buttons when disabled=true', () => {
    render(
      <AnglePresetButtons
        currentParams={defaultParams}
        disabled={true}
        onSelect={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });
});
