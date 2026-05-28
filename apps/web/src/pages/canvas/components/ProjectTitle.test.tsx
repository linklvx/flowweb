import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ProjectTitle } from './ProjectTitle';

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
    render(<ProjectTitle projectId="p1" projectName="未命名项目" />);
    expect(screen.getByText(/Flow123/)).toBeInTheDocument();
    expect(screen.getByText('未命名项目')).toBeInTheDocument();
  });

  it('should enter edit mode on click', () => {
    render(<ProjectTitle projectId="p1" projectName="未命名项目" />);

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('should save on Enter key', async () => {
    render(<ProjectTitle projectId="p1" projectName="未命名项目" />);

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
    render(<ProjectTitle projectId="p1" projectName="未命名项目" />);

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目');
    fireEvent.change(input, { target: { value: '更新的名字' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  it('should not save empty name', () => {
    render(<ProjectTitle projectId="p1" projectName="未命名项目" />);

    fireEvent.click(screen.getByText('未命名项目'));

    const input = screen.getByDisplayValue('未命名项目');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should revert to original name
    expect(screen.getByText('未命名项目')).toBeInTheDocument();
    // Should NOT have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
