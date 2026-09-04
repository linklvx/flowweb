import { useEffect, useRef, useState, useCallback, useMemo, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useVipModalStore } from '@/stores/vipModalStore';
import { useSubscriptionPlans, usePublicBanner } from '@/hooks/useSubscription';
import { getPresignedUrlByKey } from '@/api/mediaApi';
import type { SubscriptionTier, SubscriptionPeriod } from '@flowweb/shared';

// ─── Types ───

interface VipPlan {
  tier: SubscriptionTier;
  name: string;
  price: number;
  originalPrice: number;
  discountTag: string;
  monthlyPoints: number;
  imageEstimate: number;
  videoEstimate: number;
  concurrentLimit: number | null;
  storageSize: string;
  annualSavingPercent: number;
  rights: {
    limited: string[];
    general: string[];
    exclusive: string[];
  };
}


interface VipSubscribeModalProps {
  onSubscribe?: (tier: SubscriptionTier, period: SubscriptionPeriod) => void;
  plansByPeriod?: Record<SubscriptionPeriod, VipPlan[]>;
}

// ─── Static tier metadata (non-price fields) ───

const TIER_RIGHTS: Record<string, VipPlan['rights']> = {
  basic: {
    limited: ['Seedream 5.0 Pro 限时8折', 'Happy Horse 1.1 限时4折'],
    general: ['8个并发任务', '云端存储空间60GB', '去除品牌水印 商用无忧', '会员专享无限次加速', '登录每日赠送20积分', '训练专属权益'],
    exclusive: ['脚本策划', '智能分镜（Kling3.0/O3）', '9/4/25 宫格生成', '宫格切分', '镜头聚焦', '多模态主体库', '视频剪辑', '720 度全景'],
  },
  pro: {
    limited: ['Seedream 5.0 Pro 限时8折', 'Happy Horse 1.1 限时4折'],
    general: ['12个并发任务', '云端存储空间100GB', '去除品牌水印 商用无忧', '会员专享无限次加速', '登录每日赠送20积分', '训练专属权益'],
    exclusive: ['脚本策划', '智能分镜（Kling3.0/O3）', '9/4/25 宫格生成', '宫格切分', '镜头聚焦', '多模态主体库', '视频剪辑', '720 度全景'],
  },
  max: {
    limited: ['Seedream 5.0 Pro 限时8折', 'Happy Horse 1.1 限时4折'],
    general: ['20个并发任务', '云端存储空间300GB', '去除品牌水印 商用无忧', '会员专享无限次加速', '登录每日赠送20积分', '训练专属权益'],
    exclusive: ['脚本策划', '智能分镜（Kling3.0/O3）', '9/4/25 宫格生成', '宫格切分', '镜头聚焦', '多模态主体库', '视频剪辑', '720 度全景'],
  },
  ultra: {
    limited: ['Seedream 5.0 Pro 限时8折', 'Happy Horse 1.1 限时4折'],
    general: ['无限并发任务', '云端存储空间600GB', '去除品牌水印 商用无忧', '会员专享无限次加速', '登录每日赠送20积分', '训练专属权益'],
    exclusive: ['脚本策划', '智能分镜（Kling3.0/O3）', '9/4/25 宫格生成', '宫格切分', '镜头聚焦', '多模态主体库', '视频剪辑', '720 度全景'],
  },
};

const TIER_EXTRAS: Record<string, { concurrentLimit: number | null; storageSize: string; annualSavingPercent: number }> = {
  basic: { concurrentLimit: 8, storageSize: '60GB', annualSavingPercent: 20 },
  pro: { concurrentLimit: 12, storageSize: '100GB', annualSavingPercent: 46 },
  max: { concurrentLimit: 20, storageSize: '300GB', annualSavingPercent: 47 },
  ultra: { concurrentLimit: null, storageSize: '600GB', annualSavingPercent: 47 },
};


const PERIOD_LABELS: Record<SubscriptionPeriod, string> = { monthly: '包月', quarterly: '包季', annually: '包年' };
const PERIOD_DISCOUNTS: Record<SubscriptionPeriod, string> = { monthly: '75折', quarterly: '74折', annually: '限时37折' };
const PERIOD_UNIT: Record<SubscriptionPeriod, string> = { monthly: '/月', quarterly: '/季', annually: '/年' };
const TIER_COLORS: Record<SubscriptionTier, string> = { basic: '#9ca3af', pro: '#3b82f6', max: '#a855f7', ultra: '#f59e0b' };

