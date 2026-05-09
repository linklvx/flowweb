import { memo, useCallback } from 'react';
import { useNodeStore } from '@/stores/nodeStore';

const STYLES = ['写实', '动漫', '油画', '3D渲染', '水彩', '复古', '像素', '赛博朋克'];
const MODELS = ['SD XL', 'DALL-E 3', 'MJ v6'];
const RESOLUTIONS = ['512×512', '1024×1024', '2048×2048'];
const COUNTS = [1, 2, 4];

interface Props {
  nodeId: string;
}

function ImageConfigPanelComponent({ nodeId }: Props) {
  const nodeData = useNodeStore((s) => s.nodes[nodeId]) as any;
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const setStatus = useNodeStore((s) => s.setStatus);

  const handleStyleToggle = useCallback(
    (style: string) => {
      updateConfig(nodeId, { style });
    },
    [nodeId, updateConfig]
  );

  const handleGenerate = useCallback(() => {
    setStatus(nodeId, 'loading');
  }, [nodeId, setStatus]);

  return (
    <div className="mt-2 bg-[#1a1a1a] border-2 border-[#333] rounded-xl w-80 shadow-xl">
      <div className="text-center -mt-2">
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
                    : 'bg-[#252525] border-[#444] text-[#888] hover:border-[#60a5fa]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Supplementary Prompt */}
        <div className="mb-3">
          <div className="text-xs text-[#888] mb-1.5">补充 Prompt（可选）</div>
          <input
            placeholder="对上游Prompt的补充说明..."
            value={nodeData?.extraPrompt ?? ''}
            onChange={(e) => updateConfig(nodeId, { extraPrompt: e.target.value })}
            className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-xs text-[#ccc] px-2.5 py-2 focus:outline-none focus:border-[#60a5fa]"
          />
        </div>

        {/* Params */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">模型</div>
            <select
              value={nodeData?.model ?? 'SD XL'}
              onChange={(e) => updateConfig(nodeId, { model: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              {MODELS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">分辨率</div>
            <select
              value={nodeData?.resolution ?? '1024×1024'}
              onChange={(e) => updateConfig(nodeId, { resolution: e.target.value })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              {RESOLUTIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-[#888] mb-1">生成数量</div>
            <select
              value={nodeData?.count ?? 1}
              onChange={(e) => updateConfig(nodeId, { count: Number(e.target.value) })}
              className="w-full bg-[#0f0f0f] border border-[#333] rounded-md text-[10px] text-[#ccc] px-1.5 py-1.5"
            >
              {COUNTS.map((c) => <option key={c} value={c}>{c}张</option>)}
            </select>
          </div>
        </div>

        {/* Execute button — bottom-right */}
        <div className="flex justify-end items-center gap-3">
          <span className="text-xs text-[#f59e0b]">消耗积分: 5</span>
          <button
            onClick={handleGenerate}
            className="w-9 h-9 bg-[#4ade80] text-black font-bold text-lg rounded-full flex items-center justify-center cursor-pointer border-none shadow-md shadow-[#4ade80]/30 hover:bg-[#22c55e] transition-colors"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}

export const ImageConfigPanel = memo(ImageConfigPanelComponent);
