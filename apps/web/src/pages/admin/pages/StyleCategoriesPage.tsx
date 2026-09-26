import { useRef } from 'react';
import type { ReactElement } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Popconfirm, Button, Tag } from 'antd';
import { adminStylesApi, type AdminStyleCategory } from '@/api/adminApi';

export default function StyleCategoriesPage() {
  const actionRef = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminStyleCategory>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '状态', dataIndex: 'active', render: (_, r) => (r.active ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
    { title: '创建时间', dataIndex: 'createdAt', width: 110, render: (_, r) => r.createdAt?.slice(0, 10) ?? '-' },
    {
      title: '操作', valueType: 'option',
      render: (_, record) => [
        <CategoryFormModal key="edit" record={record} onDone={() => actionRef.current?.reload()} trigger={<a>编辑</a>} />,
        <Popconfirm key="del" title="确认删除该分类？" onConfirm={async () => {
          try { await adminStylesApi.deleteCategory(record.id); message.success('已删除'); actionRef.current?.reload(); }
          catch (e) { message.error((e as Error).message); } // 删除保护 400 中文文案直达（spec §6.2）
        }}>
          <a className="text-accent-danger">删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="风格分类">
      <ProTable<AdminStyleCategory>
        headerTitle="分类列表" rowKey="id" search={false} size="small"
        actionRef={actionRef}
        request={async () => {
          const data = await adminStylesApi.listCategories();
          return { data, success: true, total: data.length };
        }}
        columns={columns}
        toolBarRender={() => [
          <CategoryFormModal key="create" onDone={() => actionRef.current?.reload()} trigger={<Button type="primary">新建分类</Button>} />,
        ]}
      />
    </PageContainer>
  );
}

function CategoryFormModal({ record, onDone, trigger }: { record?: AdminStyleCategory; onDone: () => void; trigger: ReactElement }) {
  const { message } = AntdApp.useApp();
  const isEdit = Boolean(record);
  return (
    <ModalForm
      title={isEdit ? '编辑分类' : '新建分类'} trigger={trigger}
      modalProps={{ destroyOnClose: true }}
      initialValues={record ? { name: record.name, sortOrder: record.sortOrder, active: record.active } : { sortOrder: 0, active: true }}
      onFinish={async (v: any) => {
        try {
          if (isEdit && record) await adminStylesApi.updateCategory(record.id, v);
          else await adminStylesApi.createCategory(v);
          message.success(isEdit ? '已更新' : '已创建');
          onDone();
          return true;
        } catch (e) { message.error((e as Error).message); return false; }
      }}
    >
      <ProFormText name="name" label="名称" rules={[{ required: true }, { max: 30 }]} />
      <ProFormDigit name="sortOrder" label="排序" initialValue={0} fieldProps={{ precision: 0 }} />
      <ProFormSwitch name="active" label="启用" initialValue={true} />
    </ModalForm>
  );
}
