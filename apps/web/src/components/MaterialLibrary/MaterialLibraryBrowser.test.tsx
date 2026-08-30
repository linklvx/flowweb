import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MaterialLibraryBrowser } from './MaterialLibraryBrowser';

vi.mock('antd', async () => {
  const actual = await vi.importActual<any>('antd');
  return { ...actual, App: { useApp: () => ({ modal: { confirm: vi.fn() } }) } };
});

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: any[]) => mockGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe('MaterialLibraryBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ data: { data: { success: true, data: [] } } });
  });

  it('页面版（无 onApplyFile）：渲染素材容器，上传按钮在', () => {
    render(<MaterialLibraryBrowser title="我的素材库" />);
    expect(screen.getByText('选择文件')).toBeInTheDocument();
  });
});
