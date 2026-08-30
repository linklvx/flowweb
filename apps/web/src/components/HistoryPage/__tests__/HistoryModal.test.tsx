import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryModal } from '../HistoryModal';

const mockClose = vi.fn();
const mockEnterBatchMode = vi.fn();
const mockExitBatchMode = vi.fn();
const mockSelectAllFiles = vi.fn();
const mockBatchDelete = vi.fn();
const mockToggleFileSelection = vi.fn();
const mockRequestAddMediaNode = vi.hoisted(() => vi.fn());
const fileGridSpy = vi.hoisted(() => vi.fn());

const historyState = () => ({
  isOpen: true,
  activeTab: 'image',
  files: [{ id: 'f1', mimeType: 'image/png', createdAt: '2026-01-01', isFavorite: false, originalName: 'test.png', size: 100 }],
  counts: { image: 1, video: 0, audio: 0 },
  fileGridSize: 200,
  loading: false,
  batchMode: false,
  selectedFileIds: new Set<string>(),
  close: mockClose,
  enterBatchMode: mockEnterBatchMode,
  exitBatchMode: mockExitBatchMode,
  selectAllFiles: mockSelectAllFiles,
  batchDelete: mockBatchDelete,
  toggleFileSelection: mockToggleFileSelection,
  deleteFile: vi.fn(),
  toggleFavorite: vi.fn(),
  setFileGridSize: vi.fn(),
});

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: Object.assign(
    (selector: any) => selector(historyState()),
    { getState: () => historyState() },
  ),
}));

vi.mock('antd', () => ({
  Modal: ({ children, open }: any) =>
    open ? <div data-testid="ant-modal">{children}</div> : null,
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  Popover: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/stores/canvasStore', () => ({
  useCanvasStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = { addNode: vi.fn(), requestAddMediaNode: mockRequestAddMediaNode };
      return selector ? selector(state) : state;
    }),
    {
      getState: () => ({ requestAddMediaNode: mockRequestAddMediaNode }),
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
}));

vi.mock('@/stores/materialLibraryStore', () => ({
  useMaterialLibraryStore: Object.assign(
    vi.fn((selector?: any) => {
      const state = {
        close: vi.fn(),
        toggleFavorite: vi.fn(),
        deleteFile: vi.fn(),
        files: [],
        loading: false,
        fileGridSize: 200,
        batchMode: false,
        selectedFileIds: new Set<string>(),
      };
      return selector ? selector(state) : state;
    }),
    { getState: () => ({ close: vi.fn(), toggleFavorite: vi.fn(), deleteFile: vi.fn() }) },
  ),
}));

vi.mock('@/components/MaterialLibrary/FilePreviewPopover', () => ({
  default: () => null,
}));

// FileGrid mock：捕获 props（接线断言）+ 渲染 originalName + apply 触发按钮（行为用例）
vi.mock('@/components/MaterialLibrary/FileGrid/FileGrid', () => ({
  default: (props: any) => {
    fileGridSpy(props);
    return (
      <div>
        {(props.files ?? []).map((f: any) => (
          <div key={f.id}>{f.originalName}</div>
        ))}
        <button data-testid="grid-apply-btn" onClick={() => props.onApplyFile?.((props.files ?? [])[0])}>
          grid-apply
        </button>
      </div>
    );
  },
}));

describe('HistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(pointer: fine)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders sidebar with all 3 categories', () => {
    render(<HistoryModal />);
    expect(screen.getByText('图片历史')).toBeInTheDocument();
    expect(screen.getByText('视频历史')).toBeInTheDocument();
    expect(screen.getByText('音频历史')).toBeInTheDocument();
  });

  it('shows batch operation button in header', () => {
    render(<HistoryModal />);
    expect(screen.getByText('批量操作')).toBeInTheDocument();
  });

  it('enters batch mode when clicking batch operation button', () => {
    render(<HistoryModal />);
    fireEvent.click(screen.getByText('批量操作'));
    expect(mockEnterBatchMode).toHaveBeenCalled();
  });

  it('renders file grid with file card', () => {
    render(<HistoryModal />);
    expect(screen.getByText('test.png')).toBeInTheDocument();
  });

  // ─── onApplyFile 接线（审查补线：历史记录画布应用） ───

  it('passes onApplyFile to FileGrid', () => {
    render(<HistoryModal />);
    const lastCall = fileGridSpy.mock.calls[fileGridSpy.mock.calls.length - 1][0];
    expect(lastCall.onApplyFile).toBeTypeOf('function');
  });

  it('apply callback adds file to canvas and closes history modal', () => {
    render(<HistoryModal />);
    fireEvent.click(screen.getByTestId('grid-apply-btn'));
    expect(mockRequestAddMediaNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
    expect(mockClose).toHaveBeenCalled();
  });
});
