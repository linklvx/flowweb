import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { Button, message } from 'antd';
import {
  getMyTeams, getTeamBalanceView, listTeamPlans, listTeamRechargeOrders,
  createTeamRechargeOrder, payTeamOrder, createSubscriptionOrder,
  teamDisplayName, type MyTeam, type TeamPlanRow, type TeamRechargeOrderRow,
} from '@/api/teamApi';
import { WeChatQRModal } from '@/components/WeChatQRModal';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200, 500];
const PAGE_SIZE = 20;

interface QrState { orderNo: string; codeUrl: string; amount: number }

/** 团队账单页：订阅+充值独立于 /team 管理页；默认团队跳个人积分页（六禁：默认团队不允许团队套餐） */
export default function TeamBillingPage() {
  const { id } = useParams<{ id: string }>();
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [balance, setBalance] = useState<{ credits: number; subscriptionCredits: number; total: number } | null>(null);
  const [plans, setPlans] = useState<TeamPlanRow[]>([]);
  const [orders, setOrders] = useState<{ items: TeamRechargeOrderRow[]; total: number }>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number>(PRESET_AMOUNTS[0]);
  const [qr, setQr] = useState<QrState | null>(null);

  const team = teams?.find((t) => t.id === id) ?? null;

  useEffect(() => {
    getMyTeams().then(setTeams).catch((e) => message.error('加载失败：' + (e as Error).message));
  }, []);

  const refresh = async (teamId: string, nextPage = 1) => {
    const [b, ps, os] = await Promise.all([
      getTeamBalanceView(teamId),
      listTeamPlans().catch(() => []),
      listTeamRechargeOrders(teamId, nextPage, PAGE_SIZE),
    ]);
    setBalance(b);
    setPlans(ps);
    setOrders(os);
    setPage(nextPage);
  };

  useEffect(() => {
    if (id && team && !team.isDefault) void refresh(id).catch(() => {});
  }, [id, team?.id, team?.isDefault]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (teams === null) return <div />;
  if (!team) {
    return (
      <div className="text-white">
        <p className="max-w-xl mx-auto py-24 text-sm text-[#888]" data-testid="billing-forbidden">无权访问该团队或团队不存在。<Link to="/team" className="text-[#5DDCFF]">返回团队管理</Link></p>
      </div>
    );
  }
  if (team.isDefault) {
    return (
      <div data-testid="redirect-personal">
        <Navigate to="/settings/credits" replace />
      </div>
    );
  }

  const doRecharge = async () => {
    if (!id) return;
    try {
      const { outTradeNo } = await createTeamRechargeOrder(id, selected);
      const pay = await payTeamOrder(id, outTradeNo);
      if (pay.codeUrl) setQr({ orderNo: outTradeNo, codeUrl: pay.codeUrl, amount: pay.amount / 100 });
      else message.error('下单失败');
    } catch (e) {
      message.error('下单失败：' + (e as Error).message);
    }
  };

  const doSubscribe = async (planId: string) => {
    if (!id) return;
    try {
      const { outTradeNo } = await createSubscriptionOrder(id, planId);
      const pay = await payTeamOrder(id, outTradeNo);
      if (pay.codeUrl) setQr({ orderNo: outTradeNo, codeUrl: pay.codeUrl, amount: pay.amount / 100 });
      else message.error('下单失败');
    } catch (e) {
      message.error('下单失败：' + (e as Error).message);
    }
  };

  const statusBadge = (s: string) =>
    s === 'SUCCESS' ? <span className="text-[#4ade80]">成功</span>
    : s === 'PENDING' ? <span className="text-[#f59e0b]">待支付</span>
    : <span className="text-[#888]">{s === 'CLOSED' ? '已关闭' : '失败'}</span>;

  return (
    <div className="text-white">
      <div className="max-w-4xl mx-auto p-8">
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-bold">{teamDisplayName(team)} · 账单</h2>
          {team.subscription && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#4ade80]/20 text-[#4ade80]">
              {team.subscription.planName} · 至 {new Date(team.subscription.currentPeriodEnd).toLocaleDateString()}
            </span>
          )}
          <Link to="/team" className="ml-auto text-xs text-[#888] no-underline">返回团队管理</Link>
        </div>

        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <p className="text-3xl font-bold text-[#f59e0b]" data-testid="billing-balance-total">{(balance?.total ?? 0).toLocaleString()}</p>
          <p className="text-xs text-[#888] mt-1">可用积分（通用 {balance?.credits ?? 0} · 订阅 {balance?.subscriptionCredits ?? 0}）</p>
        </div>

        <h3 className="text-sm font-bold mb-3">积分充值（1 元 = 10 积分）</h3>
        <div className="grid grid-cols-6 gap-2 mb-4">
          {PRESET_AMOUNTS.map((yuan) => (
            <button key={yuan} onClick={() => setSelected(yuan)}
              className={`py-3 rounded-lg text-sm border cursor-pointer ${selected === yuan ? 'border-[#5DDCFF] bg-[#5DDCFF]/10 text-white' : 'border-white/10 text-[#888]'}`}>
              <div>¥{yuan}</div>
              <div className="text-xs opacity-70">{yuan * 10} 积分</div>
            </button>
          ))}
        </div>
        <Button type="primary" block onClick={doRecharge} style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}>
          微信支付 ¥{selected}
        </Button>

        <h3 className="text-sm font-bold mt-8 mb-3">团队套餐订阅</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {plans.map((p) => (
            <div key={p.id} className="bg-white/5 rounded-lg p-4 flex flex-col gap-2">
              <p className="text-base font-bold">{p.name}</p>
              <p className="text-2xl font-bold text-[#4ade80]">¥{(p.priceMonthly / 100).toFixed(0)}<span className="text-xs text-[#888]">/月</span></p>
              <p className="text-xs text-[#888]">月发放 {p.monthlyCredits} 积分 · {p.seatLimit} 席位</p>
              <Button size="small" onClick={() => void doSubscribe(p.id)}>开通团队订阅</Button>
            </div>
          ))}
        </div>
        {team.subscription && <p className="text-xs text-[#666] mb-4">已有生效订阅，到期后可再次开通。</p>}

        <h3 className="text-sm font-bold mt-8 mb-3">订单记录（充值 + 订阅）</h3>
        <div className="divide-y divide-white/5">
          {orders.items.map((o) => (
            <div key={o.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-xs text-[#888]">{o.outTradeNo}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-[#aaa]">{o.kind === 'subscription' ? '订阅' : '充值'}</span>
              <span>+¥{(o.amountFen / 100).toFixed(2)}</span>
              {statusBadge(o.status)}
              <span className="text-xs text-[#666]">{new Date(o.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {orders.items.length === 0 && <p className="text-xs text-[#666] py-2">暂无订单</p>}
        </div>
        {orders.total > PAGE_SIZE && (
          <div className="flex justify-between mt-3 text-xs">
            <Button size="small" disabled={page <= 1} onClick={() => id && void refresh(id, page - 1)}>上一页</Button>
            <span className="text-[#666]">{page} / {Math.ceil(orders.total / PAGE_SIZE)}</span>
            <Button size="small" disabled={page >= Math.ceil(orders.total / PAGE_SIZE)} onClick={() => id && void refresh(id, page + 1)}>下一页</Button>
          </div>
        )}
      </div>

      <WeChatQRModal
        visible={!!qr}
        onCancel={() => { setQr(null); if (id) void refresh(id); }}
        onSuccess={() => { setQr(null); getMyTeams().then(setTeams).catch(() => {}); if (id) void refresh(id); }}
        codeUrl={qr?.codeUrl ?? ''}
        orderNo={qr?.orderNo ?? ''}
        amount={qr?.amount ?? 0}
        expiredAt={new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()}
      />
    </div>
  );
}
