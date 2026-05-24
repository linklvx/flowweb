import { useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import axios from 'axios';

interface Props {
  nodeId: string;
}

function SortableImageItem({ id, img, nodeId }: { id: string; img: any; index: number; nodeId: string }) {
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);
  const nodeData = useNodeStore((s) => s.nodes[nodeId]?.data) as any;
  const images: any[] = nodeData?.images ?? [];

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const currentIndex = images.findIndex((img2: any) => img2.id === id);

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="nodrag flex items-center gap-2 text-xs text-[#999] cursor-grab active:cursor-grabbing">
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
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const newImages = images.filter((_: any, j: number) => j !== currentIndex);
          updateMultiImageImages(nodeId, newImages);
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function MultiImageConfigPanel({ nodeId }: Props) {
  const zoom = useViewport().zoom;
  const nodeData = useNodeStore((s) => s.nodes[nodeId]?.data) as any;
  const updateMultiImageImages = useNodeStore((s) => s.updateMultiImageImages);

  const images: any[] = nodeData?.images ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = images.findIndex((img: any) => img.id === active.id);
    const newIndex = images.findIndex((img: any) => img.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newImages = arrayMove(images, oldIndex, newIndex);
    updateMultiImageImages(nodeId, newImages);

    // 主图索引联动调整（Spec §9.2 要求）
    const mainImageIndex = nodeData?.mainImageIndex ?? 0;
    const setMainImageIndex = useNodeStore.getState().setMainImageIndex;

    if (oldIndex === mainImageIndex) {
      setMainImageIndex(nodeId, newIndex);
    } else if (oldIndex < mainImageIndex && newIndex >= mainImageIndex) {
      setMainImageIndex(nodeId, mainImageIndex - 1);
    } else if (oldIndex > mainImageIndex && newIndex <= mainImageIndex) {
      setMainImageIndex(nodeId, mainImageIndex + 1);
    }
  };

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={images.map((img: any) => img.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {images.map((img: any, i: number) => (
                <SortableImageItem key={img.id} id={img.id} img={img} index={i} nodeId={nodeId} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
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
