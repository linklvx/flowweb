import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AIAssistantFAB } from './AIAssistantFAB';

describe('AIAssistantFAB', () => {
  it('should render a button with aria label', () => {
    render(<AIAssistantFAB />);
    expect(screen.getByRole('button', { name: /AI 助手/i })).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<AIAssistantFAB onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
