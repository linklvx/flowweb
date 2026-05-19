import { useState, useRef, useCallback } from 'react';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

interface FileUploadProps {
  onUploadComplete: (fileId: string) => void;
  accept: string;
  hint?: string;
}

export function FileUpload({ onUploadComplete, accept, hint }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      // 1. Get presigned POST URL
      const { fileId, uploadUrl, key, fields } = await presignUpload({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        type: 'uploaded',
      });

      // 2. Build FormData and upload to MinIO (via Vite proxy to avoid CORS)
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);

      // Rewrite presigned URL through Vite proxy to avoid CORS issues
      const proxyUrl = import.meta.env.DEV
        ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
        : uploadUrl;

      await axios.post(proxyUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });

      // 3. Confirm upload
      await confirmUpload({ fileId, key, fileSize: file.size });

      onUploadComplete(fileId);
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete]);

  return (
    <div>
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        style={{
          border: '1px dashed #3F3F46',
          borderRadius: '8px',
          padding: '24px 12px',
          textAlign: 'center',
          cursor: 'pointer',
          background: '#222222',
          opacity: uploading ? 0.5 : 1,
          pointerEvents: uploading ? 'none' : 'auto',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {uploading ? (
          <div>
            <div style={{ color: '#f59e0b', fontSize: '12px', marginBottom: '4px' }}>
              上传中 {progress}%
            </div>
            <div style={{ height: '3px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#4ade80', transition: 'width 0.2s' }} />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>📁</div>
            <div style={{ color: '#9CA3AF', fontSize: '12px' }}>点击或拖拽上传</div>
            {hint && <div style={{ color: '#666', fontSize: '10px', marginTop: '4px' }}>{hint}</div>}
          </div>
        )}
      </div>
      {error && (
        <div style={{ color: '#f87171', fontSize: '11px', marginTop: '4px' }}>{error}</div>
      )}
    </div>
  );
}
