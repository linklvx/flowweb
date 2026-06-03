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
      data: { code: 0, data: { success: true, data: [{ id: 'f-1', name: '角色' }] }, message: 'ok' },
    });
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().folders).toEqual([{ id: 'f-1', name: '角色' }]);
  });

  it('should handle load folders failure', async () => {
    (axios.get as any).mockRejectedValue(new Error('network'));
    await useMaterialLibraryStore.getState().loadFolders();
    expect(useMaterialLibraryStore.getState().loading).toBe(false);
  });

  it('should rewrite presigned GET URLs through Vite proxy in loadFiles', async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        code: 0,
        data: {
          success: true,
          data: [
            {
              id: 'file-1',
              originalName: 'test.png',
              mimeType: 'image/png',
              url: 'http://127.0.0.1:9000/flowai/uploads/user1/2026-06-03/uuid.png?X-Amz-Algorithm=AWS4-HMAC-SHA256',
              thumbnailUrl: null,
            },
          ],
        },
      },
    });
    await useMaterialLibraryStore.getState().loadFiles();
    const files = useMaterialLibraryStore.getState().files;
    expect(files[0].url).toBe('/minio-storage/uploads/user1/2026-06-03/uuid.png?X-Amz-Algorithm=AWS4-HMAC-SHA256');
  });

  it('should rewrite thumbnailUrl through Vite proxy in loadFiles', async () => {
    (axios.get as any).mockResolvedValue({
      data: {
        code: 0,
        data: {
          success: true,
          data: [
            {
              id: 'file-2',
              originalName: 'test.mp4',
              mimeType: 'video/mp4',
              url: 'http://127.0.0.1:9000/flowai/uploads/user1/2026-06-03/vid.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256',
              thumbnailUrl: 'http://127.0.0.1:9000/flowai/thumbnails/user1/thumb.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256',
            },
          ],
        },
      },
    });
    await useMaterialLibraryStore.getState().loadFiles();
    const files = useMaterialLibraryStore.getState().files;
    expect(files[0].url).toBe('/minio-storage/uploads/user1/2026-06-03/vid.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(files[0].thumbnailUrl).toBe('/minio-storage/thumbnails/user1/thumb.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256');
  });
});
