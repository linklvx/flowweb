import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GenerateCountSelector } from './GenerateCountSelector';

describe('GenerateCountSelector', () => {
  it('mousedown+click 真实序列：再次点击同一按钮应关闭菜单（修复前必红）', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('canvas-node-image-count-menu')).toBeInTheDocument();
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.queryByTestId('canvas-node-image-count-menu')).not.toBeInTheDocument();
  });

  it('点击 body 关闭（回归）', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.getByTestId('canvas-node-image-count-menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('canvas-node-image-count-menu')).not.toBeInTheDocument();
  });

  it('按钮含 svg 图标前缀且显示「1张」', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    const btn = screen.getByTestId('canvas-node-image-count-select');
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.textContent).toContain('1张');
  });

  it('菜单项为 1张/2张/4张，无 8张', () => {
    render(<GenerateCountSelector count={1} onChange={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId('canvas-node-image-count-select'));
    fireEvent.click(screen.getByTestId('canvas-node-image-count-select'));
    const menu = screen.getByTestId('canvas-node-image-count-menu');
    expect(within(menu).getByText('1张')).toBeTruthy();
    expect(within(menu).getByText('2张')).toBeTruthy();
    expect(within(menu).getByText('4张')).toBeTruthy();
    expect(within(menu).queryByText('8张')).not.toBeInTheDocument();
  });
});
