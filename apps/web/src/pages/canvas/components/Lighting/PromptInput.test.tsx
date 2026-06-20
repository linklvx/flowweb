import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptInput } from './PromptInput';

describe('PromptInput', () => {
  it('should render textarea with placeholder', () => {
    render(<PromptInput value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('描述你想要的光照效果...')).toBeDefined();
  });

  it('should display current value', () => {
    render(<PromptInput value="test prompt" onChange={vi.fn()} />);
    const textarea = screen.getByPlaceholderText('描述你想要的光照效果...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('test prompt');
  });

  it('should call onChange when typing', () => {
    const onChange = vi.fn();
    render(<PromptInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('描述你想要的光照效果...'), {
      target: { value: 'hello' },
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('should render 2 example buttons', () => {
    render(<PromptInput value="" onChange={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('should call onChange with example text when clicking example', async () => {
    const onChange = vi.fn();
    render(<PromptInput value="" onChange={onChange} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('阳光'));
  });
});
