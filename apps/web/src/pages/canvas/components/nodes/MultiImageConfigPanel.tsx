import { useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import axios from 'axios';

interface Props {
  nodeId: string;
}

export function MultiImageConfigPanel({ nodeId }: Props) {
  const zoom = useViewport().zoom;
  const nodeData = useNodeStore((s) => s.nodes[nodeId]?.data) as any;
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);

  const images: any[] = nodeData?.images ?? [];

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList) => {
    const fileArray = Array.from(files);
    const maxCount = 9;
    const currentCount = images.length;
    const toUpload = fileArray.slice(0, maxCount - currentCount);
    if (currentCount + fileArray.length > maxCount) {
      alert(`最多支持上传${maxCount}张图片`);
    }

    const newImages = [...images];
    for (const file of toUpload) {
      try {
        const { fileId, uploadUrl, key, fields } = await presignUpload({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          type: 'uploaded',
        });
        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
        formData.append('file', file);
        const proxyUrl = import.meta.env.DEV
          ? uploadUrl.replace(/^http:\/\/[^/]+\/flowai/, '/minio-storage')
          : uploadUrl;
        await axios.post(proxyUrl, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        await confirmUpload({ fileId, key, fileSize: file.size });
        newImages.push({ id: fileId, url: '', name: file.name, status: 'success' as const });
      } catch (err: any) {
        console.error('[MultiImageConfigPanel] upload error:', err.message);
      }
    }
    updateMultiImageImages(nodeId, newImages);
  };

  return (
    <div
      className="nodrag nopan flex flex-col gap-2 p-3 rounded-lg"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        backgroundColor: '#222222',
        border: '1px solid #3F3F46',
        minWidth: 240,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) handleUpload(files);
          e.target.value = '';
        }}
      />

      <button
        className="flex items-center gap-1.5 text-[#ccc] text-xs hover:text-white transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" />
          <path d="M7 9l5 -5l5 5" />
          <path d="M12 4l0 12" />
        </svg>
        上传图片
      </button>

      {images.length > 0 && (
        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
          {images.map((img: any, i: number) => (
            <div key={img.id} className="flex items-center gap-2 text-xs text-[#999]">
              <div className="w-8 h-8 rounded bg-[#1a1a2e] flex items-center justify-center overflow-hidden shrink-0">
                <img
                  src={img.url || `/api/media/${img.id}`}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <span className="truncate flex-1">{img.name}</span>
              <button
                className="text-[#666] hover:text-red-400 shrink-0"
                onClick={() => {
                  const newImages = images.filter((_: any, j: number) => j !== i);
                  updateMultiImageImages(nodeId, newImages);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <button
          className="text-xs text-[#666] hover:text-red-400 transition-colors text-left"
          onClick={() => {
            if (window.confirm('确定清空全部图片？')) {
              updateMultiImageImages(nodeId, []);
            }
          }}
        >
          清空全部
        </button>
      )}
    </div>
  );
}
