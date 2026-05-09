import { useState, useEffect } from 'react';
import { fetchPricingRules, fetchModels, createPricingRule, deletePricingRule, type PricingRuleData, type ModelData } from '@/api/adminApi';
import { PricingRuleFormModal } from './PricingRuleFormModal';

interface Props { nodeTypeId: string; }

export function PricingRuleTable({ nodeTypeId }: Props) {
  const [rules, setRules] = useState<PricingRuleData[]>([]);
  const [models, setModels] = useState<ModelData[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  const load = async () => {
    const [r, m] = await Promise.all([fetchPricingRules(nodeTypeId), fetchModels(nodeTypeId)]);
    setRules(r); setModels(m);
  };
  useEffect(() => { load(); }, [nodeTypeId]);

  const handleSave = async (data: any) => {
    await createPricingRule({ ...data, nodeTypeId });
    setModalVisible(false);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[#e2e8f0]">定价规则</h3>
        <button onClick={() => setModalVisible(true)} className="px-3 py-1.5 rounded-md text-xs bg-[#f59e0b] text-black font-bold">+ 添加规则</button>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[#888] border-b border-[#333]">
            <th className="text-left py-2">模型</th>
            <th className="text-left py-2">分辨率</th>
            <th className="text-left py-2">时长</th>
            <th className="text-left py-2">积分</th>
            <th className="text-right py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rules.map(r => (
            <tr key={r.id} className="border-b border-[#222]">
              <td className="py-2 text-[#e2e8f0]">{r.model?.name ?? r.modelId}</td>
              <td className="py-2 text-[#94a3b8]">{r.resolution?.label ?? '—'}</td>
              <td className="py-2 text-[#94a3b8]">{r.duration?.label ?? '—'}</td>
              <td className="py-2 text-[#f59e0b]">{r.creditCost} 积分</td>
              <td className="py-2 text-right">
                <button onClick={async () => { await deletePricingRule(r.id); load(); }} className="text-[#ef4444]">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PricingRuleFormModal visible={modalVisible} models={models} onSave={handleSave} onCancel={() => setModalVisible(false)} />
    </div>
  );
}
