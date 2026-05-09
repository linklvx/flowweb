import { useState, useEffect } from 'react';
import { fetchNodeTypes, type NodeTypeData } from '@/api/adminApi';
import { NodeTypeTabs } from './components/NodeTypeTabs';
import { ModelTable } from './components/ModelTable';

export function AdminPage() {
  const [nodeTypes, setNodeTypes] = useState<NodeTypeData[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    fetchNodeTypes().then((data) => {
      setNodeTypes(data);
      if (data.length > 0 && !activeTab) setActiveTab(data[0].id);
    });
  }, []);

  const activeNodeType = nodeTypes.find((nt) => nt.id === activeTab);

  return (
    <div className="min-h-screen bg-[#0f0f0f] p-6">
      <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">⚙ 模型管理后台</h1>
      {nodeTypes.length > 0 && (
        <NodeTypeTabs
          nodeTypes={nodeTypes}
          activeId={activeTab || nodeTypes[0]?.id}
          onChange={setActiveTab}
        />
      )}
      {activeNodeType && (
        <ModelTable nodeTypeId={activeNodeType.id} nodeTypeKey={activeNodeType.key} />
      )}
    </div>
  );
}
