import { memo, useRef, useCallback } from 'react';
import PromptInput, { type PromptInputRef } from '../prompt-input/PromptInput';
import { ImageThumbnailBar } from '../prompt-input/ImageThumbnailBar';
import { useImageUpload } from '../prompt-input/useImageUpload';
import type { PromptValue, ImageItem } from '@/stores/nodeStore';

interface PromptEditorProps {
  nodeId: string;
  value: PromptValue;
  allImages: ImageItem[];
  onChange: (prompt: PromptValue) => void;
  onAllImagesChange: (allImages: ImageItem[]) => void;
  onGenerate: () => void;
  disabled?: boolean;
  maxHeight: number;
}

function PromptEditorComponent({ nodeId, value, allImages, onChange, onAllImagesChange, onGenerate, disabled, maxHeight }: PromptEditorProps) {
  const promptRef = useRef<PromptInputRef>(null);
  const { uploadSingleImage } = useImageUpload(nodeId);

  const handlePasteImage = useCallback(async (file: File) => {
    if (allImages.length >= 9) return;
    const uploaded = await uploadSingleImage(file);
    if (uploaded) promptRef.current?.insertImage(uploaded.url);
  }, [allImages.length, uploadSingleImage]);

  return (
    <>
      <ImageThumbnailBar
        nodeId={nodeId}
        images={allImages}
        onChange={onAllImagesChange}
        onImageClick={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.insertImage(img.url);
        }}
        onImageUploaded={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.insertImage(img.url);
        }}
        onBeforeImageDelete={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.removeImage(img.url);
        }}
        disabled={disabled}
      />
      <PromptInput
        ref={promptRef}
        nodeId={nodeId}
        value={value}
        allImages={allImages}
        onPasteImage={handlePasteImage}
        onChange={onChange}
        onGenerate={onGenerate}
        disabled={disabled}
        maxHeight={maxHeight}
      />
    </>
  );
}

export const PromptEditor = memo(PromptEditorComponent);
