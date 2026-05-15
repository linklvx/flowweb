import { useState } from 'react';
import { createTemplate } from '@/api/templateApi';

interface SaveAsTemplateDialogProps {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SaveAsTemplateDialog({ projectId, onClose, onSaved }: SaveAsTemplateDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createTemplate({ projectId, name: name.trim(), description: description.trim(), isPublic });
      onSaved();
    } catch (e) {
      console.error('Save template failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#1A1A1A] border border-[#333] rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[#e2e8f0] mb-4">保存为模板</h2>
        <label className="block text-xs text-[#888] mb-1">模板名称</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入模板名称"
          className="w-full px-3 py-2 bg-[#252525] border border-[#333] rounded text-sm text-[#e2e8f0] placeholder-[#555] outline-none focus:border-[#4ade80] mb-3" />
        <label className="block text-xs text-[#888] mb-1">描述（可选）</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简要描述模板用途" rows={3}
          className="w-full px-3 py-2 bg-[#252525] border border-[#333] rounded text-sm text-[#e2e8f0] placeholder-[#555] outline-none focus:border-[#4ade80] mb-3 resize-none" />
        <label className="flex items-center gap-2 text-sm text-[#888] mb-4 cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[#4ade80]" />
          公开到社区
        </label>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 border border-[#333] text-[#888] rounded text-sm hover:border-[#555] transition-colors cursor-pointer bg-transparent">
            取消
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="px-4 py-2 bg-[#4ade80] text-[#0f0f0f] rounded font-medium text-sm hover:bg-[#3bbf6f] disabled:opacity-50 transition-colors cursor-pointer border-none">
            {saving ? '保存中...' : '保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
}
