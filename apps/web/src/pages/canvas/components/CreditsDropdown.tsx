import { memo, useState, useRef, useMemo } from 'react';
import { Popover, Skeleton, message } from 'antd';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { useCreditsStore } from '@/stores/creditsStore';

// ─── Inline SVG icons (matching reference design) ───

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 14h.01" />
      <path d="M7 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14" />
    </svg>
  );
}

function HelpIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

// ─── Formatting helpers ───

function formatNumber(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n);
}

function formatExpiry(iso: string | null, isActive: boolean): string {
  if (!iso) return '暂无生效订阅';
  if (!isActive) return '已过期';
  return `有效期至 ${dayjs(iso).format('YYYY-MM-DD')}`;
}

// ─── CreditsPanelContent ───

export interface CreditsPanelContentProps {
  credits: number;
  subscriptionCredits: number;
  subscriptionCreditsExpiry: string | null;
  isActive: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRecharge: () => void;
  onInvite: () => void;
}

export function CreditsPanelContent({
  credits,
  subscriptionCredits,
  subscriptionCreditsExpiry,
  isActive,
  loading,
  error,
  onRetry,
  onRecharge,
  onInvite,
}: CreditsPanelContentProps) {
  const total = useMemo(
    () => credits + (isActive ? subscriptionCredits : 0),
    [credits, subscriptionCredits, isActive],
  );

  if (loading) {
    return (
      <div className="w-72 p-3">
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
        <Skeleton active paragraph={{ rows: 2 }} title={false} className="mt-2" />
        <Skeleton.Button active block className="mt-3" />
        <Skeleton.Button active block className="mt-2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-72 p-4 flex flex-col items-center gap-2 text-white/60">
        <span className="text-sm">{error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-amber-200/80 hover:text-amber-100 bg-white/5 rounded-lg px-3 py-1 border border-white/10 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const leftCardExpired = !isActive;

  return (
    <div
      className="w-72 flex flex-col overflow-hidden rounded-[1.75rem] border border-zinc-900/90 p-3 text-white"
      style={{
        backgroundImage: 'linear-gradient(160deg, #111111 0%, #171717 52%, #101828 100%)',
        boxShadow: '0 20px 60px rgba(15,23,42,0.16)',
      }}
    >
      {/* background glow layer */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at top right, rgba(251,191,36,0.20), transparent 24%), radial-gradient(circle at 20% 120%, rgba(45,212,191,0.16), transparent 30%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent 38%)',
        }}
      />

      {/* ── Total credits card ── */}
      <div
        className="relative overflow-hidden rounded-[1.375rem] border border-white/10 p-3.5"
        style={{
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at top right, rgba(251,191,36,0.24), transparent 34%), radial-gradient(circle at bottom left, rgba(20,184,166,0.2), transparent 30%)',
          }}
        />
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)' }}>
            <WalletIcon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-white/45">账户</div>
            <div className="text-sm font-semibold">可用积分</div>
          </div>
        </div>
        <div className="relative mt-3">
          <div
            className="text-4xl font-black tracking-[-0.06em]"
            style={{
              backgroundImage: 'linear-gradient(to bottom right, #fff, #fff, rgba(253,230,138,0.85))',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 2px 18px rgba(251,191,36,0.18)',
            }}
          >
            {formatNumber(total)}
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-1 text-xs text-white/55">
            <span className="font-semibold text-violet-200/80">
              {formatNumber(subscriptionCredits)}
            </span>
            <span className="text-white/40">订阅积分</span>
            <span className="px-0.5 text-white/30">+</span>
            <span className="font-semibold text-amber-200/85">
              {formatNumber(credits)}
            </span>
            <span className="text-white/40">通用积分</span>
          </div>
        </div>
      </div>

      {/* ── Two-column detail cards ── */}
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        {/* Subscription credits (left, purple) */}
        <div
          className={`rounded-[1.25rem] border border-violet-400/15 px-3 py-2 ${leftCardExpired ? 'opacity-50' : ''}`}
          style={{
            backgroundImage: 'linear-gradient(180deg, rgba(139,92,246,0.18), rgba(139,92,246,0.10))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-violet-200/90">
              <span className="truncate">订阅积分</span>
              <button type="button" aria-label="查看订阅积分说明"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-violet-100/80 transition hover:bg-white/10 hover:text-white">
                <HelpIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div
            className="mt-1 text-2xl font-black tracking-tight"
            style={{
              backgroundImage: 'linear-gradient(to bottom right, #fff, rgba(237,233,254,0.85))',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {formatNumber(subscriptionCredits)}
          </div>
          <div className="mt-1 truncate text-[0.6875rem] font-medium text-violet-100/70">
            {formatExpiry(subscriptionCreditsExpiry, isActive)}
          </div>
        </div>

        {/* General credits (right, amber) */}
        <div
          className="rounded-[1.25rem] border border-amber-400/15 px-3 py-2"
          style={{
            backgroundImage: 'linear-gradient(180deg, rgba(245,158,11,0.16), rgba(245,158,11,0.10))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-amber-200/90">
            <span>通用积分</span>
            <button type="button" aria-label="查看积分说明"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-100/80 transition hover:bg-white/10 hover:text-white">
              <HelpIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className="mt-1 text-2xl font-black tracking-tight"
            style={{
              backgroundImage: 'linear-gradient(to bottom right, #fff, rgba(253,230,138,0.85))',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {formatNumber(credits)}
          </div>
          <div className="mt-1 truncate text-[0.6875rem] font-medium text-amber-100/70">
            长期有效 · 订阅积分用尽后使用
          </div>
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div className="mt-auto grid gap-2.5 pt-3">
        {/* Recharge button */}
        <button
          type="button"
          onClick={onRecharge}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-white px-4 py-3.5 text-left transition hover:bg-zinc-100"
          style={{ boxShadow: '0 18px 44px -12px rgba(255,255,255,0.22)' }}
        >
          <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-200/40 blur-2xl" />
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white">
            <WalletIcon className="h-5 w-5" />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-bold leading-tight text-zinc-950">充值</span>
            <span className="mt-0.5 block text-[0.6875rem] font-medium text-zinc-500">订阅积分 + 通用积分</span>
          </span>
          <ChevronRightIcon className="relative h-4 w-4 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-zinc-700" />
        </button>

        {/* Invite button */}
        <button
          type="button"
          onClick={onInvite}
          className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/15 px-4 py-3.5 text-left transition hover:bg-white/[0.1]"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.04), transparent)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <span className="pointer-events-none absolute -left-6 -bottom-6 h-20 w-20 rounded-full bg-rose-300/15 blur-2xl" />
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.08] text-white">
            <GiftIcon className="h-5 w-5" />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-bold leading-tight text-white">邀请好友 · 一起赢积分</span>
            <span className="mt-0.5 block text-[0.6875rem] font-medium text-white/55">邀请好友共享积分奖励</span>
          </span>
          <ChevronRightIcon className="relative h-4 w-4 shrink-0 text-white/45 transition group-hover:translate-x-0.5 group-hover:text-white" />
        </button>
      </div>
    </div>
  );
}

// ─── CreditsDropdown ───

function CreditsDropdownComponent() {
  const store = useCreditsStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const manualCloseRef = useRef(false);

  const total = store.credits + (store.isSubscriptionActive() ? store.subscriptionCredits : 0);

  const handleRecharge = () => {
    manualCloseRef.current = true;
    setOpen(false);
    navigate('/settings/credits');
  };

  const handleInvite = () => {
    manualCloseRef.current = true;
    setOpen(false);
    message.info('即将上线');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (manualCloseRef.current && next) return;
        setOpen(next);
      }}
      trigger={['hover', 'focus']}
      placement="bottomRight"
      arrow={false}
      destroyTooltipOnHide
      overlayInnerStyle={{ padding: 0, background: 'transparent' }}
      getPopupContainer={() => document.body}
      content={
        <CreditsPanelContent
          credits={store.credits}
          subscriptionCredits={store.subscriptionCredits}
          subscriptionCreditsExpiry={store.subscriptionCreditsExpiry}
          isActive={store.isSubscriptionActive()}
          loading={store.loading}
          error={store.error}
          onRetry={() => store.fetchBalance()}
          onRecharge={handleRecharge}
          onInvite={handleInvite}
        />
      }
    >
      <button
        type="button"
        aria-label="查看积分明细"
        aria-live="polite"
        onMouseLeave={() => { manualCloseRef.current = false; }}
        className="text-sm text-white whitespace-nowrap tracking-wider bg-transparent border-none cursor-pointer"
      >
        <span aria-label={`总积分 ${formatNumber(total)}`}>⚡ {formatNumber(total)}</span>
      </button>
    </Popover>
  );
}

const CreditsDropdown = memo(CreditsDropdownComponent);
export default CreditsDropdown;
