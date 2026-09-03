import { useState, useEffect, useRef } from 'react';
import { Table, Button, Tag, message, Modal, InputNumber, Input } from 'antd';

const PLAN_COLORS: Record<string, string> = { basic: '#9ca3af', pro: '#3b82f6', max: '#a855f7', ultra: '#f59e0b' };
const API = '/api/admin/subscription';
const GB = 1024 ** 3;
// 裸除法对 53.25GB 会渲染两位小数，显式收敛：整除显示整数，否则 1 位小数
const toGB = (b: number) => { const g = b / GB; return Number.isInteger(g) ? g : Number(g.toFixed(1)); };

export function PlanManagementTab() {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const numberRef = useRef<number>(0);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(API + '/plans').then(d => d.json());
      if (r.code === 0) setPlans(r.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const cellKey = (id: string, field: string) => `${id}::${field}`;

  const save = async (id: string, field: string, value: any) => {
    setEditingCell(null);
    try {
      await fetch(`${API}/plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      message.success('已更新');
      load();
    } catch { message.error('更新失败'); load(); }
  };

  const renderTextEdit = (v: string, record: any, field: string) => {
    if (editingCell === cellKey(record.id, field)) {
      return (
        <Input
          autoFocus
          defaultValue={v}
          size="small"
          onBlur={e => save(record.id, field, e.target.value)}
          onPressEnter={e => save(record.id, field, (e.target as HTMLInputElement).value)}
          onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
        />
      );
    }
    return <div onClick={() => setEditingCell(cellKey(record.id, field))} style={{ cursor: 'pointer', minHeight: 22 }}>{v}</div>;
  };

  const renderNumberEdit = (
    v: number, record: any, field: string, min?: number,
    opts?: { transform?: (val: number) => number; editProps?: { step?: number; precision?: number } },
  ) => {
    if (editingCell === cellKey(record.id, field)) {
      numberRef.current = v;
      const commit = () => save(record.id, field, opts?.transform ? opts.transform(numberRef.current) : numberRef.current);
      return (
        <InputNumber
          autoFocus
          defaultValue={v}
          size="small"
          style={{ width: '100%' }}
          min={min ?? 0}
          onChange={val => { numberRef.current = val ?? 0; }}
          onBlur={commit}
          onPressEnter={commit}
          onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
          {...(opts?.editProps ?? {})}
        />
      );
    }
    return <div onClick={() => setEditingCell(cellKey(record.id, field))} style={{ cursor: 'pointer', minHeight: 22 }}>{v}</div>;
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100, ellipsis: true },
    { title: '名称', dataIndex: 'name', key: 'name', render: (v: string, r: any) => renderTextEdit(v, r, 'name') },
    { title: '档位', dataIndex: 'tier', key: 'tier', render: (v: string) => <Tag color={PLAN_COLORS[v]}>{v}</Tag> },
    { title: '月积分', dataIndex: 'monthlyCredits', key: 'monthlyCredits', render: (v: number, r: any) => renderNumberEdit(v, r, 'monthlyCredits') },
    { title: '存储上限(GB)', dataIndex: 'storageLimitBytes', key: 'storageLimitBytes', render: (v: number, r: any) => renderNumberEdit(toGB(v), r, 'storageLimitBytes', 1, { transform: g => g * GB, editProps: { step: 1, precision: 0 } }) },
    { title: '包月原价', dataIndex: 'originalPriceMonthly', key: 'originalPriceMonthly', render: (v: number, r: any) => renderNumberEdit(v, r, 'originalPriceMonthly') },
    { title: '包月价', dataIndex: 'priceMonthly', key: 'priceMonthly', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceMonthly') },
    { title: '包季原价', dataIndex: 'originalPriceQuarterly', key: 'originalPriceQuarterly', render: (v: number, r: any) => renderNumberEdit(v, r, 'originalPriceQuarterly') },
    { title: '包季价', dataIndex: 'priceQuarterly', key: 'priceQuarterly', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceQuarterly') },
    { title: '包年原价', dataIndex: 'originalPriceAnnually', key: 'originalPriceAnnually', render: (v: number, r: any) => renderNumberEdit(v, r, 'originalPriceAnnually') },
    { title: '包年价', dataIndex: 'priceAnnually', key: 'priceAnnually', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceAnnually') },
    { title: '排序', dataIndex: 'sort', key: 'sort' },
    { title: '状态', dataIndex: 'isActive', key: 'isActive', render: (v: boolean) => v ? <Tag color="green">上架</Tag> : <Tag color="default">下架</Tag> },
  ];

  return <Table rowKey="id" columns={columns} dataSource={plans} loading={loading} size="small" pagination={false} />;
}

export function SubscriptionManagementTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(API + '/subscriptions').then(d => d.json());
      if (r.code === 0) setData(r.data.items);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleCancel = async (id: string) => {
    try {
      await fetch(API + '/subscriptions/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'expired' }),
      });
      message.success('已作废');
      load();
    } catch { message.error('操作失败'); }
  };

  const columns = [
    { title: '用户', dataIndex: 'userId', key: 'userId', width: 100, ellipsis: true },
    { title: '档位', dataIndex: 'tier', key: 'tier', render: (v: string) => <Tag color={PLAN_COLORS[v]}>{v}</Tag> },
    { title: '周期', dataIndex: 'period', key: 'period' },
    { title: '状态', dataIndex: 'status', key: 'status' },
    { title: '到期日', dataIndex: 'currentPeriodEnd', key: 'currentPeriodEnd', render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '操作', key: 'action', render: (_: any, r: any) =>
      r.status === 'active' ? <Button size="small" danger onClick={() => handleCancel(r.id)}>作废</Button> : null
    },
  ];

  return <Table rowKey="id" columns={columns} dataSource={data} loading={loading} size="small" />;
}

export function CreditManagementTab() {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState(0);
  const [creditType, setCreditType] = useState<'regular' | 'subscription'>('regular');
  const [loading, setLoading] = useState(false);

  const handleGrant = async () => {
    if (!userId || amount <= 0) return message.warning('请填写完整信息');
    setLoading(true);
    try {
      await fetch(API + '/credits/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount, creditType }),
      });
      message.success('发放成功');
    } catch { message.error('发放失败'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-[#888] block mb-1">用户ID</label>
          <input className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white w-48" value={userId} onChange={e => setUserId(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#888] block mb-1">积分数</label>
          <InputNumber className="w-32" value={amount} onChange={v => setAmount(v ?? 0)} min={1} />
        </div>
        <div>
          <label className="text-xs text-[#888] block mb-1">类型</label>
          <select className="bg-[#252525] border border-[#444] rounded px-3 py-1.5 text-sm text-white" value={creditType} onChange={e => setCreditType(e.target.value as any)}>
            <option value="regular">普通积分</option>
            <option value="subscription">订阅积分</option>
          </select>
        </div>
        <Button type="primary" loading={loading} onClick={handleGrant} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80' }}>发放</Button>
      </div>
    </div>
  );
}

export { BannerManagementTab } from './BannerManagementTab';
