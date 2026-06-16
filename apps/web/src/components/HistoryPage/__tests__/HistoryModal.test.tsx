import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryModal } from '../HistoryModal';

const mockClose = vi.fn();
const mockEnterBatchMode = vi.fn();
const mockExitBatchMode = vi.fn();
const mockSelectAllFiles = vi.fn();
const mockBatchDelete = vi.fn();
const mockToggleFileSelection = vi.fn();

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: (selector: any) =>
    selector({
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
    }),
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
      const state = { addNode: vi.fn(), requestAddMediaNode: vi.fn() };
      return selector ? selector(state) : state;
    }),
    {
      getState: () => ({ requestAddMediaNode: vi.fn() }),
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
});
