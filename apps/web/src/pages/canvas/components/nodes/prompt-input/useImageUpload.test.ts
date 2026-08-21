import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ImageItem } from './types';

// ========== Hoisted mutable state ==========

const {
  mockNodes,
  mockUpdatePromptImagesFn,
  mockPresignUploadFn,
  mockConfirmUploadFn,
  mockAxiosPostFn,
  mockCompressAccuratelyFn,
  mockFetchFn,
  mockCreateObjectURLFn,
  mockRevokeObjectURLFn,
  mockUseNodeStore,
} = vi.hoisted(() => {
  const nodes: Record<string, any> = {};

  // Mirrors real nodeStore.updatePromptImages — writes ROOT-level data.allImages
  const updateFn = vi.fn((nodeId: string, allImages: ImageItem[]) => {
    if (nodes[nodeId]?.type === 'imageGen' || nodes[nodeId]?.type === 'imageExtGen' || nodes[nodeId]?.type === 'videoGen' || nodes[nodeId]?.type === 'video') {
      nodes[nodeId] = {
        ...nodes[nodeId],
        data: {
          ...nodes[nodeId].data,
          allImages,
        },
      };
    }
  });

  const store = Object.assign(
    vi.fn((selector?: any) => {
      if (typeof selector === 'function') {
        return selector({ nodes, updatePromptImages: updateFn });
      }
      return { nodes, updatePromptImages: updateFn };
    }),
    {
      getState: vi.fn(() => ({
        nodes,
        updatePromptImages: updateFn,
      })),
    },
  );

  return {
    mockNodes: nodes,
    mockUpdatePromptImagesFn: updateFn,
    mockPresignUploadFn: vi.fn(),
    mockConfirmUploadFn: vi.fn(),
    mockAxiosPostFn: vi.fn(),
    mockCompressAccuratelyFn: vi.fn(),
    mockFetchFn: vi.fn(),
    mockCreateObjectURLFn: vi.fn(),
    mockRevokeObjectURLFn: vi.fn(),
    mockUseNodeStore: store,
  };
});

// ========== Module mocks (use hoisted refs) ==========

vi.mock('@/stores/nodeStore', () => ({
  isImageNode: (node: unknown) => {
    if (!node || typeof node !== 'object') return false;
    const type = (node as { type?: string }).type;
    return type === 'imageGen' || type === 'imageExtGen';
  },
  useNodeStore: mockUseNodeStore,
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: mockPresignUploadFn,
  confirmUpload: mockConfirmUploadFn,
}));

vi.mock('axios', () => ({
  default: { post: mockAxiosPostFn },
}));

vi.mock('image-conversion', () => ({
  compressAccurately: mockCompressAccuratelyFn,
}));

vi.mock('@/api/mediaApi', () => ({
  getMediaUrl: vi.fn().mockResolvedValue({ url: 'http://minio/flowai/test-file.png' }),
}));

// Dynamic import AFTER mocks are set up
import { useImageUpload } from './useImageUpload';

// ========== Helpers ==========

function makeImageNode(id: string, allImages: ImageItem[] = []): Record<string, any> {
  return {
    id,
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {
      style: '写实',
      model: 'sdxl',
      quality: 'standard',
      ratio: '1:1',
      status: 'idle',
      allImages,
      prompt: {
        text: '',
        html: '',
        allImages: [],
        referencedImageIds: [],
      },
    },
  };
}

function makeTextNode(id: string): Record<string, any> {
  return { id, type: 'text', position: { x: 0, y: 0 }, data: { content: 'hello' } };
}

function makeImageExtNode(id: string, allImages: ImageItem[] = []): Record<string, any> {
  return {
    id,
    type: 'imageExtGen',
    position: { x: 0, y: 0 },
    data: {
      style: '写实',
      model: 'sdxl',
      quality: 'standard',
      ratio: '1:1',
      status: 'idle',
      allImages,
      prompt: {
        text: '',
        html: '',
        allImages: [],
        referencedImageIds: [],
      },
    },
  };
}

