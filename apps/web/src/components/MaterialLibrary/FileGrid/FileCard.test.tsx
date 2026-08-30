import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FileCard from './FileCard';

const toggleFavorite = vi.hoisted(() => vi.fn());
const deleteFile = vi.hoisted(() => vi.fn());

const mockLibraryStore = vi.hoisted(() => {
  const fn = vi.fn((selector?: (state: any) => any) => {
    const state = { toggleFavorite, deleteFile };
    return selector ? selector(state) : state;
  });
  (fn as any).getState = () => ({ toggleFavorite, deleteFile });
  return fn;
});

vi.mock('../../../stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: mockLibraryStore,
}));

// Mock antd Popover: render content alongside trigger for testing
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...(actual as any),
    Popover: ({ content, children, open, onOpenChange, arrow, placement, destroyTooltipOnHide }: any) => (
      <div data-testid="popover-wrapper" data-open={String(open)} data-arrow={String(arrow)} data-placement={placement} data-destroy-on-hide={String(destroyTooltipOnHide)}>
        <div data-testid="popover-trigger" onMouseEnter={() => onOpenChange?.(true)} onMouseLeave={() => onOpenChange?.(false)}>
          {children}
        </div>
        {open && <div data-testid="popover-content">{content}</div>}
      </div>
    ),
  };
});

vi.mock('../FilePreviewPopover', () => ({
  default: ({ file, onApplyToCanvas }: any) => (
    <div data-testid="file-preview-popover" data-file-id={file.id}>
      {onApplyToCanvas && (
        <button data-testid="apply-btn" onClick={() => onApplyToCanvas(file)}>应用到画布</button>
      )}
    </div>
  ),
}));

describe('FileCard', () => {
  const file = {
    id: '1',
    originalName: 'test.png',
    mimeType: 'image/png',
    size: 1024,
    url: 'http://example.com/test.png',
    thumbnailUrl: 'http://example.com/thumb.png',
    folderId: null as string | null,
    isFavorite: false,
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Media file: Popover rendering ───

  it('renders Popover wrapper for image file when isFinePointer=true', () => {
    render(<FileCard file={file} isFinePointer={true} />);
    expect(screen.getByTestId('popover-wrapper')).toBeInTheDocument();
    expect(screen.getByTestId('popover-trigger')).toBeInTheDocument();
  });

  it('renders Popover wrapper for video file when isFinePointer=true', () => {
    const videoFile = { ...file, mimeType: 'video/mp4', originalName: 'test.mp4' };
    render(<FileCard file={videoFile} isFinePointer={true} />);
    expect(screen.getByTestId('popover-wrapper')).toBeInTheDocument();
  });

  // ─── Non-media file: no Popover ───

  it('does not render Popover for non-media file (text/plain)', () => {
    const textFile = { ...file, mimeType: 'text/plain' };
    render(<FileCard file={textFile} isFinePointer={true} />);
    expect(screen.queryByTestId('popover-wrapper')).not.toBeInTheDocument();
  });

  it('does not render Popover for non-media file (audio/mp3)', () => {
    const audioFile = { ...file, mimeType: 'audio/mp3' };
    render(<FileCard file={audioFile} isFinePointer={true} />);
    expect(screen.queryByTestId('popover-wrapper')).not.toBeInTheDocument();
  });

  // ─── Touch device: no Popover ───

  it('does not render Popover when isFinePointer=false (touch device)', () => {
    render(<FileCard file={file} isFinePointer={false} />);
    expect(screen.queryByTestId('popover-wrapper')).not.toBeInTheDocument();
  });

  it('does not render Popover when isFinePointer is undefined', () => {
    render(<FileCard file={file} />);
    expect(screen.queryByTestId('popover-wrapper')).not.toBeInTheDocument();
  });

  // ─── Popover hover: shows FilePreviewPopover ───

  it('shows preview content on popover open', () => {
    render(<FileCard file={file} isFinePointer={true} />);
    const trigger = screen.getByTestId('popover-trigger');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId('file-preview-popover')).toBeInTheDocument();
  });

  it('hides preview content on mouse leave', () => {
    render(<FileCard file={file} isFinePointer={true} />);
    const trigger = screen.getByTestId('popover-trigger');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByTestId('file-preview-popover')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByTestId('file-preview-popover')).not.toBeInTheDocument();
  });

  // ─── Popover config ───

  it('configures Popover with correct props', () => {
    render(<FileCard file={file} isFinePointer={true} />);
    const wrapper = screen.getByTestId('popover-wrapper');
    expect(wrapper.dataset.arrow).toBe('false');
    expect(wrapper.dataset.placement).toBe('right');
    expect(wrapper.dataset.destroyOnHide).toBe('true');
  });

  // ─── Apply to canvas ───

  it('closes popover and calls onApplyFile on apply', () => {
    const onApplyFile = vi.fn();
    render(<FileCard file={file} isFinePointer={true} onApplyFile={onApplyFile} />);
    // Open popover first
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    // Click apply button in the popover
    fireEvent.click(screen.getByTestId('apply-btn'));

    // Popover should be closed after apply
    const wrapper = screen.getByTestId('popover-wrapper');
    expect(wrapper.dataset.open).toBe('false');

    // onApplyFile should be called with the file
    expect(onApplyFile).toHaveBeenCalledWith(file);
  });

  // ─── FileCard onApplyFile 场景感知（spec §二.6） ───

  it('未传 onApplyFile：不渲染"应用到画布"，但预览 Popover 仍可唤起', async () => {
    render(<FileCard file={file} isFinePointer={true} />);
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    await waitFor(() => expect(screen.getByTestId('popover-content')).toBeInTheDocument()); // 预览保留
    expect(screen.queryByText('应用到画布')).not.toBeInTheDocument(); // 按钮不渲染
  });

  it('传 onApplyFile：按钮渲染且点击回调', async () => {
    const onApplyFile = vi.fn();
    render(<FileCard file={file} isFinePointer={true} onApplyFile={onApplyFile} />);
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    await waitFor(() => expect(screen.getByText('应用到画布')).toBeInTheDocument());
    fireEvent.click(screen.getByText('应用到画布'));
    expect(onApplyFile).toHaveBeenCalledWith(file);
  });

  // ─── Scroll close ───

  it('closes popover on material-library:list-scroll event', async () => {
    render(<FileCard file={file} isFinePointer={true} />);
    // Open popover
    fireEvent.mouseEnter(screen.getByTestId('popover-trigger'));
    expect(screen.getByTestId('file-preview-popover')).toBeInTheDocument();

    // Dispatch scroll event
    act(() => {
      window.dispatchEvent(new CustomEvent('material-library:list-scroll'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('file-preview-popover')).not.toBeInTheDocument();
    });
  });

  // ─── File name still rendered ───

  it('still renders file name inside popover trigger', () => {
    render(<FileCard file={file} isFinePointer={true} />);
    expect(screen.getByText('test.png')).toBeInTheDocument();
  });
});
