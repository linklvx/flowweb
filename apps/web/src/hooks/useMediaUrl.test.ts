import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMediaUrl } from './useMediaUrl';

// Mock apiFetch
vi.mock('@/api/client', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/api/client';

describe('useMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null url and loading=false when fileId is null', () => {
    const { result } = renderHook(() => useMediaUrl(null));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch URL and return it', async () => {
    (apiFetch as any).mockResolvedValueOnce({ url: 'http://minio/path?X-Amz=...' });
    const { result } = renderHook(() => useMediaUrl('file-1'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.url).toBe('http://minio/path?X-Amz=...');
    expect(result.current.error).toBeNull();
  });

  it('should set error on fetch failure', async () => {
    (apiFetch as any).mockRejectedValueOnce(new Error('Not found'));
    const { result } = renderHook(() => useMediaUrl('file-2'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.url).toBeNull();
  });

  it('should handle undefined fileId same as null', () => {
    const { result } = renderHook(() => useMediaUrl(undefined));
    expect(result.current.url).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
