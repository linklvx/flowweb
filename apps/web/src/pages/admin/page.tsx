import { useState, useEffect } from 'react';
import { fetchNodeTypes, type NodeTypeData } from '@/api/adminApi';
import { NodeTypeTabs } from './components/NodeTypeTabs';
import { ModelTable } from './components/ModelTable';
import { PricingRuleTable } from './components/PricingRuleTable';

export function AdminPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchNodeTypes()
      .then((data) => {
        setNodeTypes(data);
        if (data.length > 0 && !activeTab) setActiveTab(data[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const activeNodeType = nodeTypes.find((nt) => nt.id === activeTab);

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-6">
      <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">⚙ 模型管理后台</h1>
      {loading ? (
        <div className="text-[#888] text-sm py-8">加载中...</div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-[#888] text-sm mb-4">数据加载失败</p>
          <button onClick={load} className="px-4 py-2 bg-[#252525] border border-[#444] rounded-md text-xs text-[#ccc] hover:border-[#4ade80] transition-colors">
            重新加载
          </button>
        </div>
      ) : (
        <>
          {nodeTypes.length > 0 && (
            <NodeTypeTabs nodeTypes={nodeTypes} activeId={activeTab || nodeTypes[0]?.id} onChange={setActiveTab} />
          )}
          {activeNodeType && (
            <>
              <ModelTable nodeTypeId={activeNodeType.id} nodeTypeKey={activeNodeType.key} />
              <div className="mt-8">
                <PricingRuleTable nodeTypeId={activeNodeType.id} />
              </div>
            </>
          )}
          {nodeTypes.length === 0 && (
            <div className="text-center py-16">
              <p className="text-[#666] text-sm">暂未配置节点类型，请先执行种子数据</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
