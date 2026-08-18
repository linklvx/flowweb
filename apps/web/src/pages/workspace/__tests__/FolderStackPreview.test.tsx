import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FolderStackPreview } from '../components/FolderStackPreview';

describe('FolderStackPreview', () => {
  it('渲染 3 张堆叠卡片', () => {
    const { container } = render(<FolderStackPreview thumbnails={['linear-gradient(red, blue)']} />);
    const cards = container.querySelectorAll('[data-testid="stack-card"]');
    expect(cards).toHaveLength(3);
  });
  it('thumbnails 依次作为卡片背景，不足 3 张用白色系渐变兜底', () => {
    const { container } = render(<FolderStackPreview thumbnails={['linear-gradient(red, blue)']} />);
    const cards = Array.from(container.querySelectorAll('[data-testid="stack-card"]'));
    // jsdom/cssom 对 gradient 的序列化不稳定，用 getAttribute('style') 做子串断言
    expect(cards[0].getAttribute('style')).toContain('linear-gradient');
    expect(cards[0].getAttribute('style')).toContain('red');
    expect(cards[1].getAttribute('style')).toContain('#CCCCCC');
    expect(cards[2].getAttribute('style')).toContain('#939E9E');
  });
  it('snapshot 锁定 DOM 结构（标志性视觉）', () => {
    const { asFragment } = render(<FolderStackPreview thumbnails={[]} />);
    expect(asFragment()).toMatchSnapshot();
  });
});
