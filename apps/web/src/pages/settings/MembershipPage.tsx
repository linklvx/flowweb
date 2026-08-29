import { useState, useCallback, useEffect } from 'react';
import { useMySubscription, useSubscriptionPlans, useCreditBalance, useUpgradePreview } from '@/hooks/useSubscription';
import { Modal, Button, Tag, message } from 'antd';
import type { SubscriptionPlan, UpgradePreview } from '@/api/subscriptionApi';
import { subscriptionApi } from '@/api/subscriptionApi';
import { WeChatQRModal } from '@/components/WeChatQRModal';

const PLAN_COLORS: Record<string, string> = { basic: '#9ca3af', pro: '#3b82f6', max: '#a855f7', ultra: '#f59e0b' };
const PLAN_LABELS: Record<string, string> = { basic: '普通会员', pro: 'Pro', max: 'Max', ultra: 'Ultra' };
const PERIOD_MAP: Record<string, string> = { monthly: '包月', quarterly: '包季', annually: '包年' };

function PriceCell({ plan, period, onClick }: { plan: SubscriptionPlan; period: string; onClick: () => void }) {
  const price = period === 'monthly' ? plan.priceMonthly : period === 'quarterly' ? plan.priceQuarterly : plan.priceAnnually;
  return (
    <td className="p-3 text-center">
      <div className="text-lg font-bold text-white">¥{(price ?? 0).toLocaleString()}</div>
      <div className="text-xs text-[#888]">{PERIOD_MAP[period]}</div>
      <button
        onClick={onClick}
        className="mt-2 px-4 py-1.5 text-xs rounded-md text-white border-none cursor-pointer transition-colors"
        style={{ backgroundColor: PLAN_COLORS[plan.tier] || '#4ade80' }}
      >
        团队订阅（前往团队管理）
      </button>
    </td>
  );
}

function UpgradeModal({ visible, plan, period, preview, loading, onConfirm, onClose }: {
  visible: boolean; plan: SubscriptionPlan | null; period: string | null;
  preview: UpgradePreview | null; loading: boolean; onConfirm: () => void; onClose: () => void;
}) {
  if (!plan || !period) return null;
  return (
    <Modal open={visible} onCancel={onClose} footer={null} title="升级确认" width={480}>
      <div className="text-sm text-[#ccc] space-y-3 py-2">
        <div className="flex justify-between"><span>目标套餐</span><span className="text-white font-bold">{plan.name} {PERIOD_MAP[period]}</span></div>
        <div className="flex justify-between"><span>目标原价</span><span className="text-white">¥{preview?.originalPrice?.toLocaleString()}</span></div>
        <div className="flex justify-between"><span>可抵扣</span><span className="text-[#4ade80]">-¥{preview?.deductibleAmount?.toLocaleString()}</span></div>
        <hr className="border-[#333]" />
        <div className="flex justify-between text-base"><span>应付</span><span className="text-[#4ade80] font-bold">¥{preview?.payableAmount?.toLocaleString()}</span></div>
        <div className="text-xs text-[#666]">首月发放 {preview?.firstMonthCredits?.toLocaleString()} 订阅积分</div>
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" loading={loading} onClick={onConfirm} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80' }}>确认升级</Button>
      </div>
    </Modal>
  );
}

