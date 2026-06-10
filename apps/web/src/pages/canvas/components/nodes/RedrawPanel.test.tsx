import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RedrawPanel, type RedrawState } from './RedrawPanel';
import React from 'react';

const defaultState: RedrawState = { mode: 'rect', prompt: '', strength: 50 };

describe('RedrawPanel', () => {
  it('renders mode toggle (rect/brush)', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByText('矩形')).toBeInTheDocument();
    expect(screen.getByText('画笔')).toBeInTheDocument();
  });

  it('renders required prompt input', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('描述你希望生成的内容')).toBeInTheDocument();
  });

  it('renders strength slider default 50', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('50')).toBeInTheDocument();
  });

  it('default mode is rect (highlighted)', () => {
    render(<RedrawPanel state={defaultState} onChange={vi.fn()} />);
    const rectBtn = screen.getByText('矩形');
    expect(rectBtn).toHaveStyle({ backgroundColor: expect.stringContaining('59,130,246') });
  });

  it('calls onChange when mode switched', () => {
    const onChange = vi.fn();
    render(<RedrawPanel state={defaultState} onChange={onChange} />);
    fireEvent.click(screen.getByText('画笔'));
    expect(onChange).toHaveBeenCalledWith({ ...defaultState, mode: 'brush' });
  });
});
