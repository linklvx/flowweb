import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { useViewport } from '@xyflow/react';
import { message } from 'antd';
import { useNodeStore, type VideoNodeData } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import PromptInput, { type PromptInputRef } from './prompt-input/PromptInput';
import { ImageThumbnailBar } from './prompt-input/ImageThumbnailBar';
import { useImageUpload } from './prompt-input/useImageUpload';
import { enqueueWorkflow } from '@/api/executionApi';
import { newIntentId, currentIntentId, intentRotateMessage } from '@/utils/intentRecord';
import type { CommandItem } from './prompt-input/types';

interface ModelInfo {
  id: string; name: string;
}

interface Props {
  nodeId: string;
}

const RATIO_OPTIONS = [
  { label: '1:1', w: 12, h: 12 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '3:4', w: 9, h: 12 },
  { label: '4:3', w: 12, h: 9 },
  { label: '3:2', w: 12, h: 8 },
  { label: '2:3', w: 9, h: 12 },
];

function ratioIcon(r: string) {
  const found = RATIO_OPTIONS.find((o) => o.label === r);
  return found ? { w: found.w, h: found.h } : { w: 12, h: 12 };
}

function VideoConfigPanelComponent({ nodeId }: Props) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);
  const setStatus = useNodeStore((s) => s.setStatus);
  const { zoom } = useViewport();
  const promptRef = useRef<PromptInputRef>(null);
  const { uploadSingleImage } = useImageUpload(nodeId);

  const nodeData = node?.data as any;
  const model = nodeData?.model ?? '';
  const ratio = nodeData?.ratio ?? '16:9';
  const resolution = nodeData?.resolution ?? '1080p';
  const duration = nodeData?.duration ?? 5;
  const audio = nodeData?.audio ?? true;
  const status = nodeData?.status ?? 'idle';
  const prompt = nodeData?.prompt ?? { text: '', html: '', allImages: [], referencedImageIds: [] };
  const allImages = nodeData?.allImages ?? [];

  // ── Model selector state ──
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [listening, setListening] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);
  const recognitionRef = useRef<any>(null);
  const voiceBaseRef = useRef('');
  // 批0.5-8b：上次提交的意图态——失败重试复用同 intentId（表命中不双扣），新点击 rotate 新 id
  const lastSubmitRef = useRef<{ intentId: string; failed: boolean } | null>(null);
  const selectedModel = models.find((m) => m.id === model);

  useEffect(() => {
    if (!modelOpen) return;
    const handler = () => setModelOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelOpen]);

  // Close config popup on outside click
  useEffect(() => {
    if (!configOpen) return;
    const handler = () => setConfigOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [configOpen]);

  // Close count dropdown on outside click
  useEffect(() => {
    if (!countOpen) return;
    const handler = () => setCountOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [countOpen]);

  // Load video models
  useEffect(() => {
    fetch('/api/node-types/video/models')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          const list: ModelInfo[] = json.data;
          setModels(list);
          if (!nodeData?.model && list.length > 0) {
            updateConfig(nodeId, { model: list[0].id } as any);
          }
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate price
  const updatePrice = useCallback(async (modelId: string) => {
    try {
      const res = await fetch(`/api/pricing/calculate?modelId=${modelId}`);
      const json = await res.json();
      if (json.code === 0) setCreditCost(json.data);
    } catch { setCreditCost(0); }
  }, []);

  useEffect(() => {
    if (model) updatePrice(model);
  }, [model, updatePrice]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      updateConfig(nodeId, { model: modelId } as any);
      updatePrice(modelId);
      setModelOpen(false);
    },
    [nodeId, updateConfig, updatePrice],
  );

  // Voice input
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    promptRef.current?.forceSync();
    const currentText = useNodeStore.getState().getNodeData<VideoNodeData>(nodeId)?.prompt?.text || '';
    voiceBaseRef.current = currentText;

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener('result', (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          transcript += result[0].transcript;
        }
      }
      promptRef.current?.setText(voiceBaseRef.current + transcript);
    });

    recognition.addEventListener('error', () => setListening(false));
    recognition.addEventListener('end', () => setListening(false));

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, nodeId]);

  // Command handler
  const handleCommandSelect = useCallback((command: CommandItem) => {
    switch (command.category) {
      case 'model': updateConfig(nodeId, { model: command.value }); break;
    }
  }, [nodeId, updateConfig]);

  // Generate
  const handleGenerate = useCallback(async () => {
    promptRef.current?.forceSync();
    const latestText = useNodeStore.getState().getNodeData<VideoNodeData>(nodeId)?.prompt?.text || '';
    if (!latestText.trim()) return;
    setExecuting(true);
    setStatus(nodeId, 'loading');
    const projectId = useCanvasStore.getState().projectId;
    let intentId = '';
    try {
      const nodeState = useNodeStore.getState();
      const existing = nodeState.nodes[nodeId] as any;
      const currentPrompt = existing?.data?.prompt ?? { text: '', html: '', allImages: [], referencedImageIds: [] };
      useNodeStore.setState({
        nodes: { ...nodeState.nodes, [nodeId]: { ...existing, data: { ...existing?.data, prompt: { ...currentPrompt, text: latestText } } } },
      });
      if (!projectId) return;
      // 批0.5-8b：意图 id 上送（幂等键）——上次失败复用（服务端表命中不双扣），否则 rotate 新 id
      intentId = lastSubmitRef.current?.failed
        ? currentIntentId(projectId, nodeId)
        : newIntentId(projectId, nodeId);
      const { jobId } = await enqueueWorkflow({ projectId, nodeId, intentId });
      console.log('[VideoPanel] enqueued job:', jobId);
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
  }, [nodeId, setStatus]);

  const handlePasteImage = useCallback(async (file: File) => {
    if (allImages.length >= 9) return;
    const uploaded = await uploadSingleImage(file);
    if (uploaded) promptRef.current?.insertImage(uploaded.url);
  }, [allImages.length, uploadSingleImage]);

  // VideoConfigPanel is rendered inside VideoGenNode which already
  // guarantees video context. Only render for videoGen (and legacy 'video') nodes.
  if (!node || (node.type !== 'videoGen' && node.type !== 'video')) return null;

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
        <ImageThumbnailBar
          nodeId={nodeId}
          images={allImages}
          onChange={(allImages) => updatePromptImages(nodeId, allImages)}
          onImageClick={(imageId) => {
            const img = allImages.find((i: any) => i.id === imageId);
            if (img) promptRef.current?.insertImage(img.url);
          }}
          onImageUploaded={(imageId) => {
            const img = allImages.find((i: any) => i.id === imageId);
            if (img) promptRef.current?.insertImage(img.url);
          }}
          onBeforeImageDelete={(imageId) => {
            const img = allImages.find((i: any) => i.id === imageId);
            if (img) promptRef.current?.removeImage(img.url);
          }}
          disabled={status === 'loading'}
        />

        <PromptInput
          ref={promptRef}
          nodeId={nodeId}
          value={prompt}
          allImages={allImages}
          onPasteImage={handlePasteImage}
          onChange={(newPrompt) => updateConfig(nodeId, { prompt: newPrompt })}
          onCommandSelect={handleCommandSelect}
          onGenerate={handleGenerate}
          disabled={status === 'loading'}
          maxHeight={maximized ? 350 : 80}
        />

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              data-testid="canvas-node-video-model-select"
              onClick={(e) => { e.stopPropagation(); setModelOpen((v) => !v); }}
              className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-overlay-2 active:bg-overlay-2 px-2 py-1 text-sm rounded-lg text-[#f5f5f5]"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0">
                <path d="M8.99805 2.38477C9.53893 3.90621 10.4105 5.29349 11.5566 6.44238L11.5586 6.44336C12.5481 7.43013 13.7171 8.21841 15.0029 8.76562C15.2029 8.8518 15.4064 8.9289 15.6113 9.00195C14.0914 9.54303 12.7055 10.4153 11.5576 11.5605L11.5566 11.5615C10.412 12.7102 9.5406 14.0963 8.99902 15.6162C8.45764 14.0958 7.58633 12.7095 6.44043 11.5615L6.43945 11.5605L6.17578 11.3066C5.08059 10.2858 3.78911 9.50275 2.38281 9.00195C3.90333 8.45997 5.29032 7.58857 6.43945 6.44336L6.44043 6.44238C7.58587 5.29322 8.45678 3.90579 8.99805 2.38477Z" stroke="#A3A3A3" strokeWidth="1.33" />
              </svg>
              <span className="whitespace-nowrap text-xs">{selectedModel?.name || '选择模型'}</span>
            </button>
            {modelOpen && (
              <div
                className="absolute left-0 bottom-full mb-1 bg-[#2a2a2a] border border-overlay-2 rounded-lg py-1 shadow-xl z-50 min-w-[160px]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModelSelect(m.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-overlay-2 bg-transparent text-[#ccc] ${
                      m.id === model ? 'bg-overlay-2' : ''
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-overlay-2 shrink-0" />
          <div className="relative">
          <button
            type="button"
            data-testid="canvas-node-video-config-select"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setConfigOpen((v) => !v); }}
            className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-overlay-2 active:bg-overlay-2 px-2 py-1 text-sm rounded-lg text-[#f5f5f5]"
          >
            <div className="flex items-center justify-center shrink-0" style={{ width: 16, height: 16 }}>
              <div className="rounded-[2px]" style={{ width: ratioIcon(ratio).w, height: ratioIcon(ratio).h, border: '1.5px solid currentColor' }} />
            </div>
            <span className="whitespace-nowrap text-xs">{ratio} · {resolution} · {duration}s</span>
            {/* Volume icon — Up when audio on, Mute (strikethrough) when off */}
            {audio ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                <path d="M3 9v6h4l5 5V4L7 9H3z" />
                <path d="M22 2L2 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {configOpen && (
            <div
              className="absolute bottom-full mb-2 left-0 z-[300] w-[340px] flex flex-col gap-2 rounded-2xl p-3 border border-[#363636] shadow-[0_4px_10px_rgba(0,0,0,0.25),0_2px_4px_rgba(0,0,0,0.3)]"
              style={{ backgroundColor: 'oklab(0.26861 0.0000122264 0.00000536442 / 0.95)', backdropFilter: 'blur(32px)' }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Resolution section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>清晰度</span></div>
                <div className="flex gap-2">
                  {['1080p', '4K'].map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => updateConfig(nodeId, { resolution: res } as any)}
                      className={`flex h-8 flex-1 items-center justify-center rounded-lg border border-solid text-[13px] transition-colors duration-200 ${
                        resolution === res ? 'border-[#4a4a4a] bg-overlay-2 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                      }`}
                    >{res}</button>
                  ))}
                </div>
              </div>
              {/* Ratio section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>比例</span></div>
                <div className="grid grid-cols-5 gap-2">
                  {RATIO_OPTIONS.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => { updateConfig(nodeId, { ratio: r.label } as any); }}
                      className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-solid px-1 py-3 transition-colors duration-200 ${
                        ratio === r.label ? 'border-[#4a4a4a] bg-overlay-2 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                      }`}
                    >
                      <span className="flex size-[17px] items-center justify-center">
                        <span className="flex-none rounded-[2px] border-[1.5px] border-solid border-current" style={{ width: r.w, height: r.h }} />
                      </span>
                      <span className="text-xs">{r.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Duration section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>时长</span></div>
                <div className="flex gap-2">
                  {[5, 10, 15].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => updateConfig(nodeId, { duration: d } as any)}
                      className={`flex h-8 flex-1 items-center justify-center rounded-lg border border-solid text-[13px] transition-colors duration-200 ${
                        duration === d ? 'border-[#4a4a4a] bg-overlay-2 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                      }`}
                    >{d}s</button>
                  ))}
                </div>
              </div>
              {/* Audio section */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-[#999]"><span>声音</span></div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="canvas-node-video-audio-toggle"
                    onClick={() => updateConfig(nodeId, { audio: !audio } as any)}
                    className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-solid text-[13px] transition-colors duration-200 ${
                      audio ? 'border-[#4a4a4a] bg-overlay-2 text-[#f5f5f5]' : 'border-[#363636] text-[#999] bg-transparent'
                    }`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                    <span>{audio ? '开' : '关'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
          </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              aria-label="语音输入"
              onClick={toggleVoice}
              className={`size-7 shrink-0 flex items-center justify-center rounded-lg transition-colors hover:bg-overlay-2 active:bg-overlay-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                listening ? 'bg-overlay-3 text-[var(--fw-accent-text)]' : 'bg-transparent text-text-dim-3'
              }`}
              title={listening ? '停止录音' : '语音输入'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.00052 12.2041V14.0048M8.00052 12.2041C9.11488 12.2041 10.1836 11.7614 10.9716 10.9735C11.7595 10.1855 12.2022 9.11678 12.2022 8.00242V6.80193M8.00052 12.2041C6.88616 12.2041 5.81745 11.7614 5.02948 10.9735C4.24151 10.1855 3.79883 9.11678 3.79883 8.00242V6.80193M8.00052 2C8.99503 2 9.80125 2.80621 9.80125 3.80073V8.00242C9.80125 8.99693 8.99503 9.80314 8.00052 9.80314C7.00601 9.80314 6.1998 8.99693 6.1998 8.00242V3.80073C6.1998 2.80621 7.00601 2 8.00052 2Z" stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* Generate count selector */}
            <div className="relative">
              <button
                type="button"
                data-testid="canvas-node-video-count-select"
                onClick={(e) => { e.stopPropagation(); setCountOpen((v) => !v); }}
                className="group relative inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-[#f5f5f5] transition-all active:bg-overlay-2 hover:bg-overlay-2 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Generate ${generateCount} variations`}
              >
                <span className="count-tooltip absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 text-xs font-normal text-text bg-[var(--canvas-controls-bg)] rounded-md whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">生成数量</span>
                <span>{generateCount}×</span>
              </button>
              {countOpen && (
                <div
                  className="absolute bottom-full mb-1 right-0 bg-[#2a2a2a] border border-overlay-2 rounded-lg py-1 shadow-xl z-50 min-w-[80px]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {[1, 2, 4, 8].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { setGenerateCount(n); setCountOpen(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-overlay-2 bg-transparent text-[#ccc] ${
                        n === generateCount ? 'bg-overlay-2' : ''
                      }`}
                    >
                      {n}×
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-overlay-2 shrink-0" />
            <span className="flex shrink-0 items-center gap-[2px] text-[#919191]">
              <svg width="10" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="pointer-events-none">
                <g transform="translate(2.2857 0) scale(0.933347)">
                  <path d="M6.79577 0.652118C7.72979 -0.427779 8.49498 -0.136386 8.49498 1.30348V7.47438H11.0956C12.2734 7.47448 12.6016 8.21128 11.8192 9.1111L5.44909 16.491C4.51536 17.5703 3.74914 17.2787 3.74889 15.8396V9.66872H1.14928C-0.0287394 9.66872 -0.356821 8.9309 0.425648 8.03102L6.79577 0.652118Z" fill="currentColor" />
                </g>
              </svg>
              <span className="min-w-5 text-center text-[12px] font-normal leading-[15px]">{creditCost || '—'}</span>
            </span>
            <button
              onClick={handleGenerate}
              disabled={executing}
              className="size-7 shrink-0 flex items-center justify-center rounded-lg bg-[var(--canvas-controls-bg)] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executing ? '⏳' : (
                <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="size-3 text-[#999]" width="12" height="12" viewBox="0 0 18 18">
                  <path d="M8.29289 0.292893C8.68342 -0.0976311 9.31658 -0.0976311 9.70711 0.292893L17.7071 8.29289C18.0976 8.68342 18.0976 9.31658 17.7071 9.70711C17.3166 10.0976 16.6834 10.0976 16.2929 9.70711L10 3.41421V17C10 17.5523 9.55229 18 9 18C8.44772 18 8 17.5523 8 17V3.41421L1.70711 9.70711C1.31658 10.0976 0.683418 10.0976 0.292893 9.70711C-0.0976311 9.31658 -0.0976311 8.68342 0.292893 8.29289L8.29289 0.292893Z" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const VideoConfigPanel = memo(VideoConfigPanelComponent);
