// apps/web/src/pages/canvas/components/SyncBanner.tsx
// Y0b-3 T9 Step6：协作横幅（批1-5 connUi 注释承诺的 SyncBanner 消费者）。
// Y0b-5 T6：横幅单链仲裁（spec §5.7 v2.2 互斥裁定）——resolveCanvasBanner 纯函数（输入=store 投影，
// 输出=档位+文案+动作），十级优先链任一时刻至多渲一档：
//   terminal 鉴权 > escape-pending > 配额终态 > diverged > oversized > degraded > persist 未保存
//   > write-frozen > readyProbeHint > syncLag > connUi。
// escape-pending（T6 质量修复 C1——独立高位分支）：safeReload 被 unsyncedDirty 分叉置
//   collabEscapePending 的唯一可见化出口（9 处 reload 点共用——分叉在任何上下文必可见）。
//   位次=terminal 鉴权档之后、配额终态之前（逃生阻断是最高运营优先的即时状态）；与 version-family
//   自有分支并存时 escape 优先（其「正在自动刷新」是假承诺——reload 已被分叉阻断）。
// diverged（裁定 24⑬ 高位）：服务端已明确拒收（readOnly 期本地编辑），"自动合并"承诺为假——
//   三出边=导出 .yjs / 放弃本地副本（二次确认,不可逆动作排在保全动作之后）/ 服务端最终接受（runtime tick）。
// 能力位（裁定 21）：localCacheReady 字段已落,单链 persist 档分支结构就位——T6 阶段文案恒维持
//   「未保存」档永不谎报（文案翻转归 T8 whenSynced 真值驱动）。
// persist 档（V15）位次高于 write-frozen（最高运营优先）：persistUnhealthy∧syncLagOver60s 同真只渲
//   persist 档——syncLag 降级文案零刷新词,「可尝试刷新」与「请勿刷新」结构性不同屏。
import type { ReactNode } from 'react';
import {
  CollabAuthReason, COLLAB_VERSION_TERMINAL_REASONS, MESSAGE_TOO_BIG_TERMINAL_REASON,
  SS2_OVER_LIMIT_TERMINAL_REASON,
} from '@flowweb/shared';
import { useCanvasStore } from '@/stores/canvasStore';
import { escapeWithLocalExport, safeReload, getDoc, discardLocalDiverged } from '@/stores/canvasCollabRuntime';
import { exportLocalBackup } from '@/collab/canvas-local-backup';
import { loginUrl } from '@/utils/loginRedirect';

/** 版本族终态（reload 自愈档——shared COLLAB_VERSION_TERMINAL_REASONS 单源，评审 M-1：
 *  与 runtime VERSION_TERMINAL_REASONS 原两处本地表合一；server-outdated 是瞬态档不入） */
const VERSION_FAMILY: ReadonlySet<string> = new Set(COLLAB_VERSION_TERMINAL_REASONS);

const TONE_CLASS: Record<string, string> = {
  error: 'bg-red-950/95 border-red-500/40 text-red-100',
  warn: 'bg-amber-950/95 border-amber-500/40 text-amber-100',
  info: 'bg-overlay-2/95 border-overlay-2 text-text-dim-1',
};

type Tone = keyof typeof TONE_CLASS;

interface BannerContent { tone: Tone; text: string; action?: ReactNode }

/** 逃生按钮（唯一逃生动作：导出本地画布——版本族与 message-too-big 共用，P-V⑧）。
 *  T6：导出后不自动刷新（reload=用户显式第二次动作）——文案去「并刷新」承诺词。 */
function EscapeButton() {
  return (
    <button
      type="button"
      data-testid="collab-escape-btn"
      onClick={escapeWithLocalExport}
      className="shrink-0 px-3 h-7 rounded-lg bg-overlay-3 hover:bg-overlay-2 text-text text-xs border border-overlay-2"
    >
      导出本地画布
    </button>
  );
}

/** diverged/ss2-over-limit 双动作：导出 .yjs（保全）在前+放弃本地副本（不可逆——二次确认通过才执行,
 *  破坏性次序锚=不可逆动作禁先于保全动作出现）。 */
