import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

// Mock @tiptap/react
vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: () => <div data-testid="tiptap-editor">editor</div>,
}));

const createMockEditor = (): Editor => {
  const focused: Record<string, any> = {};
  ['toggleBold', 'toggleItalic', 'toggleHeading', 'setParagraph',
   'toggleBulletList', 'toggleOrderedList', 'setHorizontalRule'].forEach((method) => {
    focused[method] = (...args: any[]) => ({ run: vi.fn() });
  });

  return {
    chain: () => ({ focus: () => focused }),
    isActive: vi.fn().mockReturnValue(false),
    getHTML: vi.fn().mockReturnValue('<p>fullscreen test</p>'),
    getText: vi.fn().mockReturnValue('fullscreen test'),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as Editor;
};

import { TextNodeFullscreen } from './TextNodeFullscreen';

describe('TextNodeFullscreen', () => {
  const mockEditor = createMockEditor();
  const defaultProps = {
    editor: mockEditor,
    onClose: vi.fn(),
    open: true,
  };

  it('should render the dialog when open', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('should not render when open is false', () => {
    const { container } = render(<TextNodeFullscreen {...defaultProps} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('should render close button', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByLabelText('关闭')).toBeInTheDocument();
  });

  it('should call onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<TextNodeFullscreen {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should render formatting toolbar with headings', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByLabelText('标题 1')).toBeInTheDocument();
    expect(screen.getByLabelText('标题 2')).toBeInTheDocument();
    expect(screen.getByLabelText('标题 3')).toBeInTheDocument();
  });

  it('should render bold and italic buttons', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByLabelText('加粗')).toBeInTheDocument();
    expect(screen.getByLabelText('斜体')).toBeInTheDocument();
  });

  it('should render list and divider buttons', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByLabelText('无序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('有序列表')).toBeInTheDocument();
    expect(screen.getByLabelText('分割线')).toBeInTheDocument();
  });

  it('should render copy button', () => {
    render(<TextNodeFullscreen {...defaultProps} />);
    expect(screen.getByLabelText('复制')).toBeInTheDocument();
  });

  it('should call editor chain on bold click', () => {
    const editor = createMockEditor();
    const chainSpy = vi.fn();
    editor.chain = () => {
      chainSpy();
      return { focus: () => ({ toggleBold: () => ({ run: vi.fn() }) }) };
    };

    render(<TextNodeFullscreen {...defaultProps} editor={editor} />);
    fireEvent.click(screen.getByLabelText('加粗'));
    expect(chainSpy).toHaveBeenCalled();
  });
});
