import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StyleLibraryModal } from './StyleLibraryModal';
import { useMenuStore } from '@/stores/menuStore';
import { useNodeStore } from '@/stores/nodeStore';
import * as api from '@/api/stylesApi';

vi.mock('@/api/stylesApi', () => ({
  fetchStyleCategories: vi.fn().mockResolvedValue([{ id: 'c1', name: '摄影写真', sortOrder: 1 }]),
  fetchStyles: vi.fn(),
  favoriteStyle: vi.fn().mockResolvedValue({ favorited: true }),
  useStyle: vi.fn(),
}));

const item = (id: string, over: Partial<api.StyleSummary> = {}) => ({
  id, name: `风格${id}`, coverUrl: `/c${id}.png`, authorName: '作者',
  isCommercial: true, usageCount: 5, promptText: 'promptText 正文', favorited: false, ...over,
});

describe('StyleLibraryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMenuStore.getState().closeStyleLibrary();
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: {} } } as any });
  });

  it('未打开不渲染且不发请求（H1——hook 只在内层挂载）', () => {
    const { container } = render(<StyleLibraryModal />);
    expect(container.innerHTML).toBe('');
    expect(api.fetchStyles).not.toHaveBeenCalled();
    expect(api.fetchStyleCategories).not.toHaveBeenCalled();
  });

  it('打开渲染三 tab/分类 chips/仅看可商用/卡片信息（名称+商用徽章+作者+N 人使用）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    expect(await screen.findByText('风格s1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '我的收藏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最近使用' })).toBeInTheDocument();
    expect(screen.getByText('摄影写真')).toBeInTheDocument();
    expect(screen.getByText('仅看可商用')).toBeInTheDocument();
    expect(screen.getByText('商用')).toBeInTheDocument();
    expect(screen.getByText('5 人使用')).toBeInTheDocument();
  });

  it('点卡片=使用+关窗；点收藏/详情不触发使用（stopPropagation，D13）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    (api.useStyle as any).mockResolvedValue(item('s1'));
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('风格s1');
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    expect(api.useStyle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(api.useStyle).not.toHaveBeenCalled();
    expect(screen.getByTestId('style-detail-preview')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('style-card-s1'));
    await waitFor(() => expect(api.useStyle).toHaveBeenCalledWith('s1'));
    expect(useMenuStore.getState().styleLibrary).toBeNull(); // 使用即关窗
  });

  it('当前使用卡：白底徽章+hover 取消使用写 null（D16）', async () => {
    useNodeStore.setState({ nodes: { img1: { id: 'img1', type: 'imageGen', data: { styleId: 's1', styleName: '风格s1' } } } as any });
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('当前使用');
    fireEvent.click(screen.getByTestId('style-card-s1')); // 点当前使用卡主体=无操作
    expect(api.useStyle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消使用' }));
    expect((useNodeStore.getState().nodes['img1'].data as { styleId?: string | null }).styleId).toBeNull();
  });

  it('详情层：Esc 第一次关详情不关库（D20 状态驱动 onClose）', async () => {
    (api.fetchStyles as any).mockResolvedValue({ items: [item('s1')], total: 1, page: 1, pageSize: 20 });
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await screen.findByText('风格s1');
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(screen.getByTestId('style-detail-preview')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('style-detail-preview')).not.toBeInTheDocument();
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' }); // 库未关
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useMenuStore.getState().styleLibrary).toBeNull(); // 第二次关库
  });

  it('空态与 useError（失败不关窗，spec §4.4）', async () => {
    (api.fetchStyles as any).mockRejectedValue(new Error('x'));
    useMenuStore.getState().openStyleLibrary('img1');
    render(<StyleLibraryModal />);
    await waitFor(() => expect(screen.getByText('加载失败，请重试')).toBeInTheDocument());
    expect(useMenuStore.getState().styleLibrary).toEqual({ nodeId: 'img1' });
  });
});
