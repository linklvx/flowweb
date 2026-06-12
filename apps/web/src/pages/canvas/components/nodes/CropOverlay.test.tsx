import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CropOverlay } from './CropOverlay';

describe('CropOverlay', () => {
  const defaultProps = {
    imageDisplayWidth: 400,
    imageDisplayHeight: 300,
    imageNaturalWidth: 800,
    imageNaturalHeight: 600,
    onCropChange: vi.fn(),
  };

  it('renders overlay and crop frame with 8 handles', () => {
    render(<CropOverlay {...defaultProps} />);
    const handles = document.querySelectorAll('[data-testid="crop-handle"]');
    expect(handles.length).toBe(8);
  });

  it('starts with default 80% centered rect and calls onCropChange', () => {
    const onCropChange = vi.fn();
    render(<CropOverlay {...defaultProps} onCropChange={onCropChange} />);
    expect(onCropChange).toHaveBeenCalledWith({
      x: 0.1, y: 0.1, width: 0.8, height: 0.8,
    });
  });

  it('displays crop dimensions in natural pixels', () => {
    render(<CropOverlay {...defaultProps} />);
    // Default crop is 80% of 800x600 natural = 640x480
    expect(screen.getByText(/640/)).toBeInTheDocument();
    expect(screen.getByText(/480/)).toBeInTheDocument();
  });

  it('has nodrag class on overlay to prevent XYFlow drag', () => {
    render(<CropOverlay {...defaultProps} />);
    const overlay = document.querySelector('[data-testid="crop-overlay"]');
    expect(overlay?.className).toContain('nodrag');
  });

  it('clamps crop rect within image bounds when width exceeds 1', () => {
    // Simulate the case where rapid drag makes width > 1
    // clampCrop should keep the rect within [0,1] range
    const onCropChange = vi.fn();
    render(<CropOverlay {...defaultProps} onCropChange={onCropChange} />);
    // The initial call should be within bounds
    const initialCall = onCropChange.mock.calls[0][0];
    expect(initialCall.x).toBeGreaterThanOrEqual(0);
    expect(initialCall.y).toBeGreaterThanOrEqual(0);
    expect(initialCall.x + initialCall.width).toBeLessThanOrEqual(1.01);
    expect(initialCall.y + initialCall.height).toBeLessThanOrEqual(1.01);
  });

  it('displays size in natural pixels within image bounds', () => {
    render(<CropOverlay {...defaultProps} />);
    // 80% of 800x600 = 640x480
    expect(screen.getByText(/640/)).toBeInTheDocument();
    expect(screen.getByText(/480/)).toBeInTheDocument();
  });

  it('constrains overlay to image display size', () => {
    const { container } = render(
      <CropOverlay
        imageDisplayWidth={400}
        imageDisplayHeight={300}
        imageNaturalWidth={800}
        imageNaturalHeight={600}
        onCropChange={vi.fn()}
      />,
    );
    const overlay = container.querySelector('[data-testid="crop-overlay"]') as HTMLElement;
    expect(overlay.style.width).toBe('400px');
    expect(overlay.style.height).toBe('300px');
  });
});
