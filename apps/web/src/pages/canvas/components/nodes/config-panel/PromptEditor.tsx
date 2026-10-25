import { memo, useRef, useCallback } from 'react';
import PromptInput, { type PromptInputRef } from '../prompt-input/PromptInput';
import { ImageThumbnailBar } from '../prompt-input/ImageThumbnailBar';
import { useImageUpload } from '../prompt-input/useImageUpload';
import type { RichTextValue } from '@flowweb/shared';
import type { ImageItem } from '@/stores/nodeStore';

interface PromptEditorProps {
  nodeId: string;
  /** Y1c T16：ns 投影只读面（生成判据 .text/回退 html 渲染——PromptInput 编辑器直绑 doc
   *  XmlFragment 容器，value 不再驱动内容；onChange→updateConfig 整串写链路删除）。 */
  value?: RichTextValue;
  allImages: ImageItem[];
  /** 非域键配置变更回调（prompt 域键禁入——容器直绑，写=结构对抗面） */
  onChange?: (prompt: RichTextValue) => void;
  onAllImagesChange: (allImages: ImageItem[]) => void;
  onGenerate: () => void;
  disabled?: boolean;
  maxHeight: number;
}

function PromptEditorComponent({ nodeId, value, allImages, onChange: _onChange, onAllImagesChange, onGenerate, disabled, maxHeight }: PromptEditorProps) {
  const promptRef = useRef<PromptInputRef>(null);
  const { uploadSingleImage } = useImageUpload(nodeId);

  // 修正批#1（Y1c T16）：插入锚=mediaId（ImageItem.id）——受控 URL 解析在 NodeView
  const handlePasteImage = useCallback(async (file: File) => {
    if (allImages.length >= 9) return;
    const uploaded = await uploadSingleImage(file);
    if (uploaded) promptRef.current?.insertImage(uploaded.id);
  }, [allImages.length, uploadSingleImage]);

  return (
    <>
      <ImageThumbnailBar
        nodeId={nodeId}
        images={allImages}
        onChange={onAllImagesChange}
        onImageClick={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.insertImage(img.id);
        }}
        onImageUploaded={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.insertImage(img.id);
        }}
        onBeforeImageDelete={(imageId) => {
          const img = allImages.find((i) => i.id === imageId);
          if (img) promptRef.current?.removeImage(img.id);
        }}
        disabled={disabled}
      />
      <PromptInput
        ref={promptRef}
        nodeId={nodeId}
        allImages={allImages}
        onPasteImage={handlePasteImage}
        onGenerate={onGenerate}
        disabled={disabled}
        maxHeight={maxHeight}
        fallbackHtml={value?.html || ''}
      />
    </>
  );
}

export const PromptEditor = memo(PromptEditorComponent);
