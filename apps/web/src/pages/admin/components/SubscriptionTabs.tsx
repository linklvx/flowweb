import { useState, useEffect, useRef } from 'react';
import { Table, Button, Tag, message, Modal, InputNumber, Input } from 'antd';

const PLAN_COLORS: Record<string, string> = { basic: '#9ca3af', pro: '#3b82f6', max: '#a855f7', ultra: '#f59e0b' };
const API = '/api/admin/subscription';

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

  const renderNumberEdit = (v: number, record: any, field: string, min?: number) => {
    if (editingCell === cellKey(record.id, field)) {
      numberRef.current = v;
      return (
        <InputNumber
          autoFocus
          defaultValue={v}
          size="small"
          style={{ width: '100%' }}
          min={min ?? 0}
          onChange={val => { numberRef.current = val ?? 0; }}
          onBlur={() => save(record.id, field, numberRef.current)}
          onPressEnter={() => save(record.id, field, numberRef.current)}
          onKeyDown={e => { if (e.key === 'Escape') setEditingCell(null); }}
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
    { title: '包月价', dataIndex: 'priceMonthly', key: 'priceMonthly', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceMonthly') },
    { title: '首次包月价', dataIndex: 'firstPriceMonthly', key: 'firstPriceMonthly', render: (v: number, r: any) => renderNumberEdit(v, r, 'firstPriceMonthly') },
    { title: '包季价', dataIndex: 'priceQuarterly', key: 'priceQuarterly', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceQuarterly') },
    { title: '首次包季价', dataIndex: 'firstPriceQuarterly', key: 'firstPriceQuarterly', render: (v: number, r: any) => renderNumberEdit(v, r, 'firstPriceQuarterly') },
    { title: '包年价', dataIndex: 'priceAnnually', key: 'priceAnnually', render: (v: number, r: any) => renderNumberEdit(v, r, 'priceAnnually') },
    { title: '首次包年价', dataIndex: 'firstPriceAnnually', key: 'firstPriceAnnually', render: (v: number, r: any) => renderNumberEdit(v, r, 'firstPriceAnnually') },
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
        body: JSON.stringify({ status: 'cancelled' }),
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
