import { useEffect, useState } from 'react';
import { App, Button, Input, Modal, Switch } from 'antd';
import {
  createAnnouncement, deleteAnnouncement, fetchAnnouncements, updateAnnouncement,
} from '@/api/adminApi';
import type { AnnouncementInfo } from '@flowweb/shared';

const inputCls = 'bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-full';

interface FormState {
  message: string;
  bgColor: string;
  textColor: string;
  linkText: string;
  linkUrl: string;
  active: boolean;
}

const EMPTY: FormState = { message: '', bgColor: '#0f2761', textColor: '#ffffff', linkText: '', linkUrl: '', active: false };

export function AnnouncementManagementTab() {
  const { message: messageApi, modal } = App.useApp();
  const [list, setList] = useState<AnnouncementInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AnnouncementInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setList(await fetchAnnouncements()); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (a: AnnouncementInfo) => {
    setEditing(a);
    setForm({
      message: a.message,
      bgColor: a.bgColor,
      textColor: a.textColor,
      linkText: a.linkText ?? '',
      linkUrl: a.linkUrl ?? '',
      active: a.active,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.message.trim()) { messageApi.error('公告内容不能为空'); return; }
    if (!/^#[0-9a-fA-F]{3,8}$/.test(form.bgColor) || !/^#[0-9a-fA-F]{3,8}$/.test(form.textColor)) {
      messageApi.error('颜色格式须为 # 开头的十六进制（如 #0f2761）');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        message: form.message,
        bgColor: form.bgColor,
        textColor: form.textColor,
        linkText: form.linkText || null,
        linkUrl: form.linkUrl || null,
        active: form.active,
      };
      if (editing) await updateAnnouncement(editing.id, payload);
      else await createAnnouncement(payload);
      messageApi.success('已保存');
      setOpen(false);
      void load();
    } catch (e) {
      messageApi.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (a: AnnouncementInfo, active: boolean) => {
    if (!active) {
      void updateAnnouncement(a.id, { active: false }).then(load).catch(() => { messageApi.error('更新失败'); void load(); });
      return;
    }
    modal.confirm({
      title: '启用该公告？',
      content: '启用后将自动禁用其他公告。',
      onOk: async () => {
        try {
          await updateAnnouncement(a.id, { active: true });
          messageApi.success('已启用，其他公告已自动禁用');
          void load();
        } catch { messageApi.error('操作失败'); }
      },
    });
  };

  const handleDelete = (a: AnnouncementInfo) => {
    modal.confirm({
      title: '删除该公告？',
      content: '删除后不可恢复。',
      onOk: async () => {
        try {
          await deleteAnnouncement(a.id);
          messageApi.success('已删除');
          void load();
        } catch { messageApi.error('操作失败'); }
      },
    });
  };

  if (loading) return <div className="text-[#888] text-sm py-8">加载中...</div>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button type="primary" onClick={openCreate} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80', color: '#000' }}>
          新建公告
        </Button>
      </div>
      <div className="space-y-2">
        {list.map(a => (
          <div key={a.id} className="flex items-center gap-3 bg-[#1A1A1A] border border-[#333] rounded-lg px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#e2e8f0] truncate">{a.message}</div>
              <div className="text-xs text-[#666] mt-0.5">{new Date(a.createdAt).toLocaleString()}</div>
            </div>
            <Switch checked={a.active} checkedChildren="启用" unCheckedChildren="禁用" onChange={v => handleToggle(a, v)} />
            <Button size="small" onClick={() => openEdit(a)}>编辑</Button>
            <Button size="small" danger onClick={() => handleDelete(a)}>删除</Button>
          </div>
        ))}
        {list.length === 0 && <div className="text-center text-[#666] text-sm py-12">暂无公告</div>}
      </div>

      <Modal
        open={open}
        title={editing ? '编辑公告' : '新建公告'}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={480}
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-xs text-[#888] block mb-1">公告内容（≤200 字）</label>
            <Input.TextArea value={form.message} maxLength={200} rows={2}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">背景色</label>
              <input className={inputCls} value={form.bgColor} placeholder="#0f2761"
                onChange={e => setForm(f => ({ ...f, bgColor: e.target.value }))} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">文字色</label>
              <input className={inputCls} value={form.textColor} placeholder="#ffffff"
                onChange={e => setForm(f => ({ ...f, textColor: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">链接按钮文字（可选）</label>
              <input className={inputCls} value={form.linkText} maxLength={32}
                onChange={e => setForm(f => ({ ...f, linkText: e.target.value }))} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[#888] block mb-1">链接地址（可选）</label>
              <input className={inputCls} value={form.linkUrl} maxLength={500} placeholder="https://..."
                onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} />
            <span className="text-xs text-[#ccc]">保存后立即启用（将自动禁用其他公告）</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