function DivergedActions() {
  return (
    <>
      <button
        type="button"
        data-testid="diverged-export-btn"
        onClick={() => { try { exportLocalBackup(getDoc()); } catch { /* 导出失败可重试 */ } }}
        className="shrink-0 px-3 h-7 rounded-lg bg-overlay-3 hover:bg-overlay-2 text-text text-xs border border-overlay-2"
      >
        导出 .yjs
      </button>
      <button
        type="button"
        data-testid="diverged-discard-btn"
        onClick={() => {
          if (window.confirm('确定放弃本地未上行副本？页面将刷新并恢复服务端版本，该操作不可恢复。')) {
            discardLocalDiverged();
          }
        }}
        className="shrink-0 px-3 h-7 rounded-lg bg-overlay-3 hover:bg-overlay-2 text-text text-xs border border-overlay-2"
      >
        放弃本地副本
      </button>
    </>
  );
}

// ── Y0b-5 T6：单链输入/输出模型（纯函数测试面）──
export interface CanvasBannerInput {
  connUi: 'ok' | 'hint' | 'banner';
  wsAuthNotice: { reason: string; terminal: boolean } | null;
  wsQuotaTerminal: { code: number; reason: string } | null;
  canvasDiverged: boolean;
  canvasOversized: boolean;
  canvasDegraded: boolean;
  persistUnhealthy: boolean;
  writeFrozen: boolean;
  syncLagOver60s: boolean;
  localCacheReady: boolean;
  collabEscapePending: boolean;
  readyProbeHint: string | null;
}

export type CanvasBannerBranch =
  | ({ kind: 'terminal-auth' | 'escape-pending' | 'ss2-over-limit' | 'diverged' | 'oversized' | 'degraded' | 'persist'
      | 'write-frozen' | 'sync-lag' | 'conn-ui' } & BannerContent)
  | { kind: 'quota-terminal' }   // 渲染权=QuotaBanner（单链仲裁位次仍生效——压 diverged 以下全档）
  | null;

/** escape 分叉档（T6 质量修复 C1）：safeReload 被 unsyncedDirty 分叉（collabEscapePending 置位）的
 *  唯一可见化出口——9 处 reload 点共用（重试连接/瘦身重连/重建历史等分叉后横幅必达）。 */
function escapePendingBranch(): CanvasBannerBranch {
  return {
    kind: 'escape-pending', tone: 'warn',
    text: '有未同步本地编辑，已阻止刷新——可导出本地副本',
    action: <EscapeButton />,
  };
}

/** 单链仲裁纯函数：输入=store 投影,输出=胜出档位（任一时刻至多一档——互斥裁定 spec §5.7 v2.2）。
 *  denylist 面=本函数全分支文案（跨刷新承诺词扫描锚——非三处字符串）。 */
