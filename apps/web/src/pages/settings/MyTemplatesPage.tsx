import { useState, useEffect, useCallback } from 'react';
import { getTemplates, deleteTemplate, updateTemplate } from '@/api/templateApi';
import { TemplateCard } from '../templates/TemplateCard';
import { EditTemplateDialog } from './EditTemplateDialog';

export function MyTemplatesPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTemplates({ type: 'my', limit: 100 });
      setTemplates(data.templates);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleTogglePublic = async (tpl: any) => {
    await updateTemplate(tpl.id, { isPublic: !tpl.isPublic });
    fetchData();
  };

  if (loading) return <div className="text-[#555]">加载中...</div>;

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-4">我的作品</h2>
      {templates.length === 0 ? (
        <p className="text-[#555]">暂无模板，前往画布页面创建。</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="bg-[#1A1A1A] border border-[#333] rounded-lg p-3">
              <TemplateCard {...tpl} />
              <div className="flex gap-2 mt-2 pt-2 border-t border-[#252525]">
                <button
                  onClick={() => setEditingTemplate(tpl)}
                  className="text-xs px-2 py-1 bg-[#252525] text-[#888] rounded hover:text-[#ccc] transition-colors cursor-pointer border-none"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleTogglePublic(tpl)}
                  className="text-xs px-2 py-1 bg-[#252525] text-[#888] rounded hover:text-[#ccc] transition-colors cursor-pointer border-none"
                >
                  {tpl.isPublic ? '设为私有' : '设为公开'}
                </button>
                <button
                  onClick={() => handleDelete(tpl.id)}
                  className="text-xs px-2 py-1 bg-[#252525] text-[#ef4444] rounded hover:text-[#f66] transition-colors cursor-pointer border-none"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingTemplate && (
        <EditTemplateDialog
          template={editingTemplate}
          onClose={() => setEditingTemplate(null)}
          onSaved={() => { setEditingTemplate(null); fetchData(); }}
        />
      )}
    </div>
  );
}
