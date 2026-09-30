import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { message } from 'antd';
import { useNodeStore, isImageExtNode } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { newIntentId, currentIntentId, intentRotateMessage } from '@/utils/intentRecord';
import { ModelSelector } from './config-panel/ModelSelector';
import type { ModelInfo } from './config-panel/ModelSelector';
import { RatioResolutionPopover } from './config-panel/RatioResolutionPopover';
import type { RatioOption } from './config-panel/RatioResolutionPopover';
import { GenerateCountSelector } from './config-panel/GenerateCountSelector';
import { CreditDisplay } from './config-panel/CreditDisplay';
import { RunButton } from './config-panel/RunButton';
import { PromptEditor } from './config-panel/PromptEditor';
import { useImageExtConfig } from './hooks/useImageExtConfig';
import * as imageExtNodeApi from '@/api/imageExtNodeApi';
import { AI_TOOL_GROUPS } from './ai/aiToolConfig';

const RATIO_OPTIONS: RatioOption[] = [
  { label: '1:1', w: 12, h: 12 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '3:4', w: 9, h: 12 },
  { label: '4:3', w: 12, h: 9 },
  { label: '3:2', w: 12, h: 8 },
  { label: '2:3', w: 9, h: 12 },
];

const POPUP_BASE_CLASS = 'absolute bottom-full mb-2 z-[300] rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]';
const POPUP_BASE_STYLE: React.CSSProperties = {
  backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)',
  backdropFilter: 'blur(32px)',
};

interface Props {
  nodeId: string;
}

