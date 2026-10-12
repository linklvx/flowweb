// apps/web/src/pages/canvas/components/QuotaBanner.tsx
// Y0b-4 T11：配额三级横幅（与 SyncBanner 独立组件同挂载点——SyncBanner 管连接/鉴权态，本组件
// 管配额态）。三档：软阈通告（quotaOver∧bytes<limit：黄档非阻断+「瘦身」入口）/硬阈常驻
// （quotaOver∧bytes≥limit 或 4404 终态：红档+双主按钮「一键瘦身」「导出到新项目」）/终态档
// （4404=硬阈+「重新连接」唯一复位；4410=「正在重建画布历史」无按钮——runtime 1.5s 自动 reload）。
// 数据源=store 快照族（T5 doc-status 下行）+wsQuotaTerminal（runtime close 4404/4410 写）。
import { useState } from 'react';
import { message } from 'antd';
import {
  DOC_OVER_QUOTA_TERMINAL_REASON, DOC_VACUUMING_TERMINAL_REASON, DOC_GENERATION_STALE_TERMINAL_REASON,
  SS2_OVER_LIMIT_TERMINAL_REASON,
} from '@flowweb/shared';
import { useCanvasStore } from '@/stores/canvasStore';
import { effectiveSoftLimit } from '@/stores/canvasIntents';
import { safeReload } from '@/stores/canvasCollabRuntime';
import { exportFresh } from '@/api/collabApi';
import { ShrinkDialog } from './ShrinkDialog';

/** 1024 基格式化（与 toastQuotaReject/effectiveSoftLimit 同口径——禁十进制误读） */
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

const BTN_CLASS = 'shrink-0 px-3 h-7 rounded-lg text-xs border';
const BTN_SECONDARY = `${BTN_CLASS} bg-overlay-3 hover:bg-overlay-2 text-text border-overlay-2`;
// Y0b-4 T13 lint 收口（T11 遗留）：danger 主按钮迁 inline style（ConfirmModal 同款先例——类串
// text-white 在 no-theme-utility 拦截面；bg/color 走 --fw-accent-danger 双值 token，hover 深值
// 恰为浅档值=C8 同款）。
const dangerBtnProps = {
  className: `${BTN_CLASS} border-transparent`,
  style: { backgroundColor: 'var(--fw-accent-danger)', color: '#fff' },
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = '#dc2626'; },
  onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.backgroundColor = 'var(--fw-accent-danger)'; },
} as const;

export function QuotaBanner({ projectId }: { projectId: string }) {
  const quotaOver = useCanvasStore((s) => s.quotaOver);
  const quotaLimitBytes = useCanvasStore((s) => s.quotaLimitBytes);
  const quotaSoftLimitBytes = useCanvasStore((s) => s.quotaSoftLimitBytes);
  const localDocBytes = useCanvasStore((s) => s.localDocBytes);
  const wsQuotaTerminal = useCanvasStore((s) => s.wsQuotaTerminal);
  const collabEscapePending = useCanvasStore((s) => s.collabEscapePending);
  const [shrinkOpen, setShrinkOpen] = useState(false);

  const reason = wsQuotaTerminal?.reason;
  const vacuumingFamily = reason === DOC_VACUUMING_TERMINAL_REASON || reason === DOC_GENERATION_STALE_TERMINAL_REASON;
  const overQuotaTerminal = reason === DOC_OVER_QUOTA_TERMINAL_REASON;
  // Y0b-5 T6：ss2-over-limit 让位单链（SyncBanner ss2 档=导出 .yjs→丢弃本地副本——超额在客户端本地、
  // 服务端 doc 往往小，本组件瘦身指引治不了此病）。
  if (reason === SS2_OVER_LIMIT_TERMINAL_REASON) return null;
  const hard = overQuotaTerminal || (quotaOver && quotaLimitBytes > 0 && localDocBytes >= quotaLimitBytes);
  if (!vacuumingFamily && !hard && !quotaOver) return null;

  const onExport = async () => {
    try {
      const r = await exportFresh(projectId);
      if (r.warning === 'still-over-limit') message.warning('已导出，但新副本仍超出容量上限，请继续瘦身');
      else message.success(`已导出到新项目「${r.name}」`);
    } catch {
      message.error('导出失败，请稍后重试');
    }
  };

  // 终态档（4410 双 reason）：横幅常驻无动作——reload 由 runtime close 分支调度（1.5s）
  if (vacuumingFamily) {
    // T6 质量修复 C1：escape 分叉压盖——safeReload 被 dirty 分叉（collabEscapePending）时
    // 「即将自动刷新」是假承诺；让位 SyncBanner escape 档（导出入口），ss2-over-limit 让位同款形态。
    if (collabEscapePending) return null;
    return (
      <div
        data-testid="collab-quota-banner"
        role="alert"
        className="absolute left-1/2 top-24 z-30 -translate-x-1/2 flex items-center gap-3 px-4 h-10 rounded-xl border text-sm whitespace-nowrap bg-overlay-2/95 border-overlay-2 text-text-dim-1"
      >
        <span>正在重建画布历史，即将自动刷新</span>
      </div>
    );
  }

  const toneClass = hard
    ? 'bg-red-950/95 border-red-500/40 text-red-100'
    : 'bg-amber-950/95 border-amber-500/40 text-amber-100';
  const text = hard
    ? '画布已超出容量上限，编辑已暂停'
    : `画布接近容量上限（约 ${mb(effectiveSoftLimit({ quotaSoftLimitBytes }))}），建议瘦身`;

  return (
    <>
      <div
        data-testid="collab-quota-banner"
        role="alert"
        className={`absolute left-1/2 top-24 z-30 -translate-x-1/2 flex items-center gap-3 px-4 h-10 rounded-xl border text-sm whitespace-nowrap ${toneClass}`}
      >
        <span>{text}</span>
        <button type="button" data-testid="quota-shrink-btn" onClick={() => setShrinkOpen(true)}
          {...(hard ? dangerBtnProps : { className: BTN_SECONDARY })}>
          {hard ? '一键瘦身' : '瘦身'}
        </button>
        {hard && (
          <>
            <button type="button" data-testid="quota-export-btn" onClick={() => void onExport()}
              {...dangerBtnProps}>
              导出到新项目
            </button>
            {overQuotaTerminal && (
              // 终态后唯一复位路径（terminalSuppressed 禁自动重连——瘦身后手动重连=新会话新额度）；
              // Y0b-5 T6 改道 safeReload('quota-shrink')——未同步编辑在盘时落导出对话框不直接刷新
              <button type="button" data-testid="quota-reconnect-btn" onClick={() => safeReload('quota-shrink')}
                className={BTN_SECONDARY}>
                重新连接
              </button>
            )}
          </>
        )}
      </div>
      <ShrinkDialog open={shrinkOpen} onClose={() => setShrinkOpen(false)} projectId={projectId} />
    </>
  );
}
