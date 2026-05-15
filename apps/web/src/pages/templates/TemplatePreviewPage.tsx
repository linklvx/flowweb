import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { getTemplate, importTemplate, deleteTemplate } from '@/api/templateApi';

export function TemplatePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTemplate(id).then((res) => {
      if (res.success) setTemplate(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const handleImport = async () => {
    if (!id) return;
    setImporting(true);
    try {
      const res = await importTemplate(id);
      if (res.success) {
        navigate(`/canvas?projectId=${res.data.id}`);
      }
    } catch (e) {
      console.error('Import failed', e);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('确定删除此模板？')) return;
    await deleteTemplate(id);
    navigate('/templates');
  };

  if (loading) return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-[#555]">加载中...</div>;
  if (!template) return <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center text-[#555]">模板不存在</div>;

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <button onClick={() => navigate('/templates')} className="text-xs text-[#888] hover:text-[#ccc] bg-transparent border-none cursor-pointer mb-4">
          ← 返回模板广场
        </button>

        <div className="bg-[#1A1A1A] border border-[#333] rounded-lg overflow-hidden">
          <div className="aspect-video bg-[#252525] flex items-center justify-center text-[#555]">
            {template.coverUrl ? (
              <img src={template.coverUrl} alt={template.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg">📄 {template.name}</span>
            )}
          </div>
          <div className="p-6">
            <h1 className="text-xl font-bold text-[#e2e8f0] mb-2">{template.name}</h1>
            {template.description && <p className="text-sm text-[#888] mb-4">{template.description}</p>}
            <div className="flex items-center gap-4 text-sm text-[#666] mb-6">
              <span>⬇ {template.importCount} 次导入</span>
              {template.category === 'OFFICIAL' && <span className="text-[#4ade80]">官方模板</span>}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-6 py-2 bg-[#4ade80] text-[#0f0f0f] rounded font-medium text-sm hover:bg-[#3bbf6f] disabled:opacity-50 transition-colors cursor-pointer border-none"
              >
                {importing ? '导入中...' : '一键导入到画布'}
              </button>
              {template.isOwner && (
                <>
                  <button
                    onClick={() => navigate(`/settings/templates`)}
                    className="px-4 py-2 border border-[#333] text-[#888] rounded text-sm hover:border-[#555] transition-colors cursor-pointer bg-transparent"
                  >
                    编辑
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 border border-[#333] text-[#ef4444] rounded text-sm hover:border-[#ef4444] transition-colors cursor-pointer bg-transparent"
                  >
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
