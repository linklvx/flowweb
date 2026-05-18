import { memo, useCallback, useState, useEffect } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { executeWorkflow, enqueueWorkflow } from '@/api/executionApi';
import { syncNodes, syncEdges } from '@/api/projectApi';

const STYLES = ['写实', '动漫', '油画', '3D渲染', '水彩', '复古', '像素', '赛博朋克'];
const COUNTS = [1, 2, 4];

interface ModelInfo {
  id: string; name: string;
  resolutions: { id: string; label: string }[];
  durations: { id: string; label: string }[];
}

interface Props {
  nodeId: string;
}

function ImageConfigPanelComponent({ nodeId }: Props) {
  const nodeData = useNodeStore((s) => s.nodes[nodeId]) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const setStatus = useNodeStore((s) => s.setStatus);
  const setResult = useNodeStore((s) => s.setResult);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [creditCost, setCreditCost] = useState<number>(0);
  const [executing, setExecuting] = useState(false);

  // Load models on mount + auto-select defaults
  useEffect(() => {
    fetch('/api/node-types/image/models')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          const list: ModelInfo[] = json.data;
          setModels(list);
          // Auto-select highest-priority model if none selected
          if (!nodeData?.model && list.length > 0) {
            const topModel = list[0];
            const topResolution = topModel.resolutions?.[0];
            updateConfig(nodeId, {
              model: topModel.id,
              resolution: topResolution?.id || '',
            });
            if (topModel.id) updatePrice(topModel.id, topResolution?.id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Calculate price callback
  const updatePrice = useCallback(async (modelId: string, resolutionId?: string) => {
    const params = new URLSearchParams({ modelId });
    if (resolutionId) params.set('resolutionId', resolutionId);
    try {
      const res = await fetch(`/api/pricing/calculate?${params}`);
      const json = await res.json();
      if (json.code === 0) setCreditCost(json.data);
    } catch { setCreditCost(0); }
  }, []);

  const selectedModel = models.find(m => m.id === nodeData?.model);

  const handleStyleToggle = useCallback(
    (style: string) => {
      updateConfig(nodeId, { style });
    },
    [nodeId, updateConfig]
  );

  const handleGenerate = useCallback(async () => {
    setExecuting(true);
    setStatus(nodeId, 'loading');
    try {
      // Merge canvasStore (position/type) + nodeStore (content/config) then sync to backend
      const canvasState = useCanvasStore.getState();
      const nodeState = useNodeStore.getState();
      const mergedNodes = canvasState.nodes.map((n) => ({
        id: n.id,
        type: n.type || 'imageGen',
        position: n.position,
        data: nodeState.nodes[n.id] || (n.data as any) || {},
      }));
      console.log('[execute] syncing', mergedNodes.length, 'nodes,', canvasState.edges.length, 'edges');
      console.log('[execute] merged nodes:', JSON.stringify(mergedNodes.map(n => ({ id: n.id, type: n.type, dataKeys: Object.keys(n.data) }))));
      await Promise.all([
        syncNodes('default', mergedNodes),
        syncEdges('default', canvasState.edges),
      ]);

      const { jobId } = await enqueueWorkflow('default', nodeId);
      console.log('[ImagePanel] enqueued job:', jobId);
      // Socket.io will update status → done/error. Keep loading state.
    } catch {
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus]);

  return (
    <div className="nodrag bg-[#222222] border-2 border-t-[#60a5fa] border-[#444] rounded-xl w-[420px]">
      <div className="text-center">
        <div className="inline-block w-0 h-0 border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-[#333]" />
      </div>
      <div className="p-4">
        {/* Style tags */}
        <div className="mb-3">
          <div className="text-xs text-[#888] mb-2">风格标签</div>
          <div className="flex gap-1.5 flex-wrap">
            {STYLES.map((s) => (
              <button
                key={s}
                onClick={() => handleStyleToggle(s)}
                className={`px-2.5 py-1 rounded-full text-[10px] border cursor-pointer transition-colors ${
                  nodeData?.style === s
                    ? 'bg-[#60a5fa]/20 border-[#60a5fa] text-[#60a5fa]'
                    : 'bg-transparent border-[#444] text-[#888] hover:border-[#60a5fa]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Supplementary Prompt */}
        <div className="mb-3">
          <div className="text-xs text-[#888] mb-1.5">提示词（可选，将追加到上游文本内容后）</div>
          <textarea
            placeholder="对上游Prompt的补充说明..."
            value={nodeData?.extraPrompt ?? ''}
            onChange={(e) => updateConfig(nodeId, { extraPrompt: e.target.value })}
            rows={2}
            className="w-full bg-transparent border border-[#3a3a3a] rounded-md text-xs text-[#ccc] px-2.5 py-2 focus:outline-none focus:border-[#60a5fa] resize-none box-border"
          />
        </div>

        {/* Params */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">模型</div>
            <select
              value={nodeData?.model ?? ''}
              onChange={(e) => {
                updateConfig(nodeId, { model: e.target.value, resolution: '' });
                updatePrice(e.target.value, undefined);
              }}
              className="w-full bg-transparent border border-[#3a3a3a] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              <option value="">选择模型</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">分辨率</div>
            <select
              value={nodeData?.resolution ?? ''}
              onChange={(e) => {
                updateConfig(nodeId, { resolution: e.target.value });
                updatePrice(nodeData?.model, e.target.value);
              }}
              className="w-full bg-transparent border border-[#3a3a3a] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              <option value="">默认</option>
              {(selectedModel?.resolutions || []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">生成数量</div>
            <select
              value={nodeData?.count ?? 1}
              onChange={(e) => updateConfig(nodeId, { count: Number(e.target.value) })}
              className="w-full bg-transparent border border-[#3a3a3a] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              {COUNTS.map((c) => <option key={c} value={c}>{c}张</option>)}
            </select>
          </div>
        </div>

        {/* Execute — inline row */}
        <div className="flex justify-between items-center pt-1">
          <span className="text-xs text-[#f59e0b]">消耗积分: {creditCost || '—'}</span>
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
  );
}

export const ImageConfigPanel = memo(ImageConfigPanelComponent);
