import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { getTemplate, importTemplate, deleteTemplate } from '@/api/templateApi';

export function TemplatePreviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const isWorks = location.pathname.startsWith('/works');
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTemplate(id).then((data) => {
      setTemplate(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const handleImport = async () => {
    if (!id) return;
    setImporting(true);
    try {
      const data = await importTemplate(id);
      navigate(`/canvas?projectId=${data.id}`);
    } catch (e) {
      console.error('Import failed', e);
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('确定删除此模板？')) return;
    await deleteTemplate(id);
    navigate(isWorks ? '/works' : '/templates');
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-text-dim-1">加载中...</div>;
  if (!template) return <div className="flex items-center justify-center py-16 text-text-dim-1">模板不存在</div>;

  const content = (
    <div className="py-8">
      <button onClick={() => navigate(isWorks ? '/works' : '/templates')} className="text-xs text-text-dim-2 hover:text-text mb-4">
        ← 返回{isWorks ? '工作空间' : '模板广场'}
      </button>

      <div className="bg-surface border rounded-lg overflow-hidden">
        <div className="aspect-video bg-surface-dim flex items-center justify-center text-text-dim-1">
          {template.coverUrl ? (
            <img src={template.coverUrl} alt={template.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg">📄 {template.name}</span>
          )}
        </div>
        <div className="p-6">
          <h1 className="text-xl font-bold text-text mb-2">{template.name}</h1>
          {template.description && <p className="text-sm text-text-dim-2 mb-4">{template.description}</p>}
          <div className="flex items-center gap-4 text-sm text-text-dim-1 mb-6">
            <span>⬇ {template.importCount} 次导入</span>
            {template.category === 'OFFICIAL' && <span className="text-accent-text">官方模板</span>}
          </div>

          <div className="flex gap-3">
            {template.isOwner && template.projectId && (
              <button
                onClick={() => navigate(`/canvas?projectId=${template.projectId}`)}
                className="px-6 py-2 bg-accent text-on-accent rounded font-medium text-sm hover:bg-[#3bbf6f] transition-colors"
              >
                打开项目
              </button>
            )}
            {!template.isOwner && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-6 py-2 bg-accent text-on-accent rounded font-medium text-sm hover:bg-[#3bbf6f] disabled:opacity-50 transition-colors"
              >
                {importing ? '导入中...' : '一键导入到画布'}
              </button>
            )}
            {template.isOwner && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-2 border text-text-dim-2 rounded text-sm hover:border-text-dim-1 transition-colors"
              >
                {importing ? '导入中...' : '创建副本'}
              </button>
            )}
            {template.isOwner && (
              <button
                onClick={handleDelete}
                className="px-4 py-2 border text-accent-danger rounded text-sm hover:border-accent-danger transition-colors"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {content}
    </div>
  );
}