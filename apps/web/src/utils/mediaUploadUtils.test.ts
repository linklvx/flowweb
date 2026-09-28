import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadImageBlob } from './mediaUploadUtils';

// ── Mocks ─────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  presignUpload: vi.fn(),
  confirmUpload: vi.fn(),
  getMediaUrl: vi.fn(),
  axiosPost: vi.fn(),
}));

vi.mock('@/api/storageApi', () => ({
  presignUpload: mocks.presignUpload,
  confirmUpload: mocks.confirmUpload,
}));

vi.mock('@/api/mediaApi', () => ({
  getMediaUrl: mocks.getMediaUrl,
}));

vi.mock('axios', () => ({
  default: { post: (...args: unknown[]) => mocks.axiosPost(...args) },
}));

// ── Helpers ───────────────────────────────────────────────

function setupMocks() {
  mocks.presignUpload.mockResolvedValue({
    fileId: 'file-123',
    uploadUrl: 'http://minio:9000/flowai/uploads/test.jpg',
    key: 'uploads/user1/2026/test.jpg',
    fields: { Policy: '...', Signature: '...', 'x-amz-credential': '...' },
  });
  mocks.confirmUpload.mockResolvedValue({ fileId: 'file-123' });
  mocks.getMediaUrl.mockResolvedValue({ url: 'https://cdn.example.com/frames/file-123.jpg', ttlSec: 900 });
  mocks.axiosPost.mockResolvedValue({ status: 200 });
}

// ── Tests ─────────────────────────────────────────────────

describe('mediaUploadUtils', () => {
  describe('uploadImageBlob', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      setupMocks();
    });

    it('should upload blob and return url + fileId', async () => {
      const blob = new Blob(['test-frame-data'], { type: 'image/jpeg' });

      const result = await uploadImageBlob(blob);

      expect(result).toEqual({
        url: 'https://cdn.example.com/frames/file-123.jpg',
        fileId: 'file-123',
      });

      // Verify call chain: presign → post → confirm → getMediaUrl
      expect(mocks.presignUpload).toHaveBeenCalledTimes(1);
      expect(mocks.presignUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSize: blob.size,
          fileType: 'image/jpeg',
          type: 'uploaded',
        }),
      );

      expect(mocks.axiosPost).toHaveBeenCalledTimes(1);

      expect(mocks.confirmUpload).toHaveBeenCalledTimes(1);
      expect(mocks.confirmUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-123',
          key: 'uploads/user1/2026/test.jpg',
          fileSize: blob.size,
        }),
      );

      expect(mocks.getMediaUrl).toHaveBeenCalledWith('file-123');
    });

    it('should generate unique filenames with timestamp + random string', async () => {
      const blob = new Blob(['data'], { type: 'image/jpeg' });

      await uploadImageBlob(blob);
      const firstCall = mocks.presignUpload.mock.calls[0][0];

      vi.clearAllMocks();
      setupMocks();

      // Fast-forward time slightly to get a different filename
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 100);
      await uploadImageBlob(blob);
      const secondCall = mocks.presignUpload.mock.calls[0][0];

      expect(firstCall.fileName).toMatch(/^frame_\d+_[a-z0-9]{8}\.jpg$/);
      expect(secondCall.fileName).toMatch(/^frame_\d+_[a-z0-9]{8}\.jpg$/);
      expect(firstCall.fileName).not.toBe(secondCall.fileName);

      vi.useRealTimers();
    });

    it('should throw when presignUpload fails', async () => {
      mocks.presignUpload.mockRejectedValue(new Error('Network error'));
      const blob = new Blob(['data'], { type: 'image/jpeg' });

      await expect(uploadImageBlob(blob)).rejects.toThrow('Network error');
      expect(mocks.confirmUpload).not.toHaveBeenCalled();
    });

    it('should throw when upload POST fails', async () => {
      mocks.axiosPost.mockRejectedValue(new Error('Upload failed'));
      const blob = new Blob(['data'], { type: 'image/jpeg' });

      await expect(uploadImageBlob(blob)).rejects.toThrow('Upload failed');
      expect(mocks.confirmUpload).not.toHaveBeenCalled();
    });

    it('should pass projectId through to presignUpload', async () => {
      const blob = new Blob(['x'], { type: 'image/jpeg' });

      await uploadImageBlob(blob, 'p1');

      expect(mocks.presignUpload).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1' }),
      );
    });
  });
});
