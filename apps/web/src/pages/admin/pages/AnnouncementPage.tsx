import { useRef } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormSwitch } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch, Tag } from 'antd';
import type { AnnouncementInfo } from '@flowweb/shared';
import { fetchAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } from '@/api/adminApi';

type AnnFields = Omit<AnnouncementInfo, 'id' | 'createdAt' | 'updatedAt'>;
// 提交收口（对齐现网）：空串→null、message trim（可空列直存空串会让列表 ?? '-' 失效）
const toAnnPayload = (v: any) => ({
  message: v.message?.trim(),
  linkText: v.linkText?.trim() || null,
  linkUrl: v.linkUrl?.trim() || null,
  bgColor: v.bgColor, textColor: v.textColor, active: v.active,
});
const HEX_RULE = { pattern: /^#[0-9a-fA-F]{3,8}$/, message: '颜色格式须为 # 开头的十六进制（如 #0f2761）' };

export default function AnnouncementPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AnnouncementInfo>[] = [
    { title: '内容', dataIndex: 'message', ellipsis: true },
    { title: '链接文字', dataIndex: 'linkText', render: (_, r) => r.linkText ?? '-' },
    { title: '背景色', dataIndex: 'bgColor', render: (_, r) => <Tag color={r.bgColor}>{r.bgColor}</Tag> },
    { title: '文字色', dataIndex: 'textColor' },
    {
      title: '启用', dataIndex: 'active', width: 80,
      // 互斥逻辑（对齐 content.service）：禁用直改；启用弹确认（后端 active===true 才进互斥事务）
      render: (_, r) => (
        <Popconfirm title={`启用「${r.message.slice(0, 10)}」并停用其他公告？`} disabled={r.active}
          onConfirm={async () => {
            try { await updateAnnouncement(r.id, { active: true }); message.success('已启用，其他公告已自动停用'); ref.current?.reload(); }
            catch (e) { message.error((e as Error).message); }
          }}>
          <Switch checked={r.active} onChange={(checked) => {
            if (!checked) void updateAnnouncement(r.id, { active: false }).then(() => { message.success('已禁用'); ref.current?.reload(); }).catch((e: Error) => message.error(e.message));
          }} />
        </Popconfirm>
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <ModalForm key="edit" title="编辑公告" trigger={<a>编辑</a>} initialValues={r}
          modalProps={{ destroyOnClose: true }}
          onFinish={async (v: AnnFields) => {
            try { await updateAnnouncement(r.id, toAnnPayload(v)); message.success('已更新'); ref.current?.reload(); return true; }
            catch (e) { message.error((e as Error).message); return false; }
          }}>
          <AnnFormFields />
        </ModalForm>,
        <Popconfirm key="del" title="确认删除该公告？" onConfirm={async () => {
          try { await deleteAnnouncement(r.id); message.success('已删除'); ref.current?.reload(); }
          catch (e) { message.error((e as Error).message); }
        }}>
          <a style={{ color: '#ff7875' }}>删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer title="公告条">
      <ProTable<AnnouncementInfo> rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchAnnouncements(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          <ModalForm key="create" title="新建公告" trigger={<Button type="primary">新建公告</Button>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: AnnFields) => {
              try { await createAnnouncement(toAnnPayload(v)); message.success('已创建'); ref.current?.reload(); return true; }
              catch (e) { message.error((e as Error).message); return false; }
            }}>
            <AnnFormFields />
          </ModalForm>,
        ]}
      />
    </PageContainer>
  );
}

function AnnFormFields() {
  return (
    <>
      <ProFormText name="message" label="内容" rules={[{ required: true, whitespace: true, message: '公告内容不能为空' }]} />
      <ProFormText name="linkText" label="链接文字（可选）" />
      <ProFormText name="linkUrl" label="链接 URL（可选）" />
      <ProFormText name="bgColor" label="背景色" initialValue="#0f2761" rules={[HEX_RULE]} />
      <ProFormText name="textColor" label="文字色" initialValue="#ffffff" rules={[HEX_RULE]} />
      {/* 新建默认不启用：启用走互斥事务，新建即启用会撞全局唯一启用索引 */}
      <ProFormSwitch name="active" label="启用" initialValue={false} />
    </>
  );
}
