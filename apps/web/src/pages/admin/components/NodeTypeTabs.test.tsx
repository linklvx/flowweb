import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeTypeTabs } from './NodeTypeTabs';

const mockTypes = [
  { id: '1', name: '文本生成', key: 'text', active: true, description: undefined },
  { id: '2', name: '图片生成', key: 'image', active: true, description: undefined },
];

describe('NodeTypeTabs', () => {
  it('should render all node types as buttons', () => {
    render(<NodeTypeTabs nodeTypes={mockTypes} activeId="1" onChange={vi.fn()} />);
    expect(screen.getByText('文本生成')).toBeInTheDocument();
    expect(screen.getByText('图片生成')).toBeInTheDocument();
  });

  it('should highlight active tab', () => {
    render(<NodeTypeTabs nodeTypes={mockTypes} activeId="2" onChange={vi.fn()} />);
    const active = screen.getByText('图片生成');
    expect(active.className).toContain('bg-[#4ade80]');
  });

  it('should call onChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<NodeTypeTabs nodeTypes={mockTypes} activeId="1" onChange={onChange} />);
    fireEvent.click(screen.getByText('图片生成'));
    expect(onChange).toHaveBeenCalledWith('2');
  });
});