export function resolveCanvasBanner(input: CanvasBannerInput): CanvasBannerBranch {
  if (input.wsAuthNotice?.terminal) {
    const r = input.wsAuthNotice.reason;
    if (VERSION_FAMILY.has(r)) {
      // C1：escape 并存时优先于 version-family 自有分支——reload 已被 dirty 分叉,
      // 「正在自动刷新…」是假承诺（handleVersionTerminal 预 gate 下 safeReload('version') 永不落此分叉）
      if (input.collabEscapePending) return escapePendingBranch();
      return {
        kind: 'terminal-auth', tone: 'error', text: '系统已更新，页面版本过期',
        action: <span className="text-xs opacity-80">正在自动刷新…</span>,
      };
    }
    if (r === MESSAGE_TOO_BIG_TERMINAL_REASON) {
      return { kind: 'terminal-auth', tone: 'error', text: '画布内容超出单帧大小限制，无法继续同步', action: <EscapeButton /> };
    }
    if (r === CollabAuthReason.SESSION_EXPIRED || r === CollabAuthReason.UNAUTHENTICATED) {
      return {
        kind: 'terminal-auth', tone: 'error', text: '登录已过期',
        action: <a data-testid="collab-relogin-link" href={loginUrl()} className="shrink-0 underline text-xs">重新登录</a>,
      };
    }
    if (r === CollabAuthReason.FORBIDDEN || r === CollabAuthReason.NOT_FOUND) {
      return {
        kind: 'terminal-auth', tone: 'error', text: '无权访问该画布',
        action: <a data-testid="collab-back-works-btn" href="/works" className="shrink-0 underline text-xs">返回工作区</a>,
      };
    }
    return { kind: 'terminal-auth', tone: 'error', text: '协作连接已终止' };
  }
  // C1：escape 独立高位分支——terminal 鉴权档之后、配额终态之前（逃生阻断是最高运营优先的即时状态）
  if (input.collabEscapePending) return escapePendingBranch();
  if (input.wsAuthNotice) return { kind: 'terminal-auth', tone: 'warn', text: '服务繁忙，正在自动重试…' };
  if (input.wsQuotaTerminal) {
    // Y0b-5 T6（裁定 25⑸①）：ss2-over-limit=客户端本地超额（服务端 doc 往往小——瘦身指引治不了
    // 此病）→文案=导出 .yjs→丢弃本地副本（diverged 放弃出边形态,非瘦身）；其余配额终态渲染权在 QuotaBanner。
    if (input.wsQuotaTerminal.reason === SS2_OVER_LIMIT_TERMINAL_REASON) {
      return { kind: 'ss2-over-limit', tone: 'error', text: '本地备份超出单文档上限，无法自动恢复', action: <DivergedActions /> };
    }
    return { kind: 'quota-terminal' };
  }
  if (input.canvasDiverged) {
    return { kind: 'diverged', tone: 'warn', text: '有本地未上行副本（服务端暂停接收期间的编辑）', action: <DivergedActions /> };
  }
  // T8 邻档：本批结构就位字段驱动（恒 false 文案不可达——真实翻转归 T8）
  if (input.canvasOversized) return { kind: 'oversized', tone: 'warn', text: '本地内容超出单文档上限，请导出后瘦身' };
  if (input.canvasDegraded) return { kind: 'degraded', tone: 'warn', text: '本地数据已降级，正在从服务端恢复' };
  // Y0b-5 T6（V15）：persist 未保存档——最高运营优先（高于 write-frozen）。能力位（裁定 21）：
  // 文案恒维持「未保存」档永不谎报——localCacheReady 只入参不参与本档文案（翻转归 T8 whenSynced）。
  if (input.persistUnhealthy) return { kind: 'persist', tone: 'warn', text: '内容尚未保存（服务保存异常）——请导出本地副本，请勿刷新页面' };
  if (input.writeFrozen) return { kind: 'write-frozen', tone: 'warn', text: '服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）' };
  // Y0b-5 T4：probeReadyReason 探测 hint（重连成功但状态异常——服务端 reason 可见）
  if (input.readyProbeHint) return { kind: 'conn-ui', tone: 'info', text: `服务端状态异常（${input.readyProbeHint}），正在自动重连…` };
  // syncLag 档（T7 置位）：降级文案零刷新词——persistUnhealthy 同真时本档不可达（位次更低）,
  // 「可尝试刷新」与「请勿刷新」矛盾文案结构性不同屏。
  if (input.syncLagOver60s) return { kind: 'sync-lag', tone: 'warn', text: '同步延迟较高，请导出本地副本' };
  if (input.connUi === 'banner') return { kind: 'conn-ui', tone: 'warn', text: '连接已断开，正在自动重连…' };
  if (input.connUi === 'hint') return { kind: 'conn-ui', tone: 'info', text: '连接不稳定，正在自动重连…' };
  return null;
}

export function SyncBanner() {
  const connUi = useCanvasStore((s) => s.connUi);
  const wsAuthNotice = useCanvasStore((s) => s.wsAuthNotice);
  const wsQuotaTerminal = useCanvasStore((s) => s.wsQuotaTerminal);
  const writeFrozen = useCanvasStore((s) => s.writeFrozen);
  const collabEscapePending = useCanvasStore((s) => s.collabEscapePending);
  const readyProbeHint = useCanvasStore((s) => s.readyProbeHint);
  const canvasDiverged = useCanvasStore((s) => s.canvasDiverged);
  const canvasOversized = useCanvasStore((s) => s.canvasOversized);
  const canvasDegraded = useCanvasStore((s) => s.canvasDegraded);
  const persistUnhealthy = useCanvasStore((s) => s.persistUnhealthy);
  const syncLagOver60s = useCanvasStore((s) => s.syncLagOver60s);
  const localCacheReady = useCanvasStore((s) => s.localCacheReady);

  const branch = resolveCanvasBanner({
    connUi, wsAuthNotice, wsQuotaTerminal, writeFrozen, collabEscapePending, readyProbeHint,
    canvasDiverged, canvasOversized, canvasDegraded, persistUnhealthy, syncLagOver60s, localCacheReady,
  });
  // quota-terminal 渲染权=QuotaBanner（独立组件同挂载点——单链仲裁位次仍压制本组件全档）
  if (!branch || branch.kind === 'quota-terminal') return null;
  return (
    <div
      data-testid="collab-sync-banner"
      role="alert"
      className={`absolute left-1/2 top-14 z-30 -translate-x-1/2 flex items-center gap-3 px-4 h-10 rounded-xl border text-sm whitespace-nowrap ${TONE_CLASS[branch.tone]}`}
    >
      <span>{branch.text}</span>
      {branch.action}
    </div>
  );
}
