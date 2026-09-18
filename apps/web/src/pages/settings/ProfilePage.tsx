import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

export function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [image, setImage] = useState(user?.image || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasChanges = name !== (user?.name || '') || image !== (user?.image || '');
  const canSave = hasChanges && !saving && name.length >= 1 && name.length <= 50;

  if (!user) return null;

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: image || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || '更新失败');
        return;
      }
      updateUser(json.data.user);
      setEditing(false);
    } catch {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setName(user.name || '');
    setImage(user.image || '');
    setEditing(false);
    setError('');
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-text mb-6">个人资料</h2>
      <div className="bg-[#1a1a1a] border rounded-xl p-6 max-w-lg">
        {error && <p className="text-accent-danger text-xs mb-4">{error}</p>}

        {/* Avatar */}
        <div className="mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#333] overflow-hidden shrink-0">
            {user.image ? (
              <img src={user.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#888] text-2xl">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
            )}
          </div>
          <div>
            <p className="text-text text-sm font-medium">{user.name}</p>
            <p className="text-[#888] text-xs">{user.email}</p>
          </div>
        </div>

        {editing ? (
          <>
            <label className="block text-xs text-[#888] mb-1">头像 URL</label>
            <input
              type="text"
              value={image}
              onChange={e => setImage(e.target.value)}
              placeholder="https://example.com/avatar.png"
              className="w-full bg-[#0f0f0f] border rounded-md px-3 py-2 text-sm text-[#ccc] mb-4"
            />
            <label className="block text-xs text-[#888] mb-1">用户名</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              className="w-full bg-[#0f0f0f] border rounded-md px-3 py-2 text-sm text-[#ccc] mb-6"
            />
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="px-4 py-2 bg-accent text-on-accent rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 border border-[#555] text-[#ccc] rounded-lg text-sm hover:border-[#888] transition-colors"
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4">
              <span className="text-xs text-[#888]">用户名</span>
              <p className="text-sm text-text">{user.name}</p>
            </div>
            <div className="mb-4">
              <span className="text-xs text-[#888]">邮箱</span>
              <p className="text-sm text-[#666]">{user.email}</p>
            </div>
            <div className="mb-4">
              <span className="text-xs text-[#888]">注册时间</span>
              <p className="text-sm text-text">{formatDate(user.createdAt)}</p>
            </div>
            {user.updatedAt && (
              <div className="mb-6">
                <span className="text-xs text-[#888]">最后更新</span>
                <p className="text-sm text-text">{formatDate(user.updatedAt)}</p>
              </div>
            )}
            <button
              onClick={() => setEditing(true)}
              className="px-4 py-2 border border-accent text-accent-text rounded-lg text-sm hover:bg-[#4ade80]/10 transition-colors"
            >
              编辑资料
            </button>
          </>
        )}
      </div>
    </div>
  );
}
