import { memo, useRef, useCallback } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore, type ImageNodeData } from '@/stores/nodeStore';
import PromptInput, { type PromptInputRef } from './prompt-input/PromptInput';
import { ImageThumbnailBar } from './prompt-input/ImageThumbnailBar';
import { useImageUpload } from './prompt-input/useImageUpload';
import type { CommandItem } from './prompt-input/types';

interface Props {
  nodeId: string;
}

function ImageConfigPanelComponent({ nodeId }: Props) {
  // ── ALL hooks must be called before any conditional return ──
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);
  const { zoom } = useViewport();
  const promptRef = useRef<PromptInputRef>(null);
  const { uploadSingleImage } = useImageUpload(nodeId);

  const nodeData = (node?.type === 'image' ? node.data : undefined) as ImageNodeData | undefined;
  const model = nodeData?.model ?? 'sdxl';
  const ratio = nodeData?.ratio ?? '1:1';
  const quality = nodeData?.quality ?? 'standard';
  const status = nodeData?.status ?? 'idle';
  const prompt = nodeData?.prompt ?? { text: '', allImages: [], referencedImageIds: [] };

  const handleCommandSelect = useCallback((command: CommandItem) => {
    switch (command.category) {
      case 'model': updateConfig(nodeId, { model: command.value }); break;
      case 'ratio': updateConfig(nodeId, { ratio: command.value }); break;
      case 'quality': updateConfig(nodeId, { quality: command.value }); break;
    }
  }, [nodeId, updateConfig]);

  const handleGenerate = useCallback(async () => {
    promptRef.current?.forceSync();
    updateConfig(nodeId, { status: 'loading' });
    try {
      console.log('Generate:', { nodeId, prompt: prompt.text, model, ratio, quality });
    } catch (err) {
      console.error('[ImageConfigPanel] generate error:', err);
      updateConfig(nodeId, { status: 'error' });
    }
  }, [nodeId, updateConfig, prompt.text, model, ratio, quality]);

  const handlePasteImage = useCallback(async (file: File) => {
    if (prompt.allImages.length >= 9) return;
    const uploaded = await uploadSingleImage(file);
    if (uploaded) promptRef.current?.insertImage(uploaded.url);
  }, [prompt.allImages.length, uploadSingleImage]);

  // Conditional return AFTER all hooks
  if (!node || node.type !== 'image') return null;

  return (
    <div
      className="nodrag bg-[#222222] rounded-xl w-[650px] shadow-xl"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        border: '1px solid #3F3F46',
      }}
    >
      <div className="p-3 flex flex-col gap-3">
        {/* ImageThumbnailBar */}
        <ImageThumbnailBar
          nodeId={nodeId}
          images={prompt.allImages}
          onChange={(allImages) => updatePromptImages(nodeId, allImages)}
          onImageClick={(imageId) => {
            const img = prompt.allImages.find((i) => i.id === imageId);
            if (img) promptRef.current?.insertImage(img.url);
          }}
          onImageUploaded={(imageId) => {
            const img = prompt.allImages.find((i) => i.id === imageId);
            if (img) promptRef.current?.insertImage(img.url);
          }}
          disabled={status === 'loading'}
        />

        {/* PromptInput */}
        <PromptInput
          ref={promptRef}
          nodeId={nodeId}
          value={prompt}
          allImages={prompt.allImages}
          onPasteImage={handlePasteImage}
          onChange={(newPrompt) => updateConfig(nodeId, { prompt: newPrompt })}
          onCommandSelect={handleCommandSelect}
          onGenerate={handleGenerate}
          disabled={status === 'loading'}
        />

        {/* Settings bar */}
        <div className="flex items-center gap-4 text-[10px] text-[#888]">
          <span>{model}</span>
          <span>{ratio}</span>
          <span>{quality}</span>
        </div>

        {/* Generate button */}
        <div className="flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={status === 'loading' || !prompt.text.trim()}
            className="w-9 h-9 text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md transition-colors bg-[#4ade80] hover:bg-[#22c55e] shadow-[#4ade80]/30 disabled:bg-gray-500 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {status === 'loading' ? '⏳' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ImageConfigPanel = memo(ImageConfigPanelComponent);
