import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore, isImageNode } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { ModelSelector } from './config-panel/ModelSelector';
import type { ModelInfo } from './config-panel/ModelSelector';
import { RatioResolutionPopover } from './config-panel/RatioResolutionPopover';
import type { RatioOption } from './config-panel/RatioResolutionPopover';
import { GenerateCountSelector } from './config-panel/GenerateCountSelector';
import { CreditDisplay } from './config-panel/CreditDisplay';
import { RunButton } from './config-panel/RunButton';
import { PromptEditor } from './config-panel/PromptEditor';
import * as imageNodeApi from '@/api/imageNodeApi';
import { syncNodes, syncEdges } from '@/api/projectApi';

interface Props {
  nodeId: string;
}

const RATIO_OPTIONS: RatioOption[] = [
  { label: '1:1', w: 12, h: 12 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '3:4', w: 9, h: 12 },
  { label: '4:3', w: 12, h: 9 },
  { label: '3:2', w: 12, h: 8 },
  { label: '2:3', w: 9, h: 12 },
];

function ImageConfigPanelComponent({ nodeId }: Props) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);
  const setStatus = useNodeStore((s) => s.setStatus);
  const { zoom } = useViewport();

  const nodeData = isImageNode(node) ? node.data : undefined;
  const model = nodeData?.model ?? 'sdxl';
  const ratio = nodeData?.ratio ?? '16:9';
  const resolution = nodeData?.resolution ?? '2K';
  const quality = nodeData?.quality ?? 'standard';
  const status = nodeData?.status ?? 'idle';
  const prompt = nodeData?.prompt ?? { text: '', html: '' };
  const allImages = nodeData?.allImages ?? [];

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);

  // Load image models
  useEffect(() => {
    imageNodeApi.fetchModels().then((list) => {
      setModels(list);
      if (!nodeData?.model && list.length > 0) {
        const store = useNodeStore.getState();
        const existing = store.nodes[nodeId] as any;
        useNodeStore.setState({
          nodes: { ...store.nodes, [nodeId]: { ...existing, data: { ...existing?.data, model: list[0].id } } },
        });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate price
  useEffect(() => {
    if (model) {
      imageNodeApi.getCreditCost(model).then(setCreditCost).catch(() => setCreditCost(0));
    }
  }, [model]);

  const handleGenerate = useCallback(async () => {
    if (!nodeData?.prompt?.text?.trim()) return;
    setExecuting(true);
    setStatus(nodeId, 'loading');
    try {
      const canvasState = useCanvasStore.getState();
      const nodeState = useNodeStore.getState();
      const mergedNodes = canvasState.nodes.map((n) => ({
        id: n.id,
        type: n.type || 'imageGen',
        position: n.position,
        data: nodeState.nodes[n.id]?.data || (n.data as any) || {},
        width: n.width,
        height: n.height,
      }));
      const projectId = canvasState.projectId ?? 'default';
      await Promise.all([
        syncNodes(projectId, mergedNodes),
        syncEdges(projectId, canvasState.edges),
      ]);
      await imageNodeApi.submitGeneration(nodeId, { projectId });
    } catch {
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus, nodeData]);

  if (!isImageNode(node)) return null;

  return (
    <div
      className="nodrag bg-[#222222] rounded-xl w-[650px] shadow-xl relative"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        border: '1px solid #3F3F46',
      }}
    >
      {/* Maximize / Restore button — top-right corner */}
      <button
        type="button"
        className="absolute top-2 right-2 shrink-0 focus:outline-none cursor-pointer p-1 bg-transparent text-white/60 border-none shadow-none outline-none"
        data-testid="canvas-node-generation-input-bar-maximize-button"
        data-state={maximized ? 'open' : 'closed'}
        onClick={() => setMaximized((v) => !v)}
      >
        {maximized ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.9811 2.31442C13.1763 2.11915 13.4928 2.11915 13.6881 2.31442C13.8834 2.50968 13.8834 2.82618 13.6881 3.02145L10.5416 6.16793H12.0013C12.2774 6.16793 12.5013 6.39179 12.5013 6.66793C12.5013 6.94407 12.2774 7.16793 12.0013 7.16793H9.3346C9.05845 7.16793 8.8346 6.94407 8.8346 6.66793V4.00126C8.8346 3.72512 9.05845 3.50126 9.3346 3.50126C9.61074 3.50126 9.8346 3.72512 9.8346 4.00126V5.4609L12.9811 2.31442ZM7.16793 12.0013C7.16793 12.2774 6.94407 12.5013 6.66793 12.5013C6.39179 12.5013 6.16793 12.2774 6.16793 12.0013V10.5416L3.02145 13.6881C2.82618 13.8834 2.50968 13.8834 2.31442 13.6881C2.11915 13.4928 2.11915 13.1763 2.31442 12.9811L5.4609 9.8346H4.00126C3.72512 9.8346 3.50126 9.61074 3.50126 9.3346C3.50126 9.05845 3.72512 8.8346 4.00126 8.8346H6.66793C6.94407 8.8346 7.16793 9.05845 7.16793 9.3346V12.0013Z" fill="currentColor" fillOpacity="0.9" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M6.47949 8.81348C6.67475 8.61821 6.99126 8.61821 7.18652 8.81348C7.38179 9.00874 7.38179 9.32525 7.18652 9.52051L3.95703 12.75H6.25C6.52614 12.75 6.75 12.9739 6.75 13.25C6.75 13.5261 6.52614 13.75 6.25 13.75H2.75C2.47386 13.75 2.25 13.5261 2.25 13.25V9.75C2.25 9.47386 2.47386 9.25 2.75 9.25C3.02614 9.25 3.25 9.47386 3.25 9.75V12.043L6.47949 8.81348ZM13.25 2.25C13.5261 2.25 13.75 2.47386 13.75 2.75V6.25C13.75 6.52614 13.5261 6.75 13.25 6.75C12.9739 6.75 12.75 6.52614 12.75 6.25V3.95703L9.52051 7.18652C9.32525 7.38179 9.00874 7.38179 8.81348 7.18652C8.61821 6.99126 8.61821 6.67475 8.81348 6.47949L12.043 3.25H9.75C9.47386 3.25 9.25 3.02614 9.25 2.75C9.25 2.47386 9.47386 2.25 9.75 2.25H13.25Z" fill="currentColor" fillOpacity="0.9" />
          </svg>
        )}
      </button>

      <div className="p-3 flex flex-col gap-0">
        <PromptEditor
          nodeId={nodeId}
          value={{ text: prompt.text || '', html: prompt.html || '', allImages, referencedImageIds: [] }}
          allImages={allImages}
          onChange={(newPrompt) => updateConfig(nodeId, { prompt: { text: newPrompt.text, html: newPrompt.html, allImages: [], referencedImageIds: [] } })}
          onAllImagesChange={(images) => updatePromptImages(nodeId, images)}
          onGenerate={handleGenerate}
          disabled={status === 'loading'}
          maxHeight={maximized ? 350 : 80}
        />

        {/* Bottom bar: Model (left) + Credits + Execute (right) */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <ModelSelector
              models={models}
              selectedId={model}
              onSelect={(modelId) => updateConfig(nodeId, { model: modelId } as any)}
            />
            <div className="w-px h-4 bg-white/10 shrink-0" />
            <RatioResolutionPopover
              ratioOptions={RATIO_OPTIONS}
              ratio={ratio}
              resolution={resolution}
              onRatioChange={(r) => updateConfig(nodeId, { ratio: r } as any)}
              onResolutionChange={(r) => updateConfig(nodeId, { resolution: r } as any)}
            />
          </div>
          <div className="flex items-center gap-3">
            <GenerateCountSelector
              count={generateCount}
              onChange={setGenerateCount}
              disabled={status === 'loading'}
            />
            <div className="w-px h-4 bg-white/10 shrink-0" />
            <CreditDisplay cost={creditCost} />
            <RunButton loading={executing} onClick={handleGenerate} disabled={status === 'loading'} />
          </div>
        </div>
      </div>
    </div>
  );
}

export const ImageConfigPanel = memo(ImageConfigPanelComponent);
