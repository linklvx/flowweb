import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { CropOverlay } from './CropOverlay';

describe('CropOverlay', () => {
  const defaultProps = {
    containerWidth: 400,
    containerHeight: 300,
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
});
