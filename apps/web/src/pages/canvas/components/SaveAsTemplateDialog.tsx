import { useState } from 'react';
import { saveCanvas } from '@/api/canvasApi';

interface SaveAsTemplateDialogProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveAsTemplateDialog({ projectId, projectName, onClose, onSaved }: SaveAsTemplateDialogProps) {
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      await saveCanvas(projectId, { name: projectName, description: description.trim(), isPublic });
      onSaved();
    } catch (e: any) {
      setError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center z-[100] pt-16" onClick={onClose}>
      <div className="bg-surface border border-surface-dim rounded-lg p-6 w-full max-w-md h-fit" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-text mb-4">保存为模板</h2>
        <div className="mb-4">
          <label className="block text-xs text-text-dim-2 mb-1">项目名称</label>
          <div className="text-sm text-text px-3 py-2 bg-surface-dim border rounded">{projectName}</div>
        </div>
        <label className="block text-xs text-text-dim-2 mb-1">描述（可选）</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简要描述模板用途" rows={3}
          className="w-[96%] px-3 py-2 bg-surface-dim border rounded text-sm text-text placeholder-text-dim-1 outline-none focus:border-accent mb-3 resize-none" />
        <label className="flex items-center gap-2 text-sm text-text-dim-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-accent" />
          公开到社区
        </label>
        {error && <p className="text-xs text-accent-danger mb-2">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-6 py-2 border text-text-dim-2 rounded text-sm hover:border-text-dim-1 transition-colors">
            取消
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2 bg-accent text-on-accent rounded font-medium text-sm hover:bg-[#3bbf6f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
