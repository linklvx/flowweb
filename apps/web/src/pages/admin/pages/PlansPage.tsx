import { useRef } from 'react';
import { PageContainer, ProTable, ModalForm, ProFormText, ProFormDigit, ProFormSelect } from '@ant-design/pro-components';
import type { ProColumns, ActionType } from '@ant-design/pro-components';
import { App as AntdApp, Button, Popconfirm, Switch, Tag } from 'antd';
import { fetchAdminPlans, createAdminPlan, updateAdminPlan, type AdminPlanRow } from '@/api/adminApi';
import { PLAN_TIER_COLORS } from './tier-colors';

const GB = 1024 ** 3;
// 整除显示整数，否则 1 位小数（对齐原 toGB）
const toGB = (b: number) => { const g = b / GB; return Number.isInteger(g) ? g : Number(g.toFixed(1)); };
const nonNeg = { validator: (_: unknown, v: number) => v >= 0 ? Promise.resolve() : Promise.reject(new Error('需非负')) };

export default function PlansPage() {
  const ref = useRef<ActionType>(null);
  const { message } = AntdApp.useApp();

  const columns: ProColumns<AdminPlanRow>[] = [
    { title: 'ID', dataIndex: 'id', width: 90, ellipsis: true, copyable: true },
    { title: '名称', dataIndex: 'name' },
    { title: '档位', dataIndex: 'tier', render: (_, r) => <Tag color={PLAN_TIER_COLORS[r.tier]}>{r.tier}</Tag> },
    { title: '月积分', dataIndex: 'monthlyCredits' },
    { title: '存储上限(GB)', render: (_, r) => `${toGB(r.storageLimitBytes)} GB` },
    { title: '包月原价', dataIndex: 'originalPriceMonthly' },
    { title: '包月价', dataIndex: 'priceMonthly' },
    { title: '包季原价', dataIndex: 'originalPriceQuarterly' },
    { title: '包季价', dataIndex: 'priceQuarterly' },
    { title: '包年原价', dataIndex: 'originalPriceAnnually' },
    { title: '包年价', dataIndex: 'priceAnnually' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '上架', dataIndex: 'isActive', width: 90,
      render: (_, r) => (
        <Popconfirm title={r.isActive ? '确认下架该套餐？' : '确认上架该套餐？'} onConfirm={async () => {
          try {
            await updateAdminPlan(r.id, { isActive: !r.isActive });
            message.success(r.isActive ? '已下架' : '已上架');
            ref.current?.reload();
          } catch (e) { message.error((e as Error).message); }
        }}>
          <Switch checked={r.isActive} />
        </Popconfirm>
      ),
    },
    {
      title: '操作', valueType: 'option',
      render: (_, r) => [
        <ModalForm key="edit" title="编辑套餐" trigger={<a>编辑</a>}
          modalProps={{ destroyOnClose: true }}
          initialValues={{ ...r, storageGB: toGB(r.storageLimitBytes) }}
          onFinish={async (v: any) => {
            try {
              const { storageGB, ...rest } = v; // GB 输入提交换算字节
              await updateAdminPlan(r.id, { ...rest, storageLimitBytes: storageGB * GB });
              message.success('已更新'); ref.current?.reload(); return true;
            } catch (e) { message.error((e as Error).message); return false; }
          }}>
          <PlanFields initial={r} />
        </ModalForm>,
      ],
    },
  ];

  return (
    <PageContainer title="套餐管理">
      <ProTable<AdminPlanRow>
        rowKey="id" search={false} size="middle" columns={columns} actionRef={ref}
        request={async () => { const d = await fetchAdminPlans(); return { data: d, success: true, total: d.length }; }}
        toolBarRender={() => [
          /* 新建套餐为「增强」非迁移保留：现网无新建入口（仅 seed 建）；后端 POST /plans 支持故补齐 */
          <ModalForm key="create" title="新建套餐" trigger={<Button type="primary">新建套餐</Button>}
            modalProps={{ destroyOnClose: true }}
            onFinish={async (v: any) => {
              try {
                const { storageGB, ...rest } = v;
                // 后端 createPlan 强制 isActive:true —— 新建表单不放上架开关
                await createAdminPlan({ ...rest, storageLimitBytes: storageGB * GB });
                message.success('已创建'); ref.current?.reload(); return true;
              } catch (e) { message.error((e as Error).message); return false; }
            }}>
            <PlanFields />
          </ModalForm>,
        ]}
      />
    </PageContainer>
  );
}

/** 套餐字段（tier 必填枚举 + 三组价格必填；编辑回填含 storageGB 换算） */
function PlanFields({ initial }: { initial?: AdminPlanRow }) {
  return (
    <>
      <ProFormText name="name" label="名称" initialValue={initial?.name} rules={[{ required: true }]} />
      <ProFormSelect name="tier" label="档位" initialValue={initial?.tier}
        options={[
          { label: '基础版 basic', value: 'basic' }, { label: '专业版 pro', value: 'pro' },
          { label: '高级版 max', value: 'max' }, { label: '旗舰版 ultra', value: 'ultra' },
        ]}
        rules={[{ required: true }]} />
      <ProFormDigit name="monthlyCredits" label="月积分" initialValue={initial?.monthlyCredits} rules={[{ required: true }, nonNeg]} />
      {/* toStorageBytes 要求字节正整数（小数 GB 抛 PLAN_STORAGE_LIMIT_INVALID）→ 整数 GB 输入 */}
      <ProFormDigit name="storageGB" label="存储(GB)" min={1} fieldProps={{ precision: 0 }} initialValue={initial ? toGB(initial.storageLimitBytes) : undefined} rules={[{ required: true }, { validator: (_: unknown, v: number) => v >= 1 && Number.isInteger(v) ? Promise.resolve() : Promise.reject(new Error('需≥1 的整数 GB')) }]} />
      <ProFormDigit name="priceMonthly" label="包月价(分)" initialValue={initial?.priceMonthly} rules={[{ required: true }, nonNeg]} />
      {/* 三个 original* schema @default(0)、DTO 可选 —— 不必填，留空走 0 */}
      <ProFormDigit name="originalPriceMonthly" label="包月原价(分)" initialValue={initial?.originalPriceMonthly} rules={[nonNeg]} />
      <ProFormDigit name="priceQuarterly" label="包季价(分)" initialValue={initial?.priceQuarterly} rules={[{ required: true }, nonNeg]} />
      <ProFormDigit name="originalPriceQuarterly" label="包季原价(分)" initialValue={initial?.originalPriceQuarterly} rules={[nonNeg]} />
      <ProFormDigit name="priceAnnually" label="包年价(分)" initialValue={initial?.priceAnnually} rules={[{ required: true }, nonNeg]} />
      <ProFormDigit name="originalPriceAnnually" label="包年原价(分)" initialValue={initial?.originalPriceAnnually} rules={[nonNeg]} />
      <ProFormDigit name="sort" label="排序" initialValue={initial?.sort ?? 0} />
      {!initial && <span className="text-xs opacity-60">新建后默认上架（服务端强制 isActive=true）</span>}
    </>
  );
}
