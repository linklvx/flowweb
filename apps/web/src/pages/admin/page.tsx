import { useState, useEffect } from 'react';
import { fetchNodeTypes, type NodeTypeData } from '@/api/adminApi';
import { NodeTypeTabs } from './components/NodeTypeTabs';
import { ModelTable } from './components/ModelTable';
import { PricingRuleTable } from './components/PricingRuleTable';
import { PlanManagementTab, SubscriptionManagementTab, CreditManagementTab } from './components/SubscriptionTabs';

export function AdminPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [section, setSection] = useState<'models' | 'subscription'>('models');
  const [subTab, setSubTab] = useState<'plans' | 'subscriptions' | 'credits'>('plans');
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
      <h1 className="text-xl font-bold text-[#e2e8f0] mb-2">管理后台</h1>
      <div className="flex gap-3 mb-6">
        {(['models', 'subscription'] as const).map(s => (
          <button key={s} onClick={() => setSection(s)}
            className={`px-4 py-1.5 rounded-md text-sm border-none cursor-pointer transition-colors ${
              section === s ? 'bg-[#4ade80]/20 text-[#4ade80] font-bold' : 'bg-[#252525] text-[#888] hover:text-white'
            }`}
          >
            {s === 'models' ? '模型管理' : '会员订阅'}
          </button>
        ))}
      </div>

      {section === 'subscription' && (
        <div>
          <div className="flex gap-2 mb-6">
            {(['plans', 'subscriptions', 'credits'] as const).map(t => (
              <button key={t} onClick={() => setSubTab(t)}
                className={`px-3 py-1 rounded text-xs border border-[#444] cursor-pointer transition-colors ${
                  subTab === t ? 'bg-[#4ade80]/20 text-[#4ade80] border-[#4ade80]' : 'bg-[#1A1A1A] text-[#888] hover:text-white'
                }`}
              >
                {t === 'plans' ? '套餐管理' : t === 'subscriptions' ? '订阅管理' : '积分管理'}
              </button>
            ))}
          </div>
          {subTab === 'plans' && <PlanManagementTab />}
          {subTab === 'subscriptions' && <SubscriptionManagementTab />}
          {subTab === 'credits' && <CreditManagementTab />}
        </div>
      )}

      {section === 'models' && (
        loading ? (
          <div className="text-[#888] text-sm py-8">加载中...</div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-[#888] text-sm mb-4">数据加载失败</p>
            <button onClick={load} className="px-4 py-2 bg-[#252525] border border-[#444] rounded-md text-xs text-[#ccc] hover:border-[#4ade80] transition-colors">
              重新加载
            </button>
          </div>
        ) : (
          nodeTypes.length > 0 ? (
            <>
              <NodeTypeTabs nodeTypes={nodeTypes} activeId={activeTab || nodeTypes[0]?.id} onChange={setActiveTab} />
              {activeNodeType && (
                <>
                  <ModelTable nodeTypeId={activeNodeType.id} nodeTypeKey={activeNodeType.key} />
                  <div className="mt-8">
                    <PricingRuleTable nodeTypeId={activeNodeType.id} />
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-center py-16">
              <p className="text-[#666] text-sm">暂未配置节点类型，请先执行种子数据</p>
            </div>
          )
        )
      )}
    </div>
  );
}
