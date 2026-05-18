import { memo, useCallback, useState, useEffect } from 'react';
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
  const model = nodeData?.model ?? '';

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
          <select
            value={model}
            onChange={(e) => {
              const val = e.target.value;
              const store = useNodeStore.getState();
              const existing = store.nodes[nodeId] as any;
              useNodeStore.setState({
                nodes: { ...store.nodes, [nodeId]: { ...existing, type: 'text', model: val } },
              });
              updatePrice(val);
            }}
            className="w-32 bg-white/10 border-0 rounded-lg text-[10px] text-[#f7f7f7] px-2 py-1 h-8 outline-none transition-colors cursor-pointer"
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#f59e0b] whitespace-nowrap">{creditCost || '—'} 积分</span>
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
