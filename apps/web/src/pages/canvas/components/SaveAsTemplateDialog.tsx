import { useState } from 'react';
import { saveCanvas } from '@/api/canvasApi';
import { syncNodes, syncEdges } from '@/api/projectApi';
import { useCanvasStore } from '@/stores/canvasStore';

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
      const state = useCanvasStore.getState();
      await syncNodes(projectId, state.nodes as any);
      await syncEdges(projectId, state.edges as any);
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
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-6 w-full max-w-md h-fit" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[#e2e8f0] mb-4">保存项目</h2>
        <div className="mb-4">
          <label className="block text-xs text-[#888] mb-1">项目名称</label>
          <div className="text-sm text-[#e2e8f0] px-3 py-2 bg-[#252525] border border-[#333] rounded">{projectName}</div>
        </div>
        <label className="block text-xs text-[#888] mb-1">描述（可选）</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简要描述模板用途" rows={3}
          className="w-[96%] px-3 py-2 bg-[#252525] border border-[#333] rounded text-sm text-[#e2e8f0] placeholder-[#555] outline-none focus:border-[#4ade80] mb-3 resize-none" />
        <label className="flex items-center gap-2 text-sm text-[#888] mb-4 cursor-pointer">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[#4ade80]" />
          公开到社区
        </label>
        {error && <p className="text-xs text-[#ef4444] mb-2">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-6 py-2 border border-[#333] text-[#888] rounded text-sm hover:border-[#555] transition-colors cursor-pointer bg-transparent">
            取消
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-2 bg-[#4ade80] text-[#0f0f0f] rounded font-medium text-sm hover:bg-[#3bbf6f] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer border-none">
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
