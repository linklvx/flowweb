import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch, ProFormSelect, ProFormTextArea } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Input, Popconfirm, Select, Tag } from 'antd';
import { adminStylesApi, uploadStyleCover, type AdminStyle, type AdminStyleCategory } from '@/api/adminApi';

export default function StyleContentPage() {
  const actionRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();
  const [categories, setCategories] = useState<AdminStyleCategory[]>([]);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [committed, setCommitted] = useState({ categoryId: undefined as string | undefined, search: '' });

  const firstRender = useRef(true);
  useEffect(() => { void adminStylesApi.listCategories().then(setCategories).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setCommitted((prev) =>
        prev.categoryId === categoryId && prev.search === searchText.trim() ? prev : { categoryId, search: searchText.trim() });
    }, 300); // 防抖；值未变返回 prev 使 React bail-out——否则 mount 时无条件 re-commit 触发一次冗余 reload（firstRender 守卫防不住对象身份变化）
    return () => clearTimeout(t);
  }, [categoryId, searchText]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; } // 跳过 mount 首次——ProTable 自带首次 request，叠加会双请求（P2-6）
    actionRef.current?.reload();
  }, [committed]);

  const columns: ProColumns<AdminStyle>[] = [
    { title: '封面', width: 80, render: (_, r) => <img src={r.coverUrl} alt={r.name} className="h-12 w-9 rounded object-cover" /> },
    { title: '名称', dataIndex: 'name' },
    { title: '分类', render: (_, r) => r.category?.name ?? '-' },
    { title: '作者', dataIndex: 'authorName', render: (_, r) => r.authorName ?? '-' },
    { title: '可商用', dataIndex: 'isCommercial', render: (_, r) => (r.isCommercial ? <Tag color="green">商用</Tag> : '-') },
    { title: '提示词', dataIndex: 'promptText', ellipsis: true },
    { title: '使用量', dataIndex: 'usageCount', width: 80 },
    { title: '排序', dataIndex: 'sortOrder', width: 70 },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <StyleFormModal key="edit" categories={categories} record={record} onDone={() => actionRef.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该风格？（收藏/最近使用记录将一并清除）" onConfirm={async () => {
          try { await adminStylesApi.deleteStyle(record.id); message.success('已删除'); actionRef.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a className="text-accent-danger">删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="风格内容">
      {/* 页顶自定义筛选（D27——不启用 ProTable search 表单，仓内零先例） */}
      <div className="mb-4 flex items-center gap-3">
        <Select
          allowClear placeholder="全部分类" style={{ width: 180 }}
          value={categoryId} onChange={(v) => setCategoryId(v)}
          options={categories.map((c) => ({ label: c.name, value: c.id }))}
        />
        <Input.Search
          placeholder="搜索名称/作者" style={{ width: 260 }}
          value={searchText} onChange={(e) => setSearchText(e.target.value)}
          onSearch={(v) => setCommitted({ categoryId, search: v.trim() })}
        />
      </div>
      <ProTable<AdminStyle>
        headerTitle="风格列表" rowKey="id" search={false} size="small"
        actionRef={actionRef}
        request={async (params) => {
          const res = await adminStylesApi.listStyles({ ...committed, page: params.current ?? 1, pageSize: params.pageSize ?? 20 });
          return { data: res.items, success: true, total: res.total };
        }}
        columns={columns}
        toolBarRender={() => [
          <StyleFormModal key="create" categories={categories} onDone={() => actionRef.current?.reload()} trigger={<Button type="primary">新建风格</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function StyleFormModal({ categories, record, onDone, trigger }: {
  categories: AdminStyleCategory[]; record?: AdminStyle; onDone: () => void; trigger: ReactElement;
}) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  const [coverKey, setCoverKey] = useState<string | undefined>(record?.coverKey);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const { key } = await uploadStyleCover(file);
      setCoverKey(key);
      message.success('封面上传成功，保存后生效');
    } catch (e) { message.error((e as Error).message); }
    finally { setUploading(false); }
  };

  return (
    <ModalForm
      title={isEdit ? '编辑风格' : '新建风格'} trigger={trigger}
      modalProps={{ destroyOnClose: true, afterClose: () => setCoverKey(record?.coverKey) }}
      initialValues={record ? {
        name: record.name, categoryId: record.categoryId, authorName: record.authorName ?? undefined,
        isCommercial: record.isCommercial, promptText: record.promptText,
        sortOrder: record.sortOrder, active: record.active,
      } : { sortOrder: 0, active: true, isCommercial: false }}
      onFinish={async (v: any) => {
        if (!coverKey) { message.error('请先上传封面图'); return false; }
        try {
          const payload = { ...v, authorName: v.authorName || null, coverKey };
          if (isEdit && record) await adminStylesApi.updateStyle(record.id, payload);
          else await adminStylesApi.createStyle(payload);
          message.success(isEdit ? '已更新' : '已创建');
          onDone();
          return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      {/* inline style 隐藏原生控件（antd :where() 特异性压 Tailwind .hidden——HomeBannersPage:96-97 注释先例） */}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />
      <div className="mb-4">
        <div className="mb-1 text-sm">封面（3:4 建议，≤5MB，jpg/png/webp）</div>
        <Button onClick={() => fileRef.current?.click()} loading={uploading}>选择文件</Button>
        <span className="text-text-dim-2 ml-2 text-xs">{coverKey ? '已上传' : '未上传'}</span>
      </div>
      <ProFormText name="name" label="名称" rules={[{ required: true }, { max: 60 }]} />
      <ProFormSelect name="categoryId" label="分类" rules={[{ required: true }]}
        options={categories.filter((c) => c.active).map((c) => ({ label: c.name, value: c.id }))} />
      <ProFormText name="authorName" label="作者名（可选）" placeholder="留空显示「匿名」" />
      <ProFormSwitch name="isCommercial" label="可商用" initialValue={false} />
      <ProFormTextArea name="promptText" label="风格提示词（拼入生成 prompt）" rules={[{ required: true }, { max: 2000 }]} fieldProps={{ rows: 4 }} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} fieldProps={{ precision: 0 }} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
