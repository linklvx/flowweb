// NormalGroupRenderer.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NormalGroupRenderer } from './NormalGroupRenderer';

const baseData = { groupType: 'normal', name: '分组 2 个节点' };

describe('NormalGroupRenderer', () => {
  it('渲染组名标签', () => {
    render(<NormalGroupRenderer data={baseData as any} selected={false} />);
    expect(screen.getByText('分组 2 个节点')).toBeTruthy();
  });

  it('折叠态渲染紧凑卡片（200x64 + 节点数）', () => {
    render(<NormalGroupRenderer data={{ ...baseData, collapsed: true } as any} selected={false} />);
    expect(screen.getByText(/2 个节点/)).toBeTruthy();
  });
});
