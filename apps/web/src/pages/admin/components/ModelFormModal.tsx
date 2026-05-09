import { useState, useEffect } from 'react';
import { type ModelData } from '@/api/adminApi';

interface Props {
  visible: boolean;
  model?: ModelData | null;
  nodeTypeKey: string;
  onSave: (data: any) => void;
  onCancel: () => void;
}

export function ModelFormModal({ visible, model, nodeTypeKey, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [recommended, setRecommended] = useState(false);
  const [resolutions, setResolutions] = useState<{ label: string; width: number; height: number }[]>([]);
  const [resolutionLabel, setResolutionLabel] = useState('');
  const [resolutionW, setResolutionW] = useState(1024);
  const [resolutionH, setResolutionH] = useState(1024);
  const [durations, setDurations] = useState<{ label: string; seconds: number }[]>([]);
  const [durationLabel, setDurationLabel] = useState('');
  const [durationSec, setDurationSec] = useState(15);

  useEffect(() => {
    if (model) {
      setName(model.name);
      setProvider(model.provider);
      setApiUrl(model.apiUrl);
      setSortOrder(model.sortOrder);
      setRecommended(model.recommended);
      setResolutions(model.resolutions?.map(r => ({ label: r.label, width: r.width, height: r.height })) ?? []);
      setDurations(model.durations?.map(d => ({ label: d.label, seconds: d.seconds })) ?? []);
    } else {
      setName(''); setProvider(''); setApiUrl(''); setSortOrder(0); setRecommended(false);
      setResolutions([]); setDurations([]);
    }
  }, [model, visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-4">{model ? '编辑模型' : '添加模型'}</h3>
        <div className="grid gap-3">
          <input placeholder="模型名称" value={name} onChange={e => setName(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <input placeholder="服务商" value={provider} onChange={e => setProvider(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <input placeholder="API URL" value={apiUrl} onChange={e => setApiUrl(e.target.value)} className="bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc]" />
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-[10px] text-[#888]">排序</span>
              <input type="number" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-2 text-xs text-[#ccc] mt-1" />
            </label>
            <label className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={recommended} onChange={e => setRecommended(e.target.checked)} />
              <span className="text-xs text-[#888]">推荐</span>
            </label>
          </div>
          {(nodeTypeKey === 'image' || nodeTypeKey === 'video') && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">分辨率</div>
              <div className="flex gap-2 mb-2">
                <input placeholder="标签" value={resolutionLabel} onChange={e => setResolutionLabel(e.target.value)} className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="宽" value={resolutionW} onChange={e => setResolutionW(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="高" value={resolutionH} onChange={e => setResolutionH(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <button onClick={() => { setResolutions([...resolutions, { label: resolutionLabel, width: resolutionW, height: resolutionH }]); setResolutionLabel(''); }} className="bg-[#4ade80] text-black px-2 py-1 rounded text-xs">+</button>
              </div>
              {resolutions.map((r, i) => <span key={i} className="text-[10px] text-[#60a5fa] mr-2">{r.label}</span>)}
            </div>
          )}
          {nodeTypeKey === 'video' && (
            <div>
              <div className="text-[10px] text-[#888] mb-1">时长</div>
              <div className="flex gap-2 mb-2">
                <input placeholder="标签" value={durationLabel} onChange={e => setDurationLabel(e.target.value)} className="flex-1 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <input type="number" placeholder="秒" value={durationSec} onChange={e => setDurationSec(Number(e.target.value))} className="w-20 bg-[#0f0f0f] border border-[#333] rounded-md px-2 py-1 text-xs text-[#ccc]" />
                <button onClick={() => { setDurations([...durations, { label: durationLabel, seconds: durationSec }]); setDurationLabel(''); }} className="bg-[#4ade80] text-black px-2 py-1 rounded text-xs">+</button>
              </div>
              {durations.map((d, i) => <span key={i} className="text-[10px] text-[#c084fc] mr-2">{d.label}</span>)}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-2 rounded-md text-xs text-[#ccc] border border-[#333]">取消</button>
          <button onClick={() => onSave({ name, provider, apiUrl, sortOrder, recommended, resolutions, durations })} className="px-4 py-2 rounded-md text-xs bg-[#4ade80] text-black font-bold">保存</button>
        </div>
      </div>
    </div>
  );
}