export function MembershipPage() {
  const { data: plans } = useSubscriptionPlans();
  const { data: sub, loading, refresh: refreshSub } = useMySubscription();
  const { credits, subscriptionCredits, subscriptionCreditsExpiry, refresh: refreshBalance } = useCreditBalance();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [upgradePlan, setUpgradePlan] = useState<SubscriptionPlan | null>(null);
  const [upgradePeriod, setUpgradePeriod] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const preview = useUpgradePreview(upgradePlan?.id ?? null, upgradePeriod);

  // WeChat QR payment state
  const [qrVisible, setQrVisible] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [qrOrderNo, setQrOrderNo] = useState('');
  const [qrAmount, setQrAmount] = useState(0);
  const [qrExpiredAt, setQrExpiredAt] = useState('');

  const handleSubscribe = async (plan: SubscriptionPlan, period: string) => {
    setSelectedPlan(null);
    setSubLoading(true);
    try {
      const order = await subscriptionApi.createSubscriptionOrder(plan.id, period, 'new_purchase');
      const payResult = await subscriptionApi.paySubscriptionOrder(order.orderNo);
      if (payResult.codeUrl) {
        setQrCodeUrl(payResult.codeUrl);
        setQrOrderNo(order.orderNo);
        setQrAmount(Number((order.amount / 100).toFixed(2)));
        setQrExpiredAt(order.expiredAt);
        setQrVisible(true);
      }
    } catch (e: any) {
      message.error(e.message || '创建订单失败');
    } finally {
      setSubLoading(false);
    }
  };

  const handleUpgrade = async () => {
    if (!upgradePlan || !upgradePeriod) return;
    setUpgradePlan(null);
    setSubLoading(true);
    try {
      const order = await subscriptionApi.createSubscriptionOrder(upgradePlan.id, upgradePeriod, 'upgrade');
      const payResult = await subscriptionApi.paySubscriptionOrder(order.orderNo);
      if (payResult.codeUrl) {
        setQrCodeUrl(payResult.codeUrl);
        setQrOrderNo(order.orderNo);
        setQrAmount(Number((order.amount / 100).toFixed(2)));
        setQrExpiredAt(order.expiredAt);
        setQrVisible(true);
      }
    } catch (e: any) {
      message.error(e.message || '创建升级订单失败');
    } finally {
      setSubLoading(false);
    }
  };

  const handlePaymentSuccess = useCallback(async () => {
    setQrVisible(false);
    message.loading({ content: '支付成功，权益开通中...', key: 'sub-paying', duration: 0 });
    try {
      await refreshSub();
      await refreshBalance();
    } catch { /* refresh failed, user can manually reload */ }
    message.destroy('sub-paying');
    message.success('订阅成功！');
  }, [refreshSub, refreshBalance]);

  // PENDING order detection on page load
  useEffect(() => {
    if (loading || sub?.status === 'active') return;
    const checkPending = async () => {
      try {
        const result = await subscriptionApi.querySubscriptionOrders({ status: 'PENDING' });
        const latest = result?.items?.[0];
        if (latest && latest.status === 'PENDING') {
          Modal.confirm({
            title: '待支付订单',
            content: '您有一笔待支付的订阅订单，是否继续支付？',
            onOk: () => {
              setQrOrderNo(latest.orderNo);
              setQrAmount(Number((latest.amount / 100).toFixed(2)));
              setQrVisible(true);
            },
          });
        }
      } catch { /* silent */ }
    };
    checkPending();
  }, [loading, sub?.status]);

  if (loading) return <div className="text-[#888] p-8 text-sm">加载中...</div>;

  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-1">会员中心</h2>
      <div className="flex gap-3 mb-6 text-sm">
        <span className="text-[#888]">普通积分: <span className="text-white font-mono">{(credits ?? 0).toLocaleString()}</span></span>
        <span className="text-[#888]">订阅积分: <span className="text-white font-mono">{(subscriptionCredits ?? 0).toLocaleString()}</span></span>
        {subscriptionCreditsExpiry && <span className="text-[#666] text-xs">(到期: {new Date(subscriptionCreditsExpiry).toLocaleDateString()})</span>}
      </div>

      {/* Subscribed: Current plan details */}
      {sub && sub.status === 'active' && (
        <div className="space-y-6">
          <div className="bg-[#1A1A1A] border border-[#333] rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Tag color={PLAN_COLORS[sub.tier] ?? undefined}>{PLAN_LABELS[sub.tier]}</Tag>
              <span className="text-white font-bold text-lg">{sub.plan?.name ?? PLAN_LABELS[sub.tier]}</span>
              <span className="text-[#888] text-sm">{PERIOD_MAP[sub.period]}</span>
            </div>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><span className="text-[#888]">月积分额度</span><div className="text-white font-mono text-base">{sub.plan?.monthlyCredits?.toLocaleString()}</div></div>
              <div><span className="text-[#888]">已发放次数</span><div className="text-white">{sub.grantCount}</div></div>
              <div><span className="text-[#888]">周期到期</span><div className="text-white">{new Date(sub.currentPeriodEnd).toLocaleDateString()}</div></div>
              <div><span className="text-[#888]">下次发放</span><div className="text-white">{new Date(sub.nextGrantDate).toLocaleDateString()}</div></div>
            </div>
          </div>

          {/* Upgrade section */}
          <div className="bg-[#1A1A1A] border border-[#333] rounded-lg p-6">
            <h3 className="text-white text-base font-bold mb-3">升级套餐</h3>
            <div className="grid grid-cols-3 gap-3">
              {(plans as any[]).filter((p: any) => (({ basic: 0, pro: 1, max: 2, ultra: 3 } as Record<string,number>)[p.tier] > (({ basic: 0, pro: 1, max: 2, ultra: 3 } as Record<string,number>)[sub!.tier] ?? 0))).map((p: any) => (
                ['monthly', 'quarterly', 'annually'].map(per => (
                  <button
                    key={`${p.id}-${per}`}
                    className="bg-[#252525] border border-[#444] rounded-lg p-3 text-left hover:border-[#4ade80] transition-colors cursor-pointer"
                    onClick={() => { setUpgradePlan(p); setUpgradePeriod(per); }}
                  >
                    <div className="text-white font-bold">{p.name} {PERIOD_MAP[per]}</div>
                    <div className="text-[#4ade80] text-lg font-mono mt-1">
                      ¥{per === 'monthly' ? p.priceMonthly : per === 'quarterly' ? p.priceQuarterly : p.priceAnnually}
                    </div>
                    <div className="text-xs text-[#666] mt-1">月授{p.monthlyCredits.toLocaleString()} 积分</div>
                  </button>
                ))
              ))}
            </div>
          </div>

          <UpgradeModal
            visible={!!upgradePlan}
            plan={upgradePlan} period={upgradePeriod}
            preview={preview.data} loading={subLoading}
            onConfirm={handleUpgrade}
            onClose={() => setUpgradePlan(null)}
          />
        </div>
      )}
      <WeChatQRModal
        visible={qrVisible}
        codeUrl={qrCodeUrl}
        orderNo={qrOrderNo}
        amount={qrAmount}
        expiredAt={qrExpiredAt}
        onSuccess={handlePaymentSuccess}
        onCancel={() => {
          setQrVisible(false);
          subscriptionApi.closeSubscriptionOrder(qrOrderNo).catch(() => {});
        }}
        queryOrderFn={(orderNo: string) =>
          subscriptionApi.querySubscriptionOrder(orderNo).then(o => ({ status: o.status }))
        }
        closeOrderFn={(orderNo: string) =>
          subscriptionApi.closeSubscriptionOrder(orderNo)
        }
        successEventName="subscription:order:success"
        failedEventName="subscription:order:failed"
      />

      {(!sub || sub.status !== 'active') && (
        /* Unsubscribed: Plan comparison table */
        <div className="bg-[#1A1A1A] border border-[#333] rounded-lg p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#333] text-[#888]">
                <th className="text-left p-3">套餐</th>
                <th className="p-3 text-center">月积分</th>
                <th className="p-3 text-center">包月</th>
                <th className="p-3 text-center">包季</th>
                <th className="p-3 text-center">包年</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(plan => (
                <tr key={plan.id} className="border-b border-[#252525] hover:bg-[#252525]/50">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold">{plan.name}</span>
                      <Tag color={PLAN_COLORS[plan.tier]}>{PLAN_LABELS[plan.tier]}</Tag>
                    </div>
                  </td>
                  <td className="p-3 text-center text-[#4ade80] font-mono text-base">{plan.monthlyCredits.toLocaleString()}</td>
                  <PriceCell plan={plan} period="monthly" onClick={() => handleSubscribe(plan, 'monthly')} />
                  <PriceCell plan={plan} period="quarterly" onClick={() => handleSubscribe(plan, 'quarterly')} />
                  <PriceCell plan={plan} period="annually" onClick={() => handleSubscribe(plan, 'annually')} />
                </tr>
              ))}
            </tbody>
          </table>
          <Modal
            open={!!selectedPlan}
            onCancel={() => setSelectedPlan(null)}
            footer={null}
            title="确认订阅"
          >
            <p className="text-sm text-[#ccc]">
              确认订阅 <span className="text-white font-bold">{selectedPlan?.name}</span> {PERIOD_MAP[selectedPeriod] || ''}？
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <Button onClick={() => setSelectedPlan(null)}>取消</Button>
              <Button type="primary" loading={subLoading} onClick={async () => {
                if (!selectedPlan || !selectedPeriod) return;
                await handleSubscribe(selectedPlan, selectedPeriod);
                setSelectedPlan(null);
              }} style={{ backgroundColor: '#4ade80', borderColor: '#4ade80' }}>确认订阅</Button>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