function makeVideoNode(id: string, allImages: ImageItem[] = []): Record<string, any> {
  return {
    id,
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: {
      model: '',
      status: 'idle',
      allImages,
      prompt: { text: '', html: '', referencedImageIds: [] },
    },
  };
}

// ========== Tests ==========

describe('useImageUpload', () => {
  let presignCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockNodes).forEach((k) => delete mockNodes[k]);
    presignCounter = 0;

    // Default mock implementations
    mockPresignUploadFn.mockImplementation(async (params: { fileName: string }) => {
      const id = `file-${++presignCounter}`;
      return {
        fileId: id,
        uploadUrl: `http://minio/flowai/${id}`,
        key: `uploads/${id}/${params.fileName}`,
        fields: {
          key: `uploads/${id}/${params.fileName}`,
          Policy: 'x',
          'X-Am-Signature': 'y',
        },
      };
    });
    mockConfirmUploadFn.mockResolvedValue({ fileId: 'confirmed-id' });
    mockAxiosPostFn.mockResolvedValue({});
    mockCompressAccuratelyFn.mockImplementation((file: File) => Promise.resolve(file));
    mockFetchFn.mockResolvedValue({ ok: true });
    mockCreateObjectURLFn.mockReturnValue('blob:mock-temp-url');
    mockRevokeObjectURLFn.mockImplementation(() => {});

    vi.stubGlobal('fetch', mockFetchFn);
    vi.stubGlobal('URL', {
      createObjectURL: mockCreateObjectURLFn,
      revokeObjectURL: mockRevokeObjectURLFn,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ================================================================
  // 1. uploadSingleImage — success
  // ================================================================
  it('1. uploadSingleImage — returns ImageItem with status=success', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    const { result } = renderHook(() => useImageUpload('node-1'));
    const file = new File(['test-content'], 'test.png', { type: 'image/png' });

    let image: ImageItem | null = null;
    await act(async () => {
      image = await result.current.uploadSingleImage(file);
    });

    expect(image).not.toBeNull();
    expect(image!.status).toBe('success');
    expect(image!.progress).toBe(100);
    expect(image!.url).toBe('http://minio/flowai/test-file.png');
    expect(image!.name).toBe('test.png');

    // Temp item created
    expect(mockCreateObjectURLFn).toHaveBeenCalledWith(file);

    // Presign + confirm called
    expect(mockPresignUploadFn).toHaveBeenCalledWith({
      fileName: 'test.png',
      fileSize: 12,
      fileType: 'image/png',
      type: 'uploaded',
    });
    expect(mockConfirmUploadFn).toHaveBeenCalled();

    // updatePromptImages called (at least: add temp + replace with real)
    expect(mockUpdatePromptImagesFn).toHaveBeenCalledTimes(2);

    // First call: temp item with status='uploading'
    const firstCall = mockUpdatePromptImagesFn.mock.calls[0] as [string, ImageItem[]];
    expect(firstCall[0]).toBe('node-1');
    expect(firstCall[1].length).toBe(1);
    expect(firstCall[1][0].status).toBe('uploading');
    expect(firstCall[1][0].id).toMatch(/^temp-/);

    // Last call: real item with status='success'
    const lastCall =
      mockUpdatePromptImagesFn.mock.calls[mockUpdatePromptImagesFn.mock.calls.length - 1] as [
        string,
        ImageItem[],
      ];
    expect(lastCall[1].length).toBe(1);
    expect(lastCall[1][0].status).toBe('success');
    expect(lastCall[1][0].id).toBe('file-1');
  });

  // ================================================================
  // 2. uploadSingleImage — progress
  // ================================================================
  it('2. uploadSingleImage — uploads with real progress updates', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    mockAxiosPostFn.mockImplementation(async (_url: string, _formData: any, config: any) => {
      config?.onUploadProgress?.({ loaded: 300, total: 1000 }); // 30%
      config?.onUploadProgress?.({ loaded: 700, total: 1000 }); // 70%
      config?.onUploadProgress?.({ loaded: 1000, total: 1000 }); // 100%
    });

    const progressCalls: number[] = [];
    const onProgress = (p: number) => progressCalls.push(p);

    const { result } = renderHook(() => useImageUpload('node-1'));
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await act(async () => {
      await result.current.uploadSingleImage(file, onProgress);
    });

    // onProgress callback receives all progress values
    expect(progressCalls).toContain(30);
    expect(progressCalls).toContain(70);
    expect(progressCalls).toContain(100);

    // Store updates: throttle ensures only >= 10% changes trigger updates
    const calls = mockUpdatePromptImagesFn.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Verify progress was updated in store (find a call with progress > 0)
    const progressUpdates = calls.filter(
      (call: [string, ImageItem[]]) =>
        call[0] === 'node-1' && call[1].some((img) => (img.progress ?? 0) > 0),
    );
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  // ================================================================
  // 3. uploadSingleImage — failure
  // ================================================================
  it('3. uploadSingleImage — marks error on failure, returns null', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');
    mockPresignUploadFn.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useImageUpload('node-1'));
    const file = new File(['test'], 'fail.png', { type: 'image/png' });

    let image: ImageItem | null = null;
    await act(async () => {
      image = await result.current.uploadSingleImage(file);
    });

    expect(image).toBeNull();

    // Last updatePromptImages call marks temp item as error
    const lastCall =
      mockUpdatePromptImagesFn.mock.calls[mockUpdatePromptImagesFn.mock.calls.length - 1] as [
        string,
        ImageItem[],
      ];
    expect(lastCall[1].some((img) => img.status === 'error')).toBe(true);

    // Cleanup still happens
    expect(mockRevokeObjectURLFn).toHaveBeenCalled();
  });

  // ================================================================
  // 3b. uploadSingleImage — imageExtGen node type
  // ================================================================
  it('3b. uploadSingleImage — works for imageExtGen nodes', async () => {
    mockNodes['ext-1'] = makeImageExtNode('ext-1');

    const { result } = renderHook(() => useImageUpload('ext-1'));
    const file = new File(['test'], 'ext-test.png', { type: 'image/png' });

    let image: ImageItem | null = null;
    await act(async () => {
      image = await result.current.uploadSingleImage(file);
    });

    expect(image).not.toBeNull();
    expect(image!.status).toBe('success');
  });

  // ================================================================
  // 4. uploadSingleImage — non-image node type
  // ================================================================
  it('4. uploadSingleImage — returns null when nodeId is not an image type', async () => {
    mockNodes['text-node'] = makeTextNode('text-node');

    const { result } = renderHook(() => useImageUpload('text-node'));
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    let image: ImageItem | null = 'not-null' as any;
    await act(async () => {
      image = await result.current.uploadSingleImage(file);
    });

    expect(image).toBeNull();
    expect(mockPresignUploadFn).not.toHaveBeenCalled();
  });

  // ================================================================
  // 5. uploadSingleImage — compress > 2MB
  // ================================================================
  it('5. uploadSingleImage — compresses files > 2MB via image-conversion', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    const largeContent = 'x'.repeat(3 * 1024 * 1024); // ~3MB
    const largeFile = new File([largeContent], 'large.png', { type: 'image/png' });

    const { result } = renderHook(() => useImageUpload('node-1'));

    await act(async () => {
      await result.current.uploadSingleImage(largeFile);
    });

    expect(mockCompressAccuratelyFn).toHaveBeenCalled();
  });

  // ================================================================
  // 6. uploadSingleImage — cleanup temp URL
  // ================================================================
  it('6. uploadSingleImage — cleans up temp URL via revokeObjectURL after upload', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    const { result } = renderHook(() => useImageUpload('node-1'));
    const file = new File(['test'], 'test.png', { type: 'image/png' });

    await act(async () => {
      await result.current.uploadSingleImage(file);
    });

    // revokeObjectURL must be called after upload (success or failure)
    expect(mockRevokeObjectURLFn).toHaveBeenCalledWith('blob:mock-temp-url');
  });

  // ================================================================
  // 7. uploadBatchImages — concurrency limit 3
  // ================================================================
  it('7. uploadBatchImages — uploads with concurrency limit 3', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    let inFlight = 0;
    let maxInFlight = 0;

    mockAxiosPostFn.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield to allow other uploads to start
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight--;
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result } = renderHook(() => useImageUpload('node-1'));
    const files = Array.from(
      { length: 5 },
      (_, i) => new File(['x'], `f${i}.png`, { type: 'image/png' }),
    );

    let results: ImageItem[] = [];
    await act(async () => {
      results = await result.current.uploadBatchImages(files);
    });

    vi.useRealTimers();

    // All 5 files should be uploaded successfully
    expect(results).toHaveLength(5);
    expect(results.every((img) => img.status === 'success')).toBe(true);
    // Concurrency should not exceed 3
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  // ================================================================
  // 8. uploadBatchImages — truncates when exceeding maxCount
  // ================================================================
  it('8. uploadBatchImages — truncates when exceeding maxCount', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    const { result } = renderHook(() => useImageUpload('node-1'));
    const files = Array.from(
      { length: 5 },
      (_, i) => new File(['x'], `f${i}.png`, { type: 'image/png' }),
    );

    let results: ImageItem[] = [];
    await act(async () => {
      results = await result.current.uploadBatchImages(files, 2);
    });

    // Only 2 files uploaded (truncated from 5)
    expect(results).toHaveLength(2);
  });

  // ================================================================
  // 9. uploadBatchImages — single failure does not abort others
  // ================================================================
  it('9. uploadBatchImages — single failure does not abort other uploads', async () => {
    mockNodes['node-1'] = makeImageNode('node-1');

    // First upload fails at presign stage
    let callCount = 0;
    mockPresignUploadFn.mockImplementation(async (params: { fileName: string }) => {
      callCount++;
      if (callCount === 1) throw new Error('Upload failed');
      const id = `file-${callCount}`;
      return {
        fileId: id,
        uploadUrl: `http://minio/flowai/${id}`,
        key: `uploads/${id}/${params.fileName}`,
        fields: { key: `uploads/${id}/test.png`, Policy: 'x', 'X-Am-Signature': 'y' },
      };
    });

    const { result } = renderHook(() => useImageUpload('node-1'));
    const files = Array.from(
      { length: 3 },
      (_, i) => new File(['x'], `f${i}.png`, { type: 'image/png' }),
    );

    let results: ImageItem[] = [];
    await act(async () => {
      results = await result.current.uploadBatchImages(files);
    });

    // The failed upload is omitted; 2 succeed
    expect(results).toHaveLength(2);
    expect(results.every((img) => img.status === 'success')).toBe(true);

    // Error item was set in store for the failed file
    const lastCalls = mockUpdatePromptImagesFn.mock.calls.filter(
      (call: [string, ImageItem[]]) =>
        call[0] === 'node-1' && call[1].some((img) => img.status === 'error'),
    );
    expect(lastCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ================================================================
  // 4b. uploadSingleImage — video node MUST succeed (independent from image)
  // ================================================================
  it('4b. uploadSingleImage — works for videoGen nodes (not just imageGen)', async () => {
    mockNodes['vid-1'] = makeVideoNode('vid-1');

    const { result } = renderHook(() => useImageUpload('vid-1'));
    const file = new File(['video-ref'], 'frame.png', { type: 'image/png' });

    let image: ImageItem | null = null;
    await act(async () => {
      image = await result.current.uploadSingleImage(file);
    });

    expect(image).not.toBeNull();
    expect(image!.status).toBe('success');
    expect(image!.name).toBe('frame.png');

    // Store should have been updated via updatePromptImages
    const calls = mockUpdatePromptImagesFn.mock.calls.filter(
      (call: [string, ImageItem[]]) => call[0] === 'vid-1',
    );
    expect(calls.length).toBeGreaterThan(0);
  });

  // ================================================================
  // 10. deleteImage — removes from store and calls DELETE API
  // ================================================================
  it('10. deleteImage — removes from store and calls DELETE API', async () => {
    const existingImage: ImageItem = {
      id: 'img-1',
      url: '/api/storage/files/img-1',
      name: 'existing.png',
      status: 'success',
      progress: 100,
    };
    mockNodes['node-1'] = makeImageNode('node-1', [existingImage]);

    const { result } = renderHook(() => useImageUpload('node-1'));

    await act(async () => {
      await result.current.deleteImage('img-1');
    });

    // TD-15: prompt image removal is store-level only — no server DELETE (Media rows are library assets)
    expect(mockFetchFn).not.toHaveBeenCalledWith('/api/storage/files/img-1', { method: 'DELETE' });

    // updatePromptImages called with filtered list (empty)
    expect(mockUpdatePromptImagesFn).toHaveBeenCalled();
    const lastCall =
      mockUpdatePromptImagesFn.mock.calls[mockUpdatePromptImagesFn.mock.calls.length - 1] as [
        string,
        ImageItem[],
      ];
    expect(lastCall[0]).toBe('node-1');
    expect(lastCall[1]).toHaveLength(0);
  });

  // ================================================================
  // 11. uploadSingleImage — preserves existing root-level images (no overwrite)
  // ================================================================
  it('11. uploadSingleImage — preserves existing root-level allImages after upload', async () => {
    const existingImage: ImageItem = {
      id: 'img-existing',
      url: '/u/existing.png',
      name: 'existing.png',
      status: 'success',
      progress: 100,
    };
    mockNodes['vid-1'] = makeVideoNode('vid-1', [existingImage]);

    const { result } = renderHook(() => useImageUpload('vid-1'));
    const file = new File(['x'], 'new.png', { type: 'image/png' });

    await act(async () => {
      await result.current.uploadSingleImage(file);
    });

    const lastCall =
      mockUpdatePromptImagesFn.mock.calls[mockUpdatePromptImagesFn.mock.calls.length - 1] as [
        string,
        ImageItem[],
      ];
    const ids = lastCall[1].map((img) => img.id);
    expect(ids).toContain('img-existing');
    expect(ids).toContain('file-1');
    expect(lastCall[1]).toHaveLength(2);
  });

  // ================================================================
  // 12. deleteImage — filters from root-level data (keeps siblings)
  // ================================================================
  it('12. deleteImage — filters target from root-level allImages, keeps siblings', async () => {
    const imgA: ImageItem = { id: 'img-a', url: '/u/a.png', name: 'a.png', status: 'success' };
    const imgB: ImageItem = { id: 'img-b', url: '/u/b.png', name: 'b.png', status: 'success' };
    mockNodes['node-1'] = makeImageNode('node-1', [imgA, imgB]);

    const { result } = renderHook(() => useImageUpload('node-1'));

    await act(async () => {
      await result.current.deleteImage('img-a');
    });

    expect(mockFetchFn).not.toHaveBeenCalledWith('/api/storage/files/img-a', { method: 'DELETE' });

    const lastCall =
      mockUpdatePromptImagesFn.mock.calls[mockUpdatePromptImagesFn.mock.calls.length - 1] as [
        string,
        ImageItem[],
      ];
    expect(lastCall[0]).toBe('node-1');
    expect(lastCall[1]).toHaveLength(1);
    expect(lastCall[1][0].id).toBe('img-b');
  });
});
