import { memo, useCallback, useState, useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { executeWorkflow, enqueueWorkflow } from '@/api/executionApi';
import { syncNodes, syncEdges } from '@/api/projectApi';

interface ModelInfo {
  id: string; name: string;
}

interface Props {
  nodeId: string;
}

function TextConfigPanelComponent({ nodeId }: Props) {
  const nodeData = useNodeStore((s) => s.nodes[nodeId]) as any;
  const setStatus = useNodeStore((s) => s.setStatus);
  const { zoom } = useViewport();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState<number>(0);
  const [executing, setExecuting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [listening, setListening] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const recognitionRef = useRef<any>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt; // Keep ref in sync for recognition callback
  const model = nodeData?.model ?? '';
  const selectedModel = models.find((m) => m.id === model);

  // Close model dropdown on outside click
  useEffect(() => {
    if (!modelOpen) return;
    const handler = (e: MouseEvent) => setModelOpen(false);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelOpen]);

  // Load text models
  useEffect(() => {
    fetch('/api/node-types/text/models')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          const list: ModelInfo[] = json.data;
          setModels(list);
          if (!nodeData?.model && list.length > 0) {
            const store = useNodeStore.getState();
            const existing = store.nodes[nodeId] as any;
            useNodeStore.setState({
              nodes: { ...store.nodes, [nodeId]: { ...existing, type: 'text', model: list[0].id } },
            });
          }
        }
      })
      .catch(() => {});
  }, []);

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
  }, [model]);

  const handleModelSelect = useCallback(
    (modelId: string) => {
      const store = useNodeStore.getState();
      const existing = store.nodes[nodeId] as any;
      useNodeStore.setState({
        nodes: { ...store.nodes, [nodeId]: { ...existing, type: 'text', model: modelId } },
      });
      updatePrice(modelId);
      setModelOpen(false);
    },
    [nodeId, updatePrice],
  );

  // Voice input via Web Speech API
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const originalPrompt = promptRef.current; // Capture base text before voice input
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.addEventListener('result', (event: any) => {
      // Rebuild full transcript from ALL results
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result && result[0]) {
          transcript += result[0].transcript;
        }
      }
      setPrompt(originalPrompt + transcript);
    });

    recognition.addEventListener('error', () => {
      setListening(false);
    });

    recognition.addEventListener('end', () => {
      setListening(false);
    });

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setExecuting(true);
    setStatus(nodeId, 'loading');
    try {
      const canvasState = useCanvasStore.getState();
      const nodeState = useNodeStore.getState();
      // Inject prompt as content for execution
      const existing = nodeState.nodes[nodeId] as any;
      useNodeStore.setState({
        nodes: { ...nodeState.nodes, [nodeId]: { ...existing, type: 'text', content: prompt } },
      });
      const latestState = useNodeStore.getState();
      const mergedNodes = canvasState.nodes.map((n) => ({
        id: n.id, type: n.type || 'textInput',
        position: n.position,
        data: latestState.nodes[n.id] || (n.data as any) || {},
      }));
      await Promise.all([
        syncNodes('default', mergedNodes),
        syncEdges('default', canvasState.edges),
      ]);
      const { jobId } = await enqueueWorkflow('default', nodeId);
      console.log('[TextPanel] enqueued job:', jobId);
      // Socket.io will update status → done/error with AI response
    } catch {
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus, prompt]);

  return (
    <div
      className="nodrag bg-[#222222] border-2 border-t-[#4ade80] border-[#444] rounded-xl w-[650px] h-[140px] shadow-xl"
      style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'top center' }}
    >
      <div className="pt-3 px-3 pb-1.5 flex flex-col gap-2 h-full box-border">
        {/* Prompt */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你要生成的内容、场景或角色设定。例如：星际宇航员，站在月球表面眺望蓝色地球。"
          className="flex-1 bg-transparent border-0 rounded-md text-xs text-[#ccc] px-2.5 py-2 focus:outline-none resize-none box-border"
        />

        {/* Model (left) + Credits + Execute (right) */}
        <div className="flex items-center justify-between">
          {/* Model selector — styled button + dropdown */}
          <div className="relative">
            <button
              type="button"
              data-testid="canvas-node-text-model-select"
              onClick={(e) => { e.stopPropagation(); setModelOpen((v) => !v); }}
              className="inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors focus-visible:outline-none disabled:opacity-50 h-9 gap-1 hover:bg-white/10 active:bg-white/[0.1] px-2 py-1 text-sm rounded-lg text-[#f5f5f5] border-none bg-transparent cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0">
                <path d="M8.99805 2.38477C9.53893 3.90621 10.4105 5.29349 11.5566 6.44238L11.5586 6.44336C12.5481 7.43013 13.7171 8.21841 15.0029 8.76562C15.2029 8.8518 15.4064 8.9289 15.6113 9.00195C14.0914 9.54303 12.7055 10.4153 11.5576 11.5605L11.5566 11.5615C10.412 12.7102 9.5406 14.0963 8.99902 15.6162C8.45764 14.0958 7.58633 12.7095 6.44043 11.5615L6.43945 11.5605L6.17578 11.3066C5.08059 10.2858 3.78911 9.50275 2.38281 9.00195C3.90333 8.45997 5.29032 7.58857 6.43945 6.44336L6.44043 6.44238C7.58587 5.29322 8.45678 3.90579 8.99805 2.38477Z" stroke="#A3A3A3" strokeWidth="1.33" />
              </svg>
              <span className="whitespace-nowrap text-xs">{selectedModel?.name || '选择模型'}</span>
            </button>
            {modelOpen && (
              <div
                className="absolute left-0 bottom-full mb-1 bg-[#2a2a2a] border border-white/[0.1] rounded-lg py-1 shadow-xl z-50 min-w-[160px]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {models.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleModelSelect(m.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/10 border-none bg-transparent cursor-pointer ${
                      m.id === model ? 'text-[#4ade80]' : 'text-[#ccc]'
                    }`}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Voice input */}
            <button
              aria-label="语音输入"
              onClick={toggleVoice}
              className={`size-7 shrink-0 flex items-center justify-center rounded-lg cursor-pointer border-none transition-colors hover:bg-white/10 active:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed ${
                listening ? 'bg-white/20 text-[#4ade80]' : 'bg-transparent text-white/70'
              }`}
              title={listening ? '停止录音' : '语音输入'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8.00052 12.2041V14.0048M8.00052 12.2041C9.11488 12.2041 10.1836 11.7614 10.9716 10.9735C11.7595 10.1855 12.2022 9.11678 12.2022 8.00242V6.80193M8.00052 12.2041C6.88616 12.2041 5.81745 11.7614 5.02948 10.9735C4.24151 10.1855 3.79883 9.11678 3.79883 8.00242V6.80193M8.00052 2C8.99503 2 9.80125 2.80621 9.80125 3.80073V8.00242C9.80125 8.99693 8.99503 9.80314 8.00052 9.80314C7.00601 9.80314 6.1998 8.99693 6.1998 8.00242V3.80073C6.1998 2.80621 7.00601 2 8.00052 2Z" stroke="currentColor" strokeOpacity="0.9" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* Divider */}
            <div className="w-px h-4 bg-white/10 shrink-0" />
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
              className="size-7 shrink-0 flex items-center justify-center rounded-lg cursor-pointer border-none bg-[#3a3a3a] transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
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

export const TextConfigPanel = memo(TextConfigPanelComponent);
