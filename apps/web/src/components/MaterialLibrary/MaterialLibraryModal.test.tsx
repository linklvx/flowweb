import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MaterialLibraryModal from './MaterialLibraryModal';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

vi.mock('../../stores/materialLibraryStore');
vi.mock('../../stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ teamId: undefined, projectId: undefined }) },
}));
vi.mock('./FolderTree/FolderTree', () => ({ default: () => <div>FolderTree</div> }));
vi.mock('./FileGrid/FileGrid', () => ({ default: () => <div>FileGrid</div> }));

describe('MaterialLibraryModal', () => {
  const close = vi.fn();
  const enterContext = vi.fn();

  let state: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    state = {
      isOpen: true, selectedFolderId: null, close, enterContext, uploading: false,
      batchMode: false, selectedFileIds: new Set(), folders: [],
      enterBatchMode: vi.fn(), exitBatchMode: vi.fn(), selectAllFiles: vi.fn(),
      batchDelete: vi.fn(), batchMove: vi.fn(),
    };
    (useMaterialLibraryStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector?: (s: Record<string, unknown>) => unknown) => selector ? selector(state) : state
    );
  });

  it('should render when open', () => {
    render(<MaterialLibraryModal />);
    expect(screen.getByText('我的素材库')).toBeInTheDocument();
  });

  it('should render modal wrapper', () => {
    render(<MaterialLibraryModal />);
    const wrapper = document.querySelector('.ant-modal-wrap');
    expect(wrapper).toBeInTheDocument();
  });

  it('should enter context on open', () => {
    render(<MaterialLibraryModal />);
    expect(enterContext).toHaveBeenCalled();
  });

  it('should not render when closed', () => {
    state = { isOpen: false, close, enterContext, uploading: false, selectedFolderId: null, batchMode: false, selectedFileIds: new Set(), folders: [], enterBatchMode: vi.fn(), exitBatchMode: vi.fn(), selectAllFiles: vi.fn(), batchDelete: vi.fn(), batchMove: vi.fn() };
    render(<MaterialLibraryModal />);
    expect(screen.queryByText('我的素材库')).not.toBeInTheDocument();
  });
});
