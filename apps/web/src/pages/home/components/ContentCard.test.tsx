import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContentCard } from './ContentCard';
import type { ContentCard as ContentCardType } from '@flowweb/shared';

const mockCard: ContentCardType = {
  id: '1',
  title: '文生图工作流',
  coverUrl: '/placeholder.jpg',
  tags: ['推荐', '热门'],
  desc: '快速生成高质量图片',
};

describe('ContentCard', () => {
  it('should render title', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('文生图工作流')).toBeInTheDocument();
  });

  it('should render tags', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('推荐')).toBeInTheDocument();
    expect(screen.getByText('热门')).toBeInTheDocument();
  });

  it('should render description', () => {
    render(<ContentCard card={mockCard} />);
    expect(screen.getByText('快速生成高质量图片')).toBeInTheDocument();
  });

  it('should render cover image', () => {
    render(<ContentCard card={mockCard} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/placeholder.jpg');
    expect(img).toHaveAttribute('alt', '文生图工作流');
  });
});
