import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('antd', () => ({ message: { success: vi.fn(), error: vi.fn() } }));

const mockedAxios = axios as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

// Import after mocks
import { useHistoryStore } from '../historyStore';

describe('historyStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useHistoryStore.setState({
      isOpen: false,
      activeTab: 'image',
      files: [],
      counts: { image: 0, video: 0, audio: 0 },
      fileGridSize: 200,
      loading: false,
      batchMode: false,
      selectedFileIds: new Set<string>(),
    });
  });

  it('should have initial state with isOpen=false', () => {
    const state = useHistoryStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.activeTab).toBe('image');
    expect(state.files).toEqual([]);
    expect(state.counts).toEqual({ image: 0, video: 0, audio: 0 });
    expect(state.fileGridSize).toBe(200);
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('should open modal and load counts + files', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: { image: 5, video: 3, audio: 2 } } });
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: [{ id: 'f1', mimeType: 'image/png' }] } });

    useHistoryStore.getState().open();

    // Wait for async Promise.all
    await vi.waitFor(() => {
      expect(useHistoryStore.getState().isOpen).toBe(true);
    });

    expect(mockedAxios.get).toHaveBeenCalledWith('/api/material/files/count');
    expect(mockedAxios.get).toHaveBeenCalledWith('/api/material/files', { params: { type: 'image' } });

    const state = useHistoryStore.getState();
    expect(state.counts).toEqual({ image: 5, video: 3, audio: 2 });
    expect(state.files).toEqual([{ id: 'f1', mimeType: 'image/png' }]);
  });

  it('should close modal and reset state', () => {
    useHistoryStore.setState({ isOpen: true, batchMode: true });
    useHistoryStore.getState().close();

    const state = useHistoryStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('should set activeTab and reload files, resetting batch state', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: [{ id: 'v1', mimeType: 'video/mp4' }] } });

    useHistoryStore.getState().enterBatchMode();
    useHistoryStore.getState().toggleFileSelection('some-id');
    expect(useHistoryStore.getState().batchMode).toBe(true);

    useHistoryStore.getState().setActiveTab('video');

    expect(useHistoryStore.getState().activeTab).toBe('video');
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().selectedFileIds.size).toBe(0);
  });

  it('should enter and exit batch mode', () => {
    useHistoryStore.getState().enterBatchMode();
    expect(useHistoryStore.getState().batchMode).toBe(true);

    useHistoryStore.getState().exitBatchMode();
    expect(useHistoryStore.getState().batchMode).toBe(false);
    expect(useHistoryStore.getState().selectedFileIds.size).toBe(0);
  });

  it('should toggle file selection', () => {
    useHistoryStore.getState().toggleFileSelection('file-1');
    expect(useHistoryStore.getState().selectedFileIds.has('file-1')).toBe(true);

    useHistoryStore.getState().toggleFileSelection('file-1');
    expect(useHistoryStore.getState().selectedFileIds.has('file-1')).toBe(false);
  });

  it('should select all files', () => {
    useHistoryStore.setState({ files: [{ id: 'f1' } as any, { id: 'f2' } as any, { id: 'f3' } as any] });

    useHistoryStore.getState().selectAllFiles();
    expect(useHistoryStore.getState().selectedFileIds.size).toBe(3);
  });

  it('should batch delete files and reload', async () => {
    useHistoryStore.setState({
      files: [{ id: 'f1' } as any, { id: 'f2' } as any],
      selectedFileIds: new Set(['f1']),
      batchMode: true,
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { success: true } });
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: [{ id: 'f2' }] } });
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: { image: 1, video: 0, audio: 0 } } });

    await useHistoryStore.getState().batchDelete();

    expect(mockedAxios.post).toHaveBeenCalledWith('/api/material/files/batch-delete', {
      ids: ['f1'],
    });
    const state = useHistoryStore.getState();
    expect(state.batchMode).toBe(false);
    expect(state.selectedFileIds.size).toBe(0);
  });

  it('should delete single file and update state', async () => {
    useHistoryStore.setState({ files: [{ id: 'f1' } as any, { id: 'f2' } as any] });
    mockedAxios.delete.mockResolvedValueOnce({ data: { success: true } });
    mockedAxios.get.mockResolvedValueOnce({ data: { success: true, data: { image: 1, video: 0, audio: 0 } } });

    await useHistoryStore.getState().deleteFile('f1');

    expect(mockedAxios.delete).toHaveBeenCalledWith('/api/material/files/f1');
    expect(useHistoryStore.getState().files).toEqual([{ id: 'f2' }]);
  });

  it('should toggle favorite', async () => {
    useHistoryStore.setState({ files: [{ id: 'f1', isFavorite: false } as any] });
    mockedAxios.put.mockResolvedValueOnce({ data: { success: true, data: { id: 'f1', isFavorite: true } } });

    await useHistoryStore.getState().toggleFavorite('f1');

    expect(mockedAxios.put).toHaveBeenCalledWith('/api/material/files/f1/toggle-favorite');
    expect(useHistoryStore.getState().files[0].isFavorite).toBe(true);
  });

  it('should set file grid size', () => {
    useHistoryStore.getState().setFileGridSize(250);
    expect(useHistoryStore.getState().fileGridSize).toBe(250);
  });

  it('should not batch delete when no files selected', async () => {
    await useHistoryStore.getState().batchDelete();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
