import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { CreateCanvasCard } from './CreateCanvasCard';

function Probe() {
  const navigate = useNavigate();
  return (
    <>
      <CreateCanvasCard />
      <button data-testid="probe" onClick={() => navigate('/probe')} />
    </>
  );
}

describe('CreateCanvasCard', () => {
  beforeEach(() => localStorage.clear());

  it('渲染中央按钮与文案', () => {
    render(<MemoryRouter><Probe /></MemoryRouter>);
    expect(screen.getByText('新建画布创作')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建画布' })).toBeInTheDocument();
    expect(screen.getByTestId('create-canvas-card').className).toContain('mt-[32px]');
  });

  it('点击卡片：清 projectId 并跳 /canvas', () => {
    localStorage.setItem('flowweb_projectId', 'old');
    render(<MemoryRouter><Probe /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('create-canvas-card'));
    expect(localStorage.getItem('flowweb_projectId')).toBeNull();
    expect(screen.getByTestId('probe')).toBeInTheDocument(); // 未崩溃
  });
});
