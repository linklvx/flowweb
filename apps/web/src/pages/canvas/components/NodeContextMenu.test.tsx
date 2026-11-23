// NodeContextMenu.test.tsx（Y4b T11 入口 A——全节点右键「批注」）
// 主用例第一条失败断言（施工单 Step 1）：render（nodeId/x/y）→菜单项「批注」存在+点击回调
// onAnnotate(nodeId)——组件不存在即红。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { NodeContextMenu } from './NodeContextMenu';

describe('NodeContextMenu（Y4b T11 入口 A）', () => {
  it('菜单含「批注」项 → 点击回调 onAnnotate(nodeId) 并收起菜单', () => {
    const onAnnotate = vi.fn();
    const onClose = vi.fn();
    render(<NodeContextMenu nodeId="n1" x={0} y={0} onAnnotate={onAnnotate} onClose={onClose} />);
    const item = screen.getByText('批注');
    expect(item).toBeInTheDocument();
    fireEvent.click(item);
    expect(onAnnotate).toHaveBeenCalledWith('n1');
    expect(onClose).toHaveBeenCalledTimes(1);   // 触发后即收菜单（GroupContextMenu 同款）
  });

  it('定位同 GroupContextMenu 先例：绝对定位 left/top=clientX/clientY', () => {
    render(<NodeContextMenu nodeId="n1" x={12} y={34} onAnnotate={vi.fn()} onClose={vi.fn()} />);
    const menu = screen.getByTestId('node-context-menu');
    expect(menu.className).toContain('absolute');
    expect(menu.style.left).toBe('12px');
    expect(menu.style.top).toBe('34px');
  });
});
