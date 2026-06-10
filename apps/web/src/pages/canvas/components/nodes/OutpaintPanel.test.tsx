import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutpaintPanel, type OutpaintState, type Direction } from './OutpaintPanel';
import React from 'react';

const defaultState: OutpaintState = { direction: 'all', scale: 1.2, prompt: '' };

describe('OutpaintPanel', () => {
  it('renders direction buttons (single select)', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByText('上')).toBeInTheDocument();
    expect(screen.getByText('下')).toBeInTheDocument();
    expect(screen.getByText('左')).toBeInTheDocument();
    expect(screen.getByText('右')).toBeInTheDocument();
    expect(screen.getByText('全部')).toBeInTheDocument();
  });

  it('default direction is all (highlighted)', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    const allBtn = screen.getByText('全部');
    expect(allBtn.style.backgroundColor).toMatch(/59,\s*130,\s*246/);
  });

  it('renders prompt input', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByPlaceholderText('描述扩图区域的内容（可选）')).toBeInTheDocument();
  });

  it('shows preview dimensions', () => {
    render(<OutpaintPanel state={defaultState} onChange={vi.fn()} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    expect(screen.getByText(/原图 800×600/)).toBeInTheDocument();
    expect(screen.getByText(/扩图后 960×720/)).toBeInTheDocument();
  });

  it('calls onChange when direction clicked', () => {
    const onChange = vi.fn();
    render(<OutpaintPanel state={defaultState} onChange={onChange} imageW={400} imageH={300} naturalW={800} naturalH={600} />);
    fireEvent.click(screen.getByText('上'));
    expect(onChange).toHaveBeenCalledWith({ ...defaultState, direction: 'top' });
  });
});
