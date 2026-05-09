import { useState, useEffect } from 'react';
import { fetchModels, createModel, updateModel, toggleModel, deleteModel, addResolution, addDuration, type ModelData } from '@/api/adminApi';
import { ModelFormModal } from './ModelFormModal';

interface Props { nodeTypeId: string; nodeTypeKey: string; }

export function ModelTable({ nodeTypeId, nodeTypeKey }: Props) {
  const [models, setModels] = useState<ModelData[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelData | null>(null);

  const load = () => fetchModels(nodeTypeId).then(setModels);
  useEffect(() => { load(); }, [nodeTypeId]);

  const handleSave = async (data: any) => {
    if (editingModel) {
      await updateModel(editingModel.id, data);
    } else {
      const created = await createModel(nodeTypeId, data);
      for (const r of data.resolutions || []) await addResolution(created.id, r);
      for (const d of data.durations || []) await addDuration(created.id, d);
    }
    setModalVisible(false); setEditingModel(null);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-bold text-[#e2e8f0]">模型列表</h3>
        <button onClick={() => { setEditingModel(null); setModalVisible(true); }} className="px-3 py-1.5 rounded-md text-xs bg-[#4ade80] text-black font-bold">+ 添加模型</button>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[#888] border-b border-[#333]">
            <th className="text-left py-2">名称</th><th className="text-left py-2">服务商</th>
            <th className="text-left py-2">排序</th><th className="text-left py-2">状态</th>
            <th className="text-right py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {models.map(m => (
            <tr key={m.id} className="border-b border-[#222]">
              <td className="py-2 text-[#e2e8f0]">{m.recommended && '⭐ '}{m.name}</td>
              <td className="py-2 text-[#94a3b8]">{m.provider}</td>
              <td className="py-2 text-[#94a3b8]">{m.sortOrder}</td>
              <td className="py-2">
                <span className={`px-2 py-0.5 rounded text-[10px] ${m.active ? 'bg-[#4ade80]/20 text-[#4ade80]' : 'bg-[#ef4444]/20 text-[#ef4444]'}`}>{m.active ? '上线' : '下线'}</span>
              </td>
              <td className="py-2 text-right">
                <button onClick={() => { setEditingModel(m); setModalVisible(true); }} className="text-[#60a5fa] mr-2">编辑</button>
                <button onClick={async () => { await toggleModel(m.id); load(); }} className="text-[#f59e0b] mr-2">{m.active ? '下线' : '上线'}</button>
                <button onClick={async () => { await deleteModel(m.id); load(); }} className="text-[#ef4444]">删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ModelFormModal visible={modalVisible} model={editingModel} nodeTypeKey={nodeTypeKey} onSave={handleSave} onCancel={() => { setModalVisible(false); setEditingModel(null); }} />
    </div>
  );
}
