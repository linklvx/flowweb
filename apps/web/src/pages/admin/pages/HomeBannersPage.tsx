import { useRef, useState } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch } from 'antd';
import type { HomeBannerInfo } from '@flowweb/shared';
import { fetchHomeBanners, createHomeBanner, updateHomeBanner, deleteHomeBanner, uploadHomeBannerImage } from '@/api/adminApi';

type BannerFields = Pick<HomeBannerInfo, 'title' | 'subtitle' | 'linkUrl' | 'sortOrder' | 'active'> & { imageKey: string };
// 空串收口：后端 ?? null 不捕获 ''，列表 ?? '-' 对空串不兜底
const toBannerPayload = (v: any) => ({
  title: v.title?.trim() || null,
  subtitle: v.subtitle?.trim() || null,
  linkUrl: v.linkUrl?.trim() || null,
  sortOrder: v.sortOrder,
  active: v.active,
});

export default function HomeBannersPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<HomeBannerInfo>[] = [
    { title: '预览', width: 120, render: (_, r) => (r.imageUrl ? <img src={r.imageUrl} alt={r.title ?? ''} style={{ height: 32 }} /> : '-') },
    { title: '标题', dataIndex: 'title', render: (_, r) => r.title ?? '-' },
    { title: '副标题', dataIndex: 'subtitle', render: (_, r) => r.subtitle ?? '-' },
    { title: '链接', dataIndex: 'linkUrl', ellipsis: true, render: (_, r) => r.linkUrl ?? '-' },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    {
      title: '启用', dataIndex: 'active', width: 80,
      render: (_, r) => (
        <Switch checked={r.active} onChange={(checked) => {
          void updateHomeBanner(r.id, { active: checked }).then(() => { message.success(checked ? '已启用' : '已禁用'); ref.current?.reload(); }).catch((e: Error) => message.error(e.message));
        }} />
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <BannerFormModal key="edit" mode="edit" record={r} onDone={() => ref.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该 Banner？" onConfirm={async () => {
          try { await deleteHomeBanner(r.id); message.success('已删除'); ref.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="首页 Banner">
      <ProTable<HomeBannerInfo> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchHomeBanners(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          <BannerFormModal key="create" mode="create" onDone={() => ref.current?.reload()} trigger={<Button type="primary">新建 Banner</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function BannerFormModal({ mode, record, onDone, trigger }: {
  mode: 'create' | 'edit'; record?: HomeBannerInfo; onDone: () => void; trigger: React.ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const [imageKey, setImageKey] = useState<string | undefined>(record?.imageKey);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const { imageKey: k } = await uploadHomeBannerImage(file); setImageKey(k); message.success('已上传，保存后生效'); }
    catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  return (
    <ModalForm<BannerFields>
      title={mode === 'create' ? '新建 Banner' : '编辑 Banner'} trigger={trigger}
      modalProps={{
        destroyOnClose: true,
        // 组件常驻（trigger 挂在行/工具栏），destroyOnClose 只销毁弹窗子树——关闭时重置上传 state，对齐旧组件「每次打开重置」
        afterClose: () => setImageKey(record?.imageKey),
      }}
      initialValues={record ? { title: record.title ?? undefined, subtitle: record.subtitle ?? undefined, linkUrl: record.linkUrl ?? undefined, sortOrder: record.sortOrder, active: record.active, imageKey: record.imageKey } : { sortOrder: 0, active: true }}
      onFinish={async (v) => {
        if (!imageKey) { message.error('请先上传图片'); return false; }
        try {
          const payload = toBannerPayload(v);
          if (mode === 'create') await createHomeBanner({ ...payload, imageKey });
          else if (record) await updateHomeBanner(record.id, { ...payload, imageKey });
          message.success('已保存'); onDone(); return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; /* 复位：连续选同一文件也能触发 */ }} />
      <div className="mb-4">
        <div className="mb-1 text-sm">图片（建议 1920×240，8:1，≤5MB，jpg/png/webp）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        <span className="ml-2 text-xs text-gray-400">{imageKey ? `已上传：${imageKey}` : '未上传'}</span>
      </div>
      <ProFormText name="title" label="标题（可选）" fieldProps={{ maxLength: 128 }} />
      <ProFormText name="subtitle" label="副标题（可选）" fieldProps={{ maxLength: 256 }} />
      <ProFormText name="linkUrl" label="链接 URL（可选）" fieldProps={{ maxLength: 500 }} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
