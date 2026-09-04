import { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Tag, Popconfirm } from 'antd';
import { PLAN_TIER_COLORS } from './tier-colors';
import { fetchAdminSubscriptions, cancelAdminSubscription, type AdminSubscriptionRow } from '@/api/adminApi';

export default function SubscriptionsPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminSubscriptionRow>[] = [
    { title: '用户', dataIndex: 'userId', width: 110, ellipsis: true, copyable: true },
    { title: '套餐', render: (_, r) => r.plan?.name ?? '-' },
    { title: '档位', dataIndex: 'tier', render: (_, r) => <Tag color={PLAN_TIER_COLORS[r.tier]}>{r.tier}</Tag> },
    { title: '周期', dataIndex: 'period' },
    { title: '状态', dataIndex: 'status', render: (_, r) => (r.status === 'active' ? <Tag color="green">生效中</Tag> : <Tag>{r.status}</Tag>) },
    { title: '到期日', dataIndex: 'currentPeriodEnd', render: (_, r) => r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toLocaleDateString('zh-CN') : '-' },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => r.status === 'active'
        ? [<Popconfirm key="cancel" title="确认作废该订阅？" onConfirm={async () => {
            try {
              await cancelAdminSubscription(r.id); // 仅 status:'expired'
              message.success('已作废');
              ref.current?.reload(); // 作废后刷新（否则行状态滞留）
            } catch (e) { message.error((e as Error).message); }
          }}>
            <a style={{ color: '#ff7875' }}>作废</a></Popconfirm>]
        : [<span key="none" className="opacity-50">-</span>],
    },
  ];

  return (
    <PageContainer title="订阅管理">
      <ProTable<AdminSubscriptionRow>
        rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={async ({ current = 1, pageSize = 20 }) => {
          const d = await fetchAdminSubscriptions({ page: current, pageSize });
          return { data: d.items, success: true, total: d.total };
        }}
      />
    </PageContainer>
  );
}
