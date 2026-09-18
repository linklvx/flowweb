import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProjectTitle, ROOT_FOLDER_NAME } from './ProjectTitle';

function renderTitle(props: { folderPath?: string[]; projectName?: string } = {}) {
  return render(
    <MemoryRouter>
      <ProjectTitle projectId="p1" projectName={props.projectName ?? '未命名项目'} folderPath={props.folderPath} />
    </MemoryRouter>,
  );
}

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('ProjectTitle', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 0, data: { id: 'p1', name: 'new-name' } }),
    });
  });

  it('should render logo and project name', () => {
    renderTitle();
    expect(screen.getByText(/Flow123/)).toBeInTheDocument();
    expect(screen.getByText('未命名项目')).toBeInTheDocument();
  });

  it('should enter edit mode on click', () => {
    renderTitle();

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('should save on Enter key', async () => {
    renderTitle();

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目');
    fireEvent.change(input, { target: { value: '新项目名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/projects/p1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '新项目名' }),
      });
    });
  });

  it('should save on blur', async () => {
    renderTitle();

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目');
    fireEvent.change(input, { target: { value: '更新的名字' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should not save empty name', () => {
    renderTitle();

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should revert to original name
    expect(screen.getByText('未命名项目')).toBeInTheDocument();
    // Should NOT have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('Flow123 为返回工作空间的白色链接', () => {
    renderTitle();
    const link = screen.getByRole('link', { name: /Flow123/ });
    expect(link).toHaveAttribute('href', '/works');
    expect(link.className).toContain('text-text');
  });

  it('folderPath 为空显示 主目录/ 前缀', () => {
    renderTitle({ folderPath: [] });
    expect(screen.getByText(`${ROOT_FOLDER_NAME}/`)).toBeInTheDocument();
  });

  it('folderPath 嵌套层级以 / 连接显示', () => {
    renderTitle({ folderPath: ['设计稿', '子文件夹'] });
    expect(screen.getByText('设计稿/子文件夹/')).toBeInTheDocument();
  });

  it('编辑态保留路径前缀，输入框仅含画布名', () => {
    renderTitle({ folderPath: ['设计稿'] });
    fireEvent.click(screen.getByText('未命名项目'));
    expect(screen.getByText('设计稿/')).toBeInTheDocument();
    expect(screen.getByDisplayValue('未命名项目')).toBeInTheDocument();
  });

  it('路径前缀带 truncate 与 max-w 限制', () => {
    renderTitle({ folderPath: ['设计稿'] });
    const prefix = screen.getByText('设计稿/');
    expect(prefix.className).toContain('truncate');
    expect(prefix.className).toContain('max-w-[200px]');
  });

  it('编辑输入框边框为深灰 #555 且最小宽 120px', () => {
    renderTitle();
    fireEvent.click(screen.getByText('未命名项目'));
    const input = screen.getByDisplayValue('未命名项目');
    expect(input.className).toContain('border-[#555]');
    expect(input.className).not.toContain('border-accent');
    expect(input.className).toContain('min-w-[120px]');
  });
});
