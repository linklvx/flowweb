import { useState, useEffect, useCallback } from 'react';
import { subscriptionApi } from '@/api/subscriptionApi';
import type { CreditBalance } from '@/api/subscriptionApi';
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
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [showOrders, setShowOrders] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);

  // QR Modal state
  const [qrVisible, setQrVisible] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [qrOrderNo, setQrOrderNo] = useState('');
  const [qrExpiredAt, setQrExpiredAt] = useState('');

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
      const data = await subscriptionApi.getRechargeOrders(page);
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
      const order = await subscriptionApi.createRechargeOrder(selectedAmount);
      const payResult = await subscriptionApi.payRechargeOrder(order.orderNo);
      if (payResult.codeUrl) {
        const expiredAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        setQrCodeUrl(payResult.codeUrl);
        setQrOrderNo(order.orderNo);
        setQrExpiredAt(expiredAt);
        setQrVisible(true);
      }
    } catch (e: any) {
      message.error(e.message || '充值失败');
    } finally {
      setRecharging(false);
    }
  };

  const handlePaymentSuccess = () => {
    setQrVisible(false);
    message.success('充值成功！');
    loadBalance();
    loadOrders();
  };

  const handlePaymentCancel = () => {
    setQrVisible(false);
  };

  if (!balance) {
    return <div className="text-[#888] p-8 text-sm">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-6">积分与余额</h2>
      {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}

      {/* ── 双卡片布局 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-2xl">
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

        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6">
          <div className="text-center py-4">
            <p className="text-4xl font-bold text-[#4ade80] mb-2">
              ¥ {Number(balance.balance).toFixed(2)}
            </p>
            <p className="text-sm text-[#888]">账户余额（元）</p>
            <p className="text-xs text-[#666] mt-3">
              最后更新于 {formatDate(balance.updatedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* ── 充值面板（仅预设档位，无自定义输入）── */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-2xl mb-8">
        <h3 className="text-sm font-bold text-[#e2e8f0] mb-4">充值</h3>

        <div className="flex gap-2 mb-4 flex-wrap">
          {PRESET_AMOUNTS.map(val => (
            <button
              key={val}
              onClick={() => setSelectedAmount(val)}
              className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${
                selectedAmount === val
                  ? 'border-[#4ade80] bg-[#4ade80]/10 text-[#4ade80]'
                  : 'border-[#333] bg-transparent text-[#888] hover:text-[#ccc] hover:border-[#555]'
              }`}
            >
              ¥{val}
            </button>
          ))}
        </div>

        <button
          onClick={handleRecharge}
          disabled={recharging}
          className="px-6 py-2 rounded-lg text-sm font-medium text-white transition-opacity
                     bg-[#4ade80] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          立即充值 ¥{selectedAmount}
        </button>
      </div>

      {/* ── 微信扫码支付弹窗 ── */}
      <WeChatQRModal
        visible={qrVisible}
        codeUrl={qrCodeUrl}
        orderNo={qrOrderNo}
        amount={selectedAmount}
        expiredAt={qrExpiredAt}
        onSuccess={handlePaymentSuccess}
        onCancel={handlePaymentCancel}
      />

      {/* ── 充值记录（可折叠）── */}
      <div className="max-w-2xl">
        <button
          onClick={() => setShowOrders(!showOrders)}
          className="flex items-center gap-2 text-sm text-[#888] hover:text-[#ccc] transition-colors mb-3 bg-transparent border-none cursor-pointer"
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
              orders.map((o: any) => (
                <div
                  key={o.id}
                  className="bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="text-[#ccc] font-mono text-xs">{o.orderNo}</span>
                    {statusBadge(o.status)}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[#4ade80] font-mono">
                      +¥{Number(o.amount).toFixed(2)}
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
                  className="px-3 py-1 text-xs rounded bg-[#252525] text-[#888] hover:text-[#ccc] disabled:opacity-40 border-none cursor-pointer"
                >
                  上一页
                </button>
                <button
                  disabled={ordersPage * 20 >= ordersTotal}
                  onClick={() => loadOrders(ordersPage + 1)}
                  className="px-3 py-1 text-xs rounded bg-[#252525] text-[#888] hover:text-[#ccc] disabled:opacity-40 border-none cursor-pointer"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
