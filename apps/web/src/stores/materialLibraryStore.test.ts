import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMaterialLibraryStore } from './materialLibraryStore';
import axios from 'axios';

vi.mock('axios');

describe('materialLibraryStore', () => {
  beforeEach(() => {
    useMaterialLibraryStore.setState({
      isOpen: false,
      selectedFolderId: null,
      folders: [],
      files: [],
      fileGridSize: 200,
      loading: false,
      uploading: false,
    });
    vi.clearAllMocks();
  });

  it('should open and close', () => {
    const { open, close } = useMaterialLibraryStore.getState();
    open();
    expect(useMaterialLibraryStore.getState().isOpen).toBe(true);
    close();
    expect(useMaterialLibraryStore.getState().isOpen).toBe(false);
  });

  it('should set selected folder', () => {
    useMaterialLibraryStore.getState().setSelectedFolder('f-1');
    expect(useMaterialLibraryStore.getState().selectedFolderId).toBe('f-1');
  });

  it('should set file grid size', () => {
    useMaterialLibraryStore.getState().setFileGridSize(250);
    expect(useMaterialLibraryStore.getState().fileGridSize).toBe(250);
  });

  it('should load folders on success', async () => {
    (axios.get as any).mockResolvedValue({
      data: { success: true, data: [{ id: 'f-1', name: '角色' }] },
    });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'f-1', name: '角色' }]);
  });

  it('should handle load folders failure', async () => {
    (axios.get as any).mockRejectedValue(new Error('network'));
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().loading).toBe(false);
  });
});
