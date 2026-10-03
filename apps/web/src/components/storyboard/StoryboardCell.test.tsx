// apps/web/src/components/storyboard/StoryboardCell.test.tsx
// O0c-2 随组件自 canvas 页目录抽迁；新增公开页 thumbnailUrl 通道用例（双通道同形）。
// R2b-7 mediaUrl 读点清零：陈旧持久化 URL 不得短路 useMediaUrl
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryboardCell, type CellNodeInfo } from './StoryboardCell';

// mock：url 只来自 hook 解析（/flowai/:fileId），onError 为 spy 供断言自愈直通
const onResolvedError = vi.fn();
vi.mock('@/hooks/useMediaUrl', () => ({
  useMediaUrl: (fileId: string | null) => ({
    url: fileId ? `/flowai/${fileId}` : null,
    loading: false,
    error: null,
    onError: onResolvedError,
  }),
}));

const baseProps = (info: CellNodeInfo | undefined) => ({
  index: 0, info, showIndex: false, selectedCell: null,
  onSelectCell: vi.fn(), onFillEmpty: vi.fn(),
});

// img 带 alt="" → role=presentation（沿用 StoryboardGroupRenderer.test 定位方式）
const getImg = () =>
  screen.getAllByRole('presentation').filter((el) => el.tagName === 'IMG')[0] as HTMLImageElement;

describe('StoryboardCell（R2b-7 mediaUrl 读点清零）', () => {
  beforeEach(() => { onResolvedError.mockClear(); });

  it('info 含陈旧 url（遗留持久化 mediaUrl）→ 不短路，img src 一律来自 useMediaUrl 解析', () => {
    const info = { id: 'c1', fileId: 'f1', url: 'http://stale/presigned' } as CellNodeInfo;
    render(<StoryboardCell {...(baseProps(info) as any)} />);
    expect(getImg().getAttribute('src')).toBe('/flowai/f1');
  });

  it('onError 恒直通 hook 自愈（不再因 info.url 存在而摘除）', () => {
    const info = { id: 'c1', fileId: 'f1', url: 'http://stale/presigned' } as CellNodeInfo;
    render(<StoryboardCell {...(baseProps(info) as any)} />);
    expect(onResolvedError).not.toHaveBeenCalled();
    fireEvent.error(getImg());
    expect(onResolvedError).toHaveBeenCalledTimes(1);
  });

  it('无 url 键（R2b-6 后新常态）→ img src 照常来自 useMediaUrl', () => {
    const info: CellNodeInfo = { id: 'c1', fileId: 'f2' };
    render(<StoryboardCell {...(baseProps(info) as any)} />);
    expect(getImg().getAttribute('src')).toBe('/flowai/f2');
  });

  it('公开页通道（O0c-2）：fileId 缺席（公开 payload 泄漏红线剥除）→ img src=thumbnailUrl 直用', () => {
    const info: CellNodeInfo = { id: 'c1', thumbnailUrl: '/th/c1.webp' };
    render(<StoryboardCell {...(baseProps(info) as any)} />);
    expect(getImg().getAttribute('src')).toBe('/th/c1.webp');
  });
});
