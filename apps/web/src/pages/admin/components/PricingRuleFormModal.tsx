import { useState } from 'react';

interface ModelInfo {
  id: string; name: string;
  resolutions: { id: string; label: string }[];
  durations: { id: string; label: string }[];
}

interface Props {
  visible: boolean;
  models: ModelInfo[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export function PricingRuleFormModal({ visible, models, onSave, onCancel }: Props) {
  const [modelId, setModelId] = useState('');
  const [resolutionId, setResolutionId] = useState('');
  const [durationId, setDurationId] = useState('');
  const [creditCost, setCreditCost] = useState(5);

  const selectedModel = models.find(m => m.id === modelId);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 w-[400px]">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-4">添加定价规则</h3>
        <div className="grid gap-3">
          <div>
            <div className="text-[10px] text-[#888] mb-1">模型</div>
            <select value={modelId} onChange={e => { setModelId(e.target.value); setResolutionId(''); setDurationId(''); }} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
              <option value="">选择模型</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {selectedModel && selectedModel.resolutions.length > 0 && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">分辨率</div>
              <select value={resolutionId} onChange={e => setResolutionId(e.target.value)} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
                <option value="">不限</option>
                {selectedModel.resolutions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          )}
          {selectedModel && selectedModel.durations.length > 0 && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">时长</div>
              <select value={durationId} onChange={e => setDurationId(e.target.value)} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]">
                <option value="">不限</option>
                {selectedModel.durations.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <div className="text-[10px] text-[#888] mb-1">消耗积分</div>
            <input type="number" value={creditCost} onChange={e => setCreditCost(Number(e.target.value))} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-xs text-[#ccc] border border-[#333]">取消</button>
          <button onClick={() => onSave({ modelId, resolutionId: resolutionId || undefined, durationId: durationId || undefined, creditCost })} className="px-4 py-2 rounded-md text-xs bg-[#f59e0b] text-black font-bold">保存</button>
        </div>
      </div>
    </div>
  );
}
