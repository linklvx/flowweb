import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FolderListPreview } from '../components/FolderListPreview';

describe('FolderListPreview', () => {
  it('渲染 3 张堆叠小卡', () => {
    const { container } = render(<FolderListPreview thumbnails={[]} />);
    expect(container.querySelectorAll('[data-testid="stack-card"]')).toHaveLength(3);
  });

  it('容器显式 72x48（grid 单元格无内在高度）', () => {
    const { container } = render(<FolderListPreview thumbnails={[]} />);
    const style = container.firstElementChild!.getAttribute('style') ?? '';
    expect(style).toContain('width: 72px');
    expect(style).toContain('height: 48px');
  });

  it('thumbnails 依次作卡片背景，不足 3 张用白色系渐变兜底', () => {
    const { container } = render(<FolderListPreview thumbnails={['linear-gradient(red, blue)']} />);
    const cards = Array.from(container.querySelectorAll('[data-testid="stack-card"]'));
    expect(cards).toHaveLength(3);
    expect(cards[0].getAttribute('style')).toContain('linear-gradient');
    expect(cards[0].getAttribute('style')).toContain('red');
    expect(cards[1].getAttribute('style')).toContain('#CCCCCC');
    expect(cards[2].getAttribute('style')).toContain('#939E9E');
  });
});
