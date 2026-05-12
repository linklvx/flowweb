import { memo, useCallback, useState, useEffect } from 'react';
import { useNodeStore } from '@/stores/nodeStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { executeWorkflow } from '@/api/executionApi';
import { syncNodes, syncEdges } from '@/api/projectApi';

const RATIOS = ['16:9', '9:16', '1:1'];
const QUALITIES = ['720P', '1080P'];
const DURATIONS = ['5秒', '10秒', '15秒'];
const MODES = [
  { key: 'text-to-video', label: '文生视频' },
  { key: 'image-to-video', label: '单图生视频' },
  { key: 'first-last-frame', label: '首尾帧生视频' },
  { key: 'multi-frame', label: '多帧参考生视频' },
] as const;

interface Props { nodeId: string; }

function VideoConfigPanelComponent({ nodeId }: Props) {
  const nodeData = useNodeStore((s) => s.nodes[nodeId]) as any;
  const setStatus = useNodeStore((s) => s.setStatus);

  const [models, setModels] = useState<any[]>([]);
  const [creditCost, setCreditCost] = useState(0);
  const [executing, setExecuting] = useState(false);

  const mode = nodeData?.mode ?? 'text-to-video';
  const model = nodeData?.model ?? '';
  const ratio = nodeData?.ratio ?? '16:9';
  const quality = nodeData?.quality ?? '720P';
  const duration = nodeData?.duration ?? '';
  const audio = nodeData?.audio ?? false;

  useEffect(() => {
    fetch('/api/node-types/video/models')
      .then(r => r.json()).then(j => {
        if (j.code === 0) {
          const list = j.data;
          setModels(list);
          if (!nodeData?.model && list.length > 0) {
            const top = list[0];
            const store = useNodeStore.getState();
            const existing = store.nodes[nodeId] as any;
            useNodeStore.setState({ nodes: { ...store.nodes, [nodeId]: { ...existing, type: 'video', model: top.id } } });
          }
        }
      }).catch(() => {});
  }, []);

  // Use direct setState to preserve video fields (NOT updateConfig which forces type:'image')
  const update = useCallback((fields: Record<string, any>) => {
    const store = useNodeStore.getState();
    const existing = store.nodes[nodeId] as any;
    useNodeStore.setState({
      nodes: { ...store.nodes, [nodeId]: { ...existing, type: 'video', ...fields } },
    });
  }, [nodeId]);

  const updatePrice = useCallback(async (modelId: string) => {
    try {
      const res = await fetch(`/api/pricing/calculate?${new URLSearchParams({ modelId })}`);
      const json = await res.json();
      if (json.code === 0) setCreditCost(json.data);
    } catch { setCreditCost(0); }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    setExecuting(true); setStatus(nodeId, 'loading');
    try {
      const cs = useCanvasStore.getState();
      const ns = useNodeStore.getState();
      const merged = cs.nodes.map(n => ({
        id: n.id, type: n.type, position: n.position,
        data: ns.nodes[n.id] || (n.data as any) || {},
      }));
      await Promise.all([syncNodes('default', merged), syncEdges('default', cs.edges)]);
      await executeWorkflow('default', nodeId);
    } catch { setStatus(nodeId, 'error'); }
    finally { setExecuting(false); }
  }, [nodeId, setStatus, prompt]);

  return (
    <div className="bg-[#1a1a1a] border-2 border-t-[#c084fc] border-[#444] rounded-xl w-[420px] shadow-xl">
      <div className="p-4">
        {/* Mode tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {MODES.map(m => (
            <button key={m.key} onClick={() => update({ mode: m.key })}
              className={`px-2 py-1 rounded text-[10px] border transition-colors ${mode === m.key ? 'bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc]' : 'bg-[#252525] border-[#444] text-[#888] hover:border-[#c084fc]'}`}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Image URL — mode-dependent */}
        {mode === 'image-to-video' && (
          <input placeholder="开始帧图片URL" value={nodeData?.startImageUrl ?? ''} onChange={e => update({ startImageUrl: e.target.value })}
            className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3" />
        )}
        {mode === 'first-last-frame' && (
          <div className="flex gap-2 mb-3">
            <input placeholder="开始帧URL" value={nodeData?.startImageUrl ?? ''} onChange={e => update({ startImageUrl: e.target.value })}
              className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2" />
            <input placeholder="结束帧URL" value={nodeData?.endImageUrl ?? ''} onChange={e => update({ endImageUrl: e.target.value })}
              className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2" />
          </div>
        )}
        {mode === 'multi-frame' && (
          <textarea placeholder="输入2-10个图片URL，每行一个" value={(nodeData?.imageUrls ?? []).join('\n')}
            onChange={e => update({ imageUrls: e.target.value.split('\n').filter(Boolean) })}
            rows={3} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3 resize-none box-border" />
        )}

        {/* Prompt */}
        <textarea placeholder="描述想要生成的视频内容..." value={prompt}
          onChange={e => update({ prompt: e.target.value })}
          rows={2} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 mb-3 resize-none box-border" />

        {/* Model */}
        <div className="mb-3">
          <div className="text-[10px] text-[#888] mb-1">模型</div>
          <select value={model} onChange={e => { update({ model: e.target.value }); updatePrice(e.target.value); }}
            className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-2">
            {models.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        {/* Params: ratio / quality / duration / audio */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">比例</div>
            <select value={ratio} onChange={e => update({ ratio: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              {RATIOS.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">清晰度</div>
            <select value={quality} onChange={e => update({ quality: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              {QUALITIES.map(q => <option key={q}>{q}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">时长</div>
            <select value={duration} onChange={e => update({ duration: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1 py-1.5">
              <option value="">选择</option>
              {DURATIONS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">音频</div>
            <button onClick={() => update({ audio: !audio })}
              className={`w-full py-1.5 rounded-md text-[10px] border ${audio ? 'bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc]' : 'bg-[#252525] border-[#444] text-[#888]'}`}>
              {audio ? '开' : '关'}
            </button>
          </div>
        </div>

        {/* Execute */}
        <div className="flex justify-between items-center">
          <span className="text-xs text-[#f59e0b]">{creditCost || '—'} 积分</span>
          <button onClick={handleGenerate} disabled={executing}
            className={`w-9 h-9 text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md ${executing ? 'bg-gray-500' : 'bg-[#4ade80] hover:bg-[#22c55e] shadow-[#4ade80]/30'}`}>
            {executing ? '⏳' : '▶'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const VideoConfigPanel = memo(VideoConfigPanelComponent);
