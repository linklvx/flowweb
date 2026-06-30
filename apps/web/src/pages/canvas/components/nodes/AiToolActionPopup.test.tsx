import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AiToolActionPopup } from './AiToolActionPopup';
import type { AiToolId } from '@/stores/nodeStore';

vi.mock('./ai/aiToolConfig', () => ({
  AI_TOOL_GROUPS: [
    {
      groupName: '分镜叙事',
      items: [
        { id: 'nine_camera' as AiToolId, name: '多机位九宫格', desc: '生成多视角机位图', icon: React.createElement('span', null, 'N') },
        { id: 'four_panel' as AiToolId, name: '剧情推演四宫格', desc: '生成四格剧情推演', icon: React.createElement('span', null, 'F') },
      ],
    },
    {
      groupName: '设定图',
      items: [
        { id: 'face_three_view' as AiToolId, name: '角色脸部三视图', desc: '基于一张参考图生成脸部细节三视图', icon: React.createElement('span', null, 'V') },
      ],
    },
  ],
}));

describe('AiToolActionPopup', () => {
  it('should render nothing when open is false', () => {
    const { container } = render(
      <AiToolActionPopup open={false} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render tool groups and items when open', () => {
    render(<AiToolActionPopup open={true} onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText('分镜叙事')).toBeTruthy();
    expect(screen.getByText('多机位九宫格')).toBeTruthy();
    expect(screen.getByText('剧情推演四宫格')).toBeTruthy();
    expect(screen.getByText('设定图')).toBeTruthy();
    expect(screen.getByText('角色脸部三视图')).toBeTruthy();
  });

  it('should call onSelect with toolId when clicking a tool card', () => {
    const onSelect = vi.fn();
    render(<AiToolActionPopup open={true} onClose={vi.fn()} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('多机位九宫格'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('nine_camera' as AiToolId);
  });

  it('should call onClose when clicking outside the popup', () => {
    const onClose = vi.fn();
    render(
      <div data-testid="outside">
        <AiToolActionPopup open={true} onClose={onClose} onSelect={vi.fn()} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when pressing Escape', () => {
    const onClose = vi.fn();
    render(<AiToolActionPopup open={true} onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
