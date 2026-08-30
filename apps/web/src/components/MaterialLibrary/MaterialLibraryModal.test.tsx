import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MaterialLibraryModal from './MaterialLibraryModal';
import { useMaterialLibraryStore } from '../../stores/materialLibraryStore';

const { requestAddMediaNode: mockRequestAddMediaNode } = vi.hoisted(() => ({ requestAddMediaNode: vi.fn() }));
const fileGridSpy = vi.hoisted(() => vi.fn());

vi.mock('../../stores/materialLibraryStore');
vi.mock('../../stores/canvasStore', () => ({
  useCanvasStore: { getState: () => ({ teamId: undefined, projectId: undefined, requestAddMediaNode: mockRequestAddMediaNode }) },
}));
vi.mock('./FolderTree/FolderTree', () => ({ default: () => <div>FolderTree</div> }));
vi.mock('./FileGrid/FileGrid', () => ({
  default: (props: any) => {
    fileGridSpy(props);
    return <button data-testid="grid-apply-btn" onClick={() => props.onApplyFile?.({ id: 'f1' })}>apply</button>;
  },
}));

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
    (useMaterialLibraryStore as unknown as any).getState = vi.fn(() => state);
  });

  it('should render when open', () => {
    render(<MaterialLibraryModal />);
    // Modal 壳 title 渲染（Browser 不传 title——壳已有标题，避免重复）
    expect(screen.getAllByText('我的素材库').length).toBeGreaterThan(0);
    const lastGridProps = (fileGridSpy.mock.calls[fileGridSpy.mock.calls.length - 1] as unknown as any[])[0];
    expect(lastGridProps.onApplyFile).toBeTypeOf('function');
  });

  it('应用到画布：requestAddMediaNode + close（handleApplyFile 主路径，画布行为不变）', () => {
    render(<MaterialLibraryModal />);
    fireEvent.click(screen.getByTestId('grid-apply-btn'));
    expect(mockRequestAddMediaNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
    expect(close).toHaveBeenCalled();
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
    expect(screen.queryAllByText('我的素材库')).toHaveLength(0);
  });
});
