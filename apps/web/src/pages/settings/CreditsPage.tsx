import { useState, useEffect, useCallback } from 'react';
import { subscriptionApi } from '@/api/subscriptionApi';
import type { CreditBalance } from '@/api/subscriptionApi';
import {
  getDefaultTeam, createTeamRechargeOrder, payTeamOrder, listTeamRechargeOrders,
  type TeamRechargeOrderRow,
} from '@/api/teamApi';
import { message } from 'antd';
import { WeChatQRModal } from '@/components/WeChatQRModal';

const PRESET_AMOUNTS = [10, 30, 50, 100, 200, 500];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    PENDING: { label: '处理中', color: 'bg-[#f59e0b]/15 text-[#f59e0b]' },
    SUCCESS: { label: '成功', color: 'bg-[#4ade80]/15 text-[#4ade80]' },
    CLOSED:  { label: '已关闭', color: 'bg-[#666]/15 text-[#888]' },
    FAILED:  { label: '失败', color: 'bg-[#ef4444]/15 text-[#ef4444]' },
  };
  const item = map[status] || map.PENDING;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${item.color}`}>
      {item.label}
    </span>
  );
}

export function CreditsPage() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [error, setError] = useState('');
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const [recharging, setRecharging] = useState(false);
  const [orders, setOrders] = useState<TeamRechargeOrderRow[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [showOrders, setShowOrders] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);

  // QR Modal state（团队充值订单）
  const [qrOrder, setQrOrder] = useState<{ orderNo: string; codeUrl: string; amount: number; expiredAt: string } | null>(null);

  const loadBalance = useCallback(async () => {
    try {
      const data = await subscriptionApi.getBalance();
      setBalance(data);
      setError('');
    } catch {
      setError('加载失败');
    }
  }, []);

  const loadOrders = useCallback(async (page = 1) => {
    try {
      const team = await getDefaultTeam();
      const data = await listTeamRechargeOrders(team.id, page, 20, 'credits');
      setOrders(data.items);
      setOrdersTotal(data.total);
      setOrdersPage(page);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadBalance(); }, [loadBalance]);
  useEffect(() => { loadOrders(); }, [loadOrders]);

  const handleRecharge = async () => {
    if (recharging) return;
    setRecharging(true);
    try {
      // 充值到默认团队（1 元 = 10 积分），复用 TeamPage 团队下单模式
      const team = await getDefaultTeam();
      const { outTradeNo } = await createTeamRechargeOrder(team.id, selectedAmount);
      const pay = await payTeamOrder(team.id, outTradeNo);
      if (pay.codeUrl) {
        // 微信 Native 下单二维码默认 2 小时有效；amount 后端为分、弹窗展示为元
        setQrOrder({
          orderNo: outTradeNo,
          codeUrl: pay.codeUrl,
          amount: pay.amount / 100,
          expiredAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        });
      }
    } catch (e: any) {
      message.error(e.message || '充值失败');
    } finally {
      setRecharging(false);
    }
  };

  const handlePaymentSuccess = () => {
    setQrOrder(null);
    message.success('充值成功！');
    loadBalance();
    loadOrders();
  };

  if (!balance) {
    return <div className="text-[#888] p-8 text-sm">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-6">个人积分充值与余额</h2>
      {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}

      {/* ── 积分卡 ── */}
      <div className="max-w-2xl mb-8">
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
          <div className="text-center py-4">
            <p className="text-4xl font-bold text-[#f59e0b] mb-2">
              {balance.credits.toLocaleString()}
            </p>
            <p className="text-sm text-[#888]">积分余额</p>
            <p className="text-xs text-[#666] mt-3">
              最后更新于 {formatDate(balance.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* ── 充值：默认团队积分（1 元 = 10 积分）── */}
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-5 max-w-2xl mb-8">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-1">充值</h3>
        <p className="text-xs text-[#888] mb-4">积分归属默认团队（1 元 = 10 积分）；团队订阅与席位管理见 团队管理。</p>
        <div className="grid grid-cols-3 gap-3">
          {PRESET_AMOUNTS.map((yuan) => (
            <button
              key={yuan}
              onClick={() => setSelectedAmount(yuan)}
              className={`rounded-lg p-4 border text-center transition-colors ${
                selectedAmount === yuan
                  ? 'border-[#5DDCFF] bg-[#5DDCFF]/10'
                  : 'border-[#333] bg-[#111] hover:border-[#666]'
              }`}
            >
              <div className="text-lg font-bold text-[#e2e8f0]">{yuan * 10}</div>
              <div className="text-xs text-[#666]">¥{yuan}</div>
            </button>
          ))}
        </div>
        <button
          onClick={() => void handleRecharge()}
          disabled={recharging}
          className="mt-4 w-full py-2.5 rounded-lg text-sm font-bold bg-[#5DDCFF] text-[#111] hover:bg-[#7ce4ff] disabled:opacity-50"
        >
          {recharging ? '创建订单中…' : `微信支付 ¥${selectedAmount}`}
        </button>
      </div>

      {/* ── 充值记录（可折叠）── */}
      <div className="max-w-2xl">
        <button
          onClick={() => setShowOrders(!showOrders)}
          className="flex items-center gap-2 text-sm text-[#888] hover:text-[#ccc] transition-colors mb-3"
        >
          <svg
            viewBox="0 0 15 15"
            fill="currentColor"
            className={`w-3 h-3 transition-transform ${showOrders ? 'rotate-90' : ''}`}
          >
            <path d="M5.5 2.5a.5.5 0 0 1 .7 0l4 4a.5.5 0 0 1 0 .7l-4 4a.5.5 0 0 1-.7-.7L9.2 7 5.5 3.2a.5.5 0 0 1 0-.7z" />
          </svg>
          充值记录
          {ordersTotal > 0 && (
            <span className="text-xs text-[#666]">（{ordersTotal} 条）</span>
          )}
        </button>

        {showOrders && (
          <div className="space-y-2">
            {orders.length === 0 ? (
              <p className="text-sm text-[#666] py-4">暂无记录</p>
            ) : (
              orders.map((o) => (
                <div
                  key={o.id}
                  className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="text-[#ccc] font-mono text-xs">{o.outTradeNo}</span>
                    {statusBadge(o.status)}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[#4ade80] font-mono">
                      +¥{(o.amountFen / 100).toFixed(2)}
                    </span>
                    <span className="text-xs text-[#666]">{formatDate(o.createdAt)}</span>
                  </div>
                </div>
              ))
            )}
            {ordersTotal > 20 && (
              <div className="flex justify-center gap-2 pt-2">
                <button
                  disabled={ordersPage <= 1}
                  onClick={() => loadOrders(ordersPage - 1)}
                  className="px-3 py-1 text-xs rounded bg-[#252525] text-[#888] hover:text-[#ccc] disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={ordersPage * 20 >= ordersTotal}
                  onClick={() => loadOrders(ordersPage + 1)}
                  className="px-3 py-1 text-xs rounded bg-[#252525] text-[#888] hover:text-[#ccc] disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {qrOrder && (
        <WeChatQRModal
          visible
          codeUrl={qrOrder.codeUrl}
          orderNo={qrOrder.orderNo}
          amount={qrOrder.amount}
          expiredAt={qrOrder.expiredAt}
          onSuccess={handlePaymentSuccess}
          onCancel={() => { setQrOrder(null); loadBalance(); loadOrders(); }}
        />
      )}
    </div>
  );
}