// ─── Helper Components ───

function BannerCountdown({ endAt, onExpired }: { endAt: string; onExpired: () => void }) {
  const calc = () => {
    const diff = new Date(endAt).getTime() - Date.now();
    if (diff <= 0) return { days: '00', hours: '00', mins: '00', secs: '00', expired: true as const };
    return {
      days: String(Math.floor(diff / 86400000)).padStart(2, '0'),
      hours: String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0'),
      mins: String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0'),
      secs: String(Math.floor((diff % 60000) / 1000)).padStart(2, '0'),
      expired: false as const,
    };
  };

  const [time, setTime] = useState(calc);
  const expiredRef = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const t = calc();
      setTime(t);
      if (t.expired && !expiredRef.current) {
        expiredRef.current = true;
        onExpired();
      }
    }, 1000);

    const onVisible = () => {
      if (!document.hidden) {
        const t = calc();
        setTime(t);
        if (t.expired && !expiredRef.current) {
          expiredRef.current = true;
          onExpired();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [endAt, onExpired]);

  return (
    <div className="flex gap-3 items-center">
      {[
        { value: time.days, unit: '天' },
        { value: time.hours, unit: '时' },
        { value: time.mins, unit: '分' },
        { value: time.secs, unit: '秒' },
      ].map(({ value, unit }) => (
        <div key={unit} className="flex flex-col items-center">
          <span className="font-mono text-2xl font-bold text-white bg-[#ffffff15] rounded-lg px-3 py-1 min-w-[48px] text-center">{value}</span>
          <span className="text-xs text-[#888] mt-1">{unit}</span>
        </div>
      ))}
    </div>
  );
}

function BannerWithImage({ data, onCountdownExpired }: { data: any; onCountdownExpired: () => void }) {
  const [bgStyle, setBgStyle] = useState<React.CSSProperties>({
    backgroundImage: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  });

  useEffect(() => {
    const applyFallback = () => {
      setBgStyle({
        backgroundImage: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      });
    };

    const loadImage = async () => {
      // Priority: uploaded image (via MinIO key + Vite proxy) > external URL > default gradient
      let primaryUrl: string | null = null;

      if (data.backgroundImageKey) {
        try {
          primaryUrl = await getPresignedUrlByKey(data.backgroundImageKey);
        } catch {
          // fetch failed, fall through to external URL or gradient
        }
      }

      const fallbackUrl = data.backgroundImageUrl || null;

      if (primaryUrl || fallbackUrl) {
        const img = new Image();
        img.onload = () => {
          setBgStyle({
            backgroundImage: `url(${img.src})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          });
        };
        img.onerror = () => {
          if (primaryUrl && fallbackUrl) {
            const img2 = new Image();
            img2.onload = () => {
              setBgStyle({
                backgroundImage: `url(${fallbackUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              });
            };
            img2.onerror = applyFallback;
            img2.src = fallbackUrl;
          } else {
            applyFallback();
          }
        };
        img.src = primaryUrl || fallbackUrl!;
      } else {
        applyFallback();
      }
    };

    loadImage();
  }, [data.backgroundImageKey, data.backgroundImageUrl]);

  return (
    <div className="w-full rounded-xl overflow-hidden flex items-center justify-between px-8 py-6" style={bgStyle}>
      <div>
        <h2 id="vip-modal-title" className="text-xl font-bold text-white m-0">{data.title}</h2>
        <p className="text-sm text-[#a8a8a8] mt-1 m-0">{data.subtitle}</p>
      </div>
      {data.countdownEndAt && (
        <BannerCountdown endAt={data.countdownEndAt} onExpired={onCountdownExpired} />
      )}
    </div>
  );
}

// ─── Component ───

export function VipSubscribeModal({ onSubscribe: _onSubscribe, plansByPeriod }: VipSubscribeModalProps) {
  const { visible, close } = useVipModalStore();
  const [exiting, setExiting] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const originalOverflow = useRef('');

  const [period, setPeriod] = useState<SubscriptionPeriod>('monthly');
  const [activeTier, setActiveTier] = useState<SubscriptionTier>('pro');
  const [activeTab, setActiveTab] = useState<'creator' | 'team'>('creator');
  const { data: apiPlans } = useSubscriptionPlans();
  const { data: bannerData, refresh: refreshBanner } = usePublicBanner();

  // Only fetch when modal opens
  const hasFetched = useRef(false);
  useEffect(() => {
    if (visible && !hasFetched.current) {
      hasFetched.current = true;
      refreshBanner();
    }
  }, [visible, refreshBanner]);

  const plans: VipPlan[] = useMemo(() => {
    const source = plansByPeriod ? plansByPeriod[period] : null;
    if (source) return source;

    if (!apiPlans.length) return [];

    return apiPlans.map(p => {
      const firstPrice = period === 'monthly' ? p.priceMonthly : period === 'quarterly' ? p.priceQuarterly : p.priceAnnually;
      const origPrice = period === 'monthly' ? p.originalPriceMonthly : period === 'quarterly' ? p.originalPriceQuarterly : p.originalPriceAnnually;
      const extras = TIER_EXTRAS[p.tier] ?? TIER_EXTRAS.basic;
      const rights = TIER_RIGHTS[p.tier] ?? TIER_RIGHTS.basic;

      return {
        tier: p.tier as SubscriptionTier,
        name: p.name,
        price: firstPrice ?? 0,
        originalPrice: origPrice ?? 0,
        discountTag: origPrice > 0 ? Math.round(firstPrice / origPrice * 10) + '折' : '-',
        monthlyPoints: p.monthlyCredits,
        imageEstimate: p.monthlyCredits * 4,
        videoEstimate: Math.floor(p.monthlyCredits * 0.2),
        concurrentLimit: extras.concurrentLimit,
        storageSize: extras.storageSize,
        annualSavingPercent: extras.annualSavingPercent,
        rights,
      };
    });
  }, [apiPlans, period, plansByPeriod]);

  // —— Scroll lock (only when mounted and visible) ——
  useEffect(() => {
    originalOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow.current;
    };
  }, []);

  // —— Escape key ——
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown as unknown as EventListener);
    return () => document.removeEventListener('keydown', handleKeyDown as unknown as EventListener);
  }, [close]);

  // —— Entrance animation ——
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setShowTransition(true);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // —— Exit animation when store visible becomes false ——
  useEffect(() => {
    if (visible) return;
    // visible went false externally → trigger exit
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      setExiting(false);
      setShowTransition(false);
    }, 200);
    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [visible]);

  // —— Auto-focus close button ——
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);


  const handleCardKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>, tier: SubscriptionTier) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveTier(tier);
    }
  }, []);

  if (!visible && !exiting) return null;

  const backdropClasses = [
    'fixed inset-0 z-[100] bg-[#0f0f0f] overflow-hidden transition-opacity duration-200',
    showTransition && !exiting ? 'opacity-100' : 'opacity-0',
  ].join(' ');

  return createPortal(
    <div className={backdropClasses} onClick={handleBackdrop} data-testid="vip-modal-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vip-modal-title"
        className="w-full h-full flex flex-col items-center overflow-y-auto overscroll-contain pt-5 pb-20"
      >
        {/* ── Close button ── */}
        <button
          ref={closeBtnRef}
          onClick={handleClose}
          aria-label="关闭会员弹窗"
          className="fixed top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded text-[#888] hover:text-white hover:bg-[#333] transition-colors"
        >
          ✕
        </button>

        <div className="w-full max-w-[1268px] mx-auto px-[60px]">
          {/* ── Banner (data-driven) ── */}
          <div className="w-full flex justify-center mb-6" style={{ minHeight: 88 }}>
            {bannerData ? (
              <BannerWithImage
                data={bannerData}
                onCountdownExpired={refreshBanner}
              />
            ) : (
              /* 降级：默认硬编码 banner */
              <div
                className="w-full rounded-xl overflow-hidden flex items-center justify-between px-8 py-6"
                style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}
              >
                <div>
                  <h2 id="vip-modal-title" className="text-xl font-bold text-white m-0">会员限时折扣｜年卡低至 37折，Seedance 2.0 低至 0.37元/秒</h2>
                  <p className="text-sm text-[#a8a8a8] mt-1 m-0">Seedance 2.5 即将上线，抢先锁定会员</p>
                </div>
                <div className="flex gap-3 items-center">
                  {[
                    { value: '00', unit: '天' }, { value: '03', unit: '时' },
                    { value: '16', unit: '分' }, { value: '50', unit: '秒' },
                  ].map(({ value, unit }) => (
                    <div key={unit} className="flex flex-col items-center">
                      <span className="font-mono text-2xl font-bold text-white bg-[#ffffff15] rounded-lg px-3 py-1 min-w-[48px] text-center">{value}</span>
                      <span className="text-xs text-[#888] mt-1">{unit}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Tabs: 个人会员订阅 / 团队会员订阅 ── */}
          <div className="w-full flex justify-center mb-px mt-6">
            <div className="flex items-end gap-3">
              {(['creator', 'team'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-2 text-base font-medium border-none bg-transparent cursor-pointer transition-colors ${
                    activeTab === tab ? 'text-white' : 'text-[#888] hover:text-[#ccc]'
                  }`}
                >
                  {tab === 'creator' ? '个人会员订阅' : '团队会员订阅'}
                  {activeTab === tab && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[3px] bg-[#4ade80] rounded-full" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full border-b border-white/10" />

          {/* ── Team placeholder ── */}
          {activeTab === 'team' ? (
            <div className="flex items-center justify-center py-20 text-[#888] text-lg">
              敬请期待
            </div>
          ) : (
            <>
              {/* ── Period selector ── */}
              <div className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-3 min-h-0 mt-0">
                <div aria-hidden />
                <div className="flex justify-center gap-3">
                  {(Object.keys(PERIOD_LABELS) as SubscriptionPeriod[]).map(p => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`relative px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all cursor-pointer ${
                        period === p
                          ? 'border-[#4ade80] bg-[#252525] text-white'
                          : 'border-transparent bg-transparent text-[#888] hover:text-[#ccc]'
                      }`}
                    >
                      {PERIOD_LABELS[p]}
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        p === 'annually' ? 'bg-red-500/20 text-red-400' : 'bg-[#ffffff15] text-[#a8a8a8]'
                      }`}>
                        {PERIOD_DISCOUNTS[p]}
                      </span>
                    </button>
                  ))}
                </div>
                <button className="flex items-center gap-1 text-sm text-[#888] bg-transparent border-none cursor-pointer hover:text-[#ccc]">
                  个人积分充值
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M10.4 7.6a.6.6 0 0 1 0 .8l-4 4a.6.6 0 0 1-.8-.8L9.2 8 5.6 4.4a.6.6 0 1 1 .8-.8l4 4Z"/></svg>
                </button>
              </div>

              {/* ── Plan cards ── */}
              <div className="w-full mt-10">
                <div className="flex justify-center gap-3">
                  {plans.map(plan => {
                    const isActive = activeTier === plan.tier;
                    return (
                      <div
                        key={plan.tier}
                        data-tier={plan.tier}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveTier(plan.tier)}
                        onKeyDown={(e) => handleCardKeyDown(e as KeyboardEvent<HTMLDivElement>, plan.tier)}
                        className={`flex-1 min-w-0 flex flex-col rounded-2xl border transition-all duration-300 cursor-pointer ${
                          isActive
                            ? 'border-[#4ade80] bg-[#252525]'
                            : 'border-[#242424] bg-[#141414] hover:border-[#4ade80]/50 hover:bg-[#252525]'
                        }`}
                      >
                        {/* Header */}
                        <div className="p-5 pb-3">
                          <div className="flex items-center gap-2 h-10">
                            <span className="text-base font-semibold text-white">{plan.name}</span>
                            <div className="flex-1" />
                          </div>
                          <div className="flex items-baseline gap-1 mt-1">
                            <span className="text-xs text-[#888]">¥</span>
                            <span className="text-3xl font-bold text-white">{plan.price}</span>
                            <span className="text-sm text-[#888]">{PERIOD_UNIT[period]}</span>
                            <span className="text-sm text-[#555] line-through ml-2">¥{plan.originalPrice}</span>
                          </div>
                          <div className="flex items-center justify-between mt-3">
                            <span className="text-xs text-[#888]">1积分≈{plan.tier === 'basic' ? '0.039' : plan.tier === 'pro' ? '0.037' : plan.tier === 'max' ? '0.037' : '0.03'}元</span>
                            <button className="text-xs text-[#4ade80] bg-transparent border-none cursor-pointer flex items-center gap-1 hover:underline">
                              买年卡立省{plan.annualSavingPercent}%
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M10.4 7.6a.6.6 0 0 1 0 .8l-4 4a.6.6 0 0 1-.8-.8L9.2 8 5.6 4.4a.6.6 0 1 1 .8-.8l4 4Z"/></svg>
                            </button>
                          </div>
                        </div>

                        {/* Credits */}
                        <div className="px-5 pb-3">
                          <div className="bg-[#ffffff08] rounded-lg p-3">
                            <div className="flex items-baseline gap-1">
                              <span className="text-xl font-bold text-white">{plan.monthlyPoints.toLocaleString()}</span>
                              <span className="text-sm text-[#888]">积分/月</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-[#666] mt-1">
                              <span>最多生成约</span>
                              <span className="text-[#aaa]">{plan.imageEstimate.toLocaleString()} 张图片</span>
                              <span className="w-px h-3 bg-[#333]" />
                              <span className="text-[#aaa]">{plan.videoEstimate.toLocaleString()} 个视频</span>
                            </div>
                          </div>
                        </div>

                        {/* Subscribe button */}
                        <div className="px-5 pb-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); _onSubscribe?.(plan.tier, period); }}
                            className="w-full py-2.5 rounded-lg text-sm font-medium border-none cursor-pointer text-white transition-opacity hover:opacity-90"
                            style={{ backgroundColor: TIER_COLORS[plan.tier] }}
                          >
                            立即订阅
                          </button>
                        </div>

                        {/* Benefits */}
                        <div className="px-5 pb-5 flex-1">
                          <div className="text-xs">
                            {/* Limited events */}
                            <div className="mb-2">
                              <span className="flex items-center gap-1 text-[#07b8dd] font-medium mb-2">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a1 1 0 0 1 1 1v1.07A7 7 0 1 1 3.07 7H2a1 1 0 1 1 0-2h1.07A7 7 0 0 1 7 3.07V2a1 1 0 0 1 1-1zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>
                                限时活动
                              </span>
                              {plan.rights.limited.map((r, i) => (
                                <div key={i} className="flex items-center gap-2 text-[#ccc] leading-7">
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="#4ade80"><path d="M13.5 4.5L6.5 11.5 2.5 7.5l1-1 3 3 6-6 1 1z"/></svg>
                                  {r}
                                </div>
                              ))}
                            </div>
                            <div className="border-t border-[#ffffff10] my-2" />
                            {/* General rights */}
                            {plan.rights.general.map((r, i) => (
                              <div key={i} className="flex items-center gap-2 text-[#ccc] leading-7">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="#4ade80"><path d="M13.5 4.5L6.5 11.5 2.5 7.5l1-1 3 3 6-6 1 1z"/></svg>
                                {r}
                              </div>
                            ))}
                            {/* Exclusive features */}
                            <div className="mt-3 mb-2">
                              <span className="text-[#a8a8a8] font-medium">独家功能</span>
                            </div>
                            {plan.rights.exclusive.map((r, i) => (
                              <div key={i} className="flex items-center gap-2 text-[#ccc] leading-7">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="#4ade80"><path d="M13.5 4.5L6.5 11.5 2.5 7.5l1-1 3 3 6-6 1 1z"/></svg>
                                {r}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Footer text ── */}
              <div className="flex items-center justify-between pt-5 pb-11 text-xs text-[#666] gap-3 px-4 w-full">
                <div className="flex gap-1 items-start">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="#919191" className="shrink-0 mt-0.5"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm1 7H7V7h2v4z"/></svg>
                  <span className="text-[#919191]">
                    免费用户登录每日赠送20积分，每日赠2次5折视频；云端存储空间3GB。
                    <span className="text-white font-medium"> 订阅积分每30天进行重置。</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