function ImageExtConfigPanelComponent({ nodeId }: Props) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);
  const setStatus = useNodeStore((s) => s.setStatus);
  const { zoom } = useViewport();
  const { extConfig, updateExtConfig } = useImageExtConfig(nodeId);

  const nodeData = isImageExtNode(node) ? node.data : undefined;
  const status = nodeData?.status ?? 'idle';
  const prompt = nodeData?.prompt ?? { text: '', html: '' };
  const allImages = nodeData?.allImages ?? [];
  const aiTool = nodeData?.aiTool;

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [aiToolOpen, setAiToolOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const aiToolBtnRef = useRef<HTMLDivElement>(null);
  // 批0.5-8b：上次提交的意图态——失败重试复用同 intentId（表命中不双扣），新点击 rotate 新 id
  const lastSubmitRef = useRef<{ intentId: string; failed: boolean } | null>(null);

  const selectedAiToolName = aiTool
    ? AI_TOOL_GROUPS.flatMap(g => g.items).find(t => t.id === aiTool)?.name ?? 'AI 工具'
    : 'AI 工具';

  const checkPopupBounds = useCallback(() => {
    if (!popupRef.current) return;
    popupRef.current.style.left = '0';
    popupRef.current.style.right = 'auto';
    requestAnimationFrame(() => {
      if (!popupRef.current) return;
      const rect = popupRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        popupRef.current.style.left = 'auto';
        popupRef.current.style.right = '0';
      }
    });
  }, []);

  useEffect(() => {
    if (!aiToolOpen) return;
    const handler = (e: MouseEvent) => {
      if (aiToolBtnRef.current?.contains(e.target as Node)) return;
      setAiToolOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [aiToolOpen]);

  useEffect(() => {
    if (!aiToolOpen) return;
    checkPopupBounds();
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(checkPopupBounds, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, [aiToolOpen, checkPopupBounds]);

  // Load ext models
  useEffect(() => {
    imageExtNodeApi.fetchModels().then((list) => {
      setModels(list);
      if (!extConfig.model && list.length > 0) {
        updateExtConfig({ model: list[0].id });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate price
  useEffect(() => {
    if (extConfig.model) {
      imageExtNodeApi.getCreditCost(extConfig.model).then(setCreditCost).catch(() => setCreditCost(0));
    }
  }, [extConfig.model]);

  const handleGenerate = useCallback(async () => {
    if (!nodeData?.prompt?.text?.trim()) return;
    setExecuting(true);
    setStatus(nodeId, 'loading');
    const projectId = useCanvasStore.getState().projectId;
    let intentId = '';
    try {
      if (!projectId) return;
      // 批0.5-8b：意图 id 上送（幂等键）——上次失败复用（服务端表命中不双扣），否则 rotate 新 id
      intentId = lastSubmitRef.current?.failed
        ? currentIntentId(projectId, nodeId)
        : newIntentId(projectId, nodeId);
      await imageExtNodeApi.submitGeneration(nodeId, { projectId, intentId });
      lastSubmitRef.current = { intentId, failed: false };
    } catch (err: any) {
      // 批0.5-8c：rotate 值得错误（额度尽/改参撞旧 id）——rotate 新意图 + 明确提示（复用旧 id 只会再 409）
      const rotateMsg = intentRotateMessage(err?.errorCode);
      if (rotateMsg && projectId) {
        newIntentId(projectId, nodeId);
        lastSubmitRef.current = null;
        message.warning(rotateMsg);
      } else if (intentId) {
        // 标记失败态——下次点击复用同 intentId 重试（表命中不双扣）
        lastSubmitRef.current = { intentId, failed: true };
      }
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus, nodeData]);

  if (!isImageExtNode(node)) return null;

  return (
    <div
      className="nodrag bg-[var(--canvas-controls-bg)] rounded-xl w-[650px] shadow-xl relative"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        border: '1px solid var(--canvas-controls-border)',
      }}
    >
      <button
        type="button"
        className="absolute top-2 right-2 shrink-0 focus:outline-none p-1 text-text-dim-3 shadow-none outline-none"
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
          value={{ text: prompt.text || '', html: prompt.html || '', referencedImageIds: [] }}
          allImages={allImages}
          onChange={(newPrompt) => updateConfig(nodeId, { prompt: { text: newPrompt.text, html: newPrompt.html, referencedImageIds: [] } })}
          onAllImagesChange={(images) => updatePromptImages(nodeId, images)}
          onGenerate={handleGenerate}
          disabled={status === 'loading'}
          maxHeight={maximized ? 350 : 80}
        />

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <ModelSelector
              models={models}
              selectedId={extConfig.model}
              onSelect={(modelId) => updateExtConfig({ model: modelId })}
            />
            <div className="w-px h-4 bg-overlay-2 shrink-0" />
            <RatioResolutionPopover
              ratioOptions={RATIO_OPTIONS}
              ratio={extConfig.ratio || '16:9'}
              resolution={extConfig.resolution || '2K'}
              onRatioChange={(ratio) => updateExtConfig({ ratio })}
              onResolutionChange={(resolution) => updateExtConfig({ resolution })}
            />
            <div className="relative" ref={aiToolBtnRef}>
              <button
                type="button"
                data-testid="canvas-node-image-ai-tool-select"
                onClick={(e) => {
                  e.stopPropagation();
                  setAiToolOpen((v) => !v);
                }}
                disabled={status === 'loading'}
                className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-overlay-2 active:bg-overlay-2 px-2 py-1 text-sm rounded-lg text-[#f5f5f5]"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                  <path d="M8 1.5a.75.75 0 01.75.75v1.19l1.22-.7a.75.75 0 11.75 1.3L9.5 4.73v1.54l1.22.7a.75.75 0 11-.75 1.3L8.75 7.56v.69a.75.75 0 01-1.5 0v-.69l-1.22.7a.75.75 0 11-.75-1.3L6.5 6.27V4.73l-1.22-.7a.75.75 0 11.75-1.3l1.22.7V2.25A.75.75 0 018 1.5z" fill="currentColor"/>
                  <path d="M2 11a3 3 0 013-3h6a3 3 0 013 3v1a1 1 0 01-1 1H3a1 1 0 01-1-1v-1z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
                  <circle cx="6.5" cy="12" r="0.5" fill="currentColor"/>
                  <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
                  <circle cx="9.5" cy="12" r="0.5" fill="currentColor"/>
                </svg>
                <span className="whitespace-nowrap text-xs">{selectedAiToolName}</span>
              </button>
              {aiToolOpen && (
                <div
                  ref={popupRef}
                  className={`${POPUP_BASE_CLASS} left-0 w-[680px] max-w-[calc(100vw-16px)] p-3`}
                  style={POPUP_BASE_STYLE}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {(() => {
                    const flatItems = AI_TOOL_GROUPS.map((g) => ({ group: g }));
                    const totalWeight = flatItems.reduce((sum, item) => sum + item.group.items.length + 1, 0);
                    const perCol = Math.ceil(totalWeight / 3);
                    const cols: typeof flatItems[] = [[], [], []];
                    let colIdx = 0;
                    let colWeight = 0;
                    flatItems.forEach((item) => {
                      const w = item.group.items.length + 1;
                      if (colWeight > 0 && colWeight + w > perCol && colIdx < 2) {
                        colIdx++;
                        colWeight = 0;
                      }
                      cols[colIdx].push(item);
                      colWeight += w;
                    });
                    return (
                      <div className="flex gap-3">
                        {cols.map((col, ci) => (
                          <div key={ci} className="flex-1 flex flex-col gap-1">
                            {col.map((item) => (
                              <div key={item.group.groupName} className="flex flex-col gap-0.5">
                                <div className="px-2 py-1">
                                  <span className="text-[#999] text-xs font-medium">{item.group.groupName}</span>
                                </div>
                                {item.group.items.map((tool) => (
                                  <button
                                    key={tool.id}
                                    type="button"
                                    onClick={() => {
                                      updateConfig(nodeId, { aiTool: tool.id });
                                      setAiToolOpen(false);
                                    }}
                                    className={`group flex h-[52px] w-full items-center gap-2 rounded-xl p-2 text-left transition-colors duration-200 bg-transparent ${
                                      aiTool === tool.id
                                        ? 'bg-overlay-2 text-[#f5f5f5]'
                                        : 'text-[#999] hover:bg-overlay-1'
                                    }`}
                                  >
                                    <div className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-overlay-1">
                                      {tool.icon}
                                      {tool.isNew && (
                                        <span className="pointer-events-none absolute right-[3px] top-[3px] size-1.5 rounded-full bg-[#5DDCFF] border border-[#1a1a1a]" />
                                      )}
                                    </div>
                                    <div className="flex flex-col justify-center overflow-hidden">
                                      <span className="text-sm font-medium truncate">{tool.name}</span>
                                      <span className="mt-0.5 text-xs leading-4 text-[#999] opacity-0 group-hover:opacity-60 transition-opacity duration-200">{tool.desc}</span>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <GenerateCountSelector
              count={extConfig.generateCount ?? 1}
              onChange={(count) => updateExtConfig({ generateCount: count })}
              disabled={status === 'loading'}
            />
            <div className="w-px h-4 bg-overlay-2 shrink-0" />
            <CreditDisplay cost={creditCost} />
            <RunButton loading={executing} onClick={handleGenerate} disabled={status === 'loading'} />
          </div>
        </div>
      </div>
    </div>
  );
}

export const ImageExtConfigPanel = memo(ImageExtConfigPanelComponent);
