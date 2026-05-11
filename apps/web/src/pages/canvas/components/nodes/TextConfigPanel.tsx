import { memo, useCallback, useState, useEffect } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { executeWorkflow } from '@/api/executionApi';
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
      const result = await executeWorkflow('default', nodeId);
      // Update node content with AI response
      if (result?.success) {
        const nodeResult = (result.results as any)?.find((r: any) => r.nodeId === nodeId);
        if ((nodeResult as any)?.content) {
          const latest = useNodeStore.getState();
          const existing = latest.nodes[nodeId] as any;
          useNodeStore.setState({
            nodes: { ...latest.nodes, [nodeId]: { ...existing, type: 'text', content: (nodeResult as any).content } },
          });
        }
      }
    } catch {
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus, prompt]);

  return (
    <div className="bg-[#1a1a1a] border-2 border-t-[#4ade80] border-[#444] rounded-xl w-[380px] shadow-xl">
      <div className="p-4">
        {/* Prompt */}
        <div className="mb-3">
          <div className="text-xs text-[#888] mb-1.5">提示词（发送给 AI）</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入 Prompt..."
            rows={3}
            className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 focus:outline-none focus:border-[#4ade80] resize-none box-border"
          />
        </div>

        {/* Model + Execute */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <div className="text-[10px] text-[#888] mb-1">模型</div>
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
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-2"
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#f59e0b] whitespace-nowrap">{creditCost || '—'} 积分</span>
            <button
              onClick={handleGenerate}
              disabled={executing}
              className={`w-9 h-9 text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md transition-colors ${
                executing ? 'bg-gray-500 cursor-not-allowed' : 'bg-[#4ade80] hover:bg-[#22c55e] shadow-[#4ade80]/30'
              }`}
            >
              {executing ? '⏳' : '▶'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const TextConfigPanel = memo(TextConfigPanelComponent);
