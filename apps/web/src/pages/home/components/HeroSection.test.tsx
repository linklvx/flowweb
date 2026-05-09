import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeroSection } from './HeroSection';

describe('HeroSection', () => {
  it('should render title', () => {
    render(<HeroSection />);
    expect(screen.getByText('AI 多模态内容创作平台')).toBeInTheDocument();
  });

  it('should render description with all modalities', () => {
    render(<HeroSection />);
    expect(screen.getByText(/文生文/)).toBeInTheDocument();
    expect(screen.getByText(/文生图/)).toBeInTheDocument();
  });

  it('should render CTA button', () => {
    render(<HeroSection />);
    expect(screen.getByRole('button', { name: /开始创作/i })).toBeInTheDocument();
  });

  it('should call onStartCreate when CTA clicked', () => {
    const onStartCreate = vi.fn();
    render(<HeroSection onStartCreate={onStartCreate} />);
    fireEvent.click(screen.getByText('开始创作'));
    expect(onStartCreate).toHaveBeenCalledOnce();
  });
});
