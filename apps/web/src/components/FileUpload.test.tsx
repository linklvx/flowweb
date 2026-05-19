import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileUpload } from './FileUpload';

// Mock storageApi
vi.mock('@/api/storageApi', () => ({
  presignUpload: vi.fn().mockResolvedValue({
    fileId: 'file-1',
    uploadUrl: 'http://minio:9000/flowai',
    key: 'uploads/u1/2026-05-20/test.png',
    fields: { key: 'uploads/u1/2026-05-20/test.png', Policy: 'p', 'X-Amz-Signature': 's' },
  }),
  confirmUpload: vi.fn().mockResolvedValue({ fileId: 'file-1' }),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ status: 200 }),
  },
}));

import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

describe('FileUpload', () => {
  const onUploadComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render upload area with placeholder', () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" />);
    expect(screen.getByText(/点击或拖拽上传/i)).toBeInTheDocument();
  });

  it('should call onUploadComplete with fileId after successful upload', async () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" />);

    const file = new File(['test'], 'test.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUploadComplete).toHaveBeenCalledWith('file-1');
    });

    expect(presignUpload).toHaveBeenCalledWith({
      fileName: 'test.png',
      fileSize: file.size,
      fileType: 'image/png',
      type: 'uploaded',
    });

    expect(confirmUpload).toHaveBeenCalledWith({
      fileId: 'file-1',
      key: 'uploads/u1/2026-05-20/test.png',
      fileSize: file.size,
    });
  });

  it('should show format hint when provided', () => {
    render(<FileUpload onUploadComplete={onUploadComplete} accept="image/*" hint="PNG/JPG 20MB" />);
    expect(screen.getByText('PNG/JPG 20MB')).toBeInTheDocument();
  });
});
