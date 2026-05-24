import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageWithFallback } from './ImageWithFallback';

describe('ImageWithFallback', () => {
  it('should render img with correct src', () => {
    render(<ImageWithFallback src="http://test.com/a.png" alt="test" />);
    const img = screen.getByAltText('test') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('http://test.com/a.png');
  });

  it('should apply className to img', () => {
    render(<ImageWithFallback src="http://test.com/a.png" alt="test" className="rounded-lg" />);
    const img = screen.getByAltText('test') as HTMLImageElement;
    expect(img.className).toContain('rounded-lg');
  });

  it('should show fallback SVG when image fails to load', () => {
    render(<ImageWithFallback src="http://test.com/broken.png" alt="broken" />);
    const img = screen.getByAltText('broken') as HTMLImageElement;
    fireEvent.error(img);
    const fallback = document.querySelector('svg');
    expect(fallback).toBeInTheDocument();
    expect(screen.queryByAltText('broken')).not.toBeInTheDocument();
  });

  it('should stay as img when load succeeds', () => {
    render(<ImageWithFallback src="http://test.com/ok.png" alt="ok" />);
    const img = screen.getByAltText('ok') as HTMLImageElement;
    fireEvent.load(img);
    expect(img).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });
});
