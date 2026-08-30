import { useEffect, useRef, useState } from 'react';
import { App, Button, InputNumber, Modal, Switch } from 'antd';
import {
  createHomeBanner, deleteHomeBanner, fetchHomeBanners, updateHomeBanner, uploadHomeBannerImage,
} from '@/api/adminApi';
import type { HomeBannerInfo } from '@flowweb/shared';

const inputCls = 'bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full';

interface FormState {
  title: string;
  subtitle: string;
  linkUrl: string;
  imageKey: string;
  sortOrder: number;
  active: boolean;
}

const EMPTY: FormState = { title: '', subtitle: '', linkUrl: '', imageKey: '', sortOrder: 0, active: true };

export function HomeBannerManagementTab() {
  const { message: messageApi, modal } = App.useApp();
  const [list, setList] = useState<HomeBannerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HomeBannerInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try { setList(await fetchHomeBanners()); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setFileName(''); setOpen(true); };
  const openEdit = (b: HomeBannerInfo) => {
    setEditing(b);
    setForm({
      title: b.title ?? '',
      subtitle: b.subtitle ?? '',
      linkUrl: b.linkUrl ?? '',
      imageKey: b.imageKey ?? '',
      sortOrder: b.sortOrder,
      active: b.active,
    });
    setFileName('');
    setOpen(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) { messageApi.error('仅支持 jpg/png/webp'); return; }
    if (file.size > 5 * 1024 * 1024) { messageApi.error('文件 ≤ 5MB'); return; }
    setUploading(true);
    try {
      const { imageKey } = await uploadHomeBannerImage(file);
      setForm(f => ({ ...f, imageKey }));
      setFileName(file.name);
      messageApi.success('上传成功');
    } catch (err) {
      messageApi.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.imageKey) { messageApi.error('请先上传图片'); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title || null,
        subtitle: form.subtitle || null,
        linkUrl: form.linkUrl || null,
        imageKey: form.imageKey,
        sortOrder: form.sortOrder,
        active: form.active,
      };
      if (editing) await updateHomeBanner(editing.id, payload);
      else await createHomeBanner(payload);
      messageApi.success('已保存');
      setOpen(false);
      void load();
    } catch (e) {
      messageApi.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (b: HomeBannerInfo, active: boolean) => {
    void updateHomeBanner(b.id, { active }).then(() => {
      messageApi.success(active ? '已启用' : '已禁用');
      void load();
    }).catch(() => { messageApi.error('更新失败'); void load(); });
  };

  const handleDelete = (b: HomeBannerInfo) => {
    modal.confirm({
      title: '删除该 Banner？',
      content: '服务器上的图片文件将一并删除。',
      onOk: async () => {
        await deleteHomeBanner(b.id);
        messageApi.success('已删除');
        void load();
      },
    });
  };

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button type="primary" onClick={openCreate} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}>
          新建 Banner
        </Button>
      </div>
      <div className="space-y-2">
        {list.map(b => (
          <div key={b.id} className="flex items-center gap-3 bg-[#1A1A1A] border border-[#333] rounded-lg px-4 py-3">
            {b.imageUrl ? (
              <img src={b.imageUrl} alt={b.title ?? 'Banner'} className="w-40 h-10 rounded object-cover shrink-0" />
            ) : (
              <div className="w-40 h-10 rounded bg-[#252525] shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#e2e8f0] truncate">{b.title || '（无标题）'}</div>
              <div className="text-xs text-[#666] mt-0.5 truncate">排序 {b.sortOrder} · {b.linkUrl || '无链接'}</div>
            </div>
            <Switch checked={b.active} onChange={v => handleToggle(b, v)} />
            <Button size="small" onClick={() => openEdit(b)}>编辑</Button>
            <Button size="small" danger onClick={() => handleDelete(b)}>删除</Button>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[#666] text-sm py-12">暂无 Banner</div>}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑 Banner' : '新建 Banner'}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={520}
      >
        <div className="space-y-3 pt-2">
          <div className="border-t border-[#333] pt-3">
            <label className="text-xs text-[#888] block mb-1">图片（建议 1920×240，8:1 比例，≤5MB）</label>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleUpload} />
            <div className="flex gap-2 items-center">
              <button
                className="px-3 py-1.5 rounded text-xs bg-[#252525] border border-[#555] text-[#ccc] hover:border-[#4ade80] transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? '上传中...' : '选择文件'}
              </button>
              <span className="text-xs text-[#4ade80]">{fileName || (form.imageKey ? '已有图片（可替换）' : 'jpg/png/webp, ≤5MB')}</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-[#888] block mb-1">标题（可选）</label>
            <input className={inputCls} value={form.title} maxLength={128}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-[#888] block mb-1">副标题（可选）</label>
            <input className={inputCls} value={form.subtitle} maxLength={256}
              onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">跳转链接（可选）</label>
              <input className={inputCls} value={form.linkUrl} maxLength={500} placeholder="https://..."
                onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-[#888] block mb-1">排序</label>
              <InputNumber min={0} value={form.sortOrder}
                onChange={v => setForm(f => ({ ...f, sortOrder: v ?? 0 }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
            <span className="text-xs text-[#ccc]">启用（在首页轮播中显示）</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
