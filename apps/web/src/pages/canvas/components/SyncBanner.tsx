// apps/web/src/pages/canvas/components/SyncBanner.tsx
// Y0b-3 T9 Step6：协作横幅（批1-5 connUi 注释承诺的 SyncBanner 消费者）——
// wsAuthNotice 分档：版本族终态（reload 自愈/逃生动作）/会话过期（重登）/无权（回工作区）/
// message-too-big 第六终态档（逃生=版本逃生同一按钮——P-V⑧）/未知终态兜底；
// 瞬态族（db-unavailable/server-overloaded/rate-limited/draining 等——「服务繁忙，正在自动重试」）；
// write-frozen（P-S 维护横幅「请勿刷新页面」）；connUi 分级（批1-1 machine 输出）。
// 非阻断顶部横幅；优先级：terminal 鉴权 > 瞬态鉴权 > write-frozen > connUi banner > connUi hint。
import type { ReactNode } from 'react';
import { CollabAuthReason, MESSAGE_TOO_BIG_TERMINAL_REASON } from '@flowweb/shared';
import { useCanvasStore } from '@/stores/canvasStore';
import { escapeWithLocalExport } from '@/stores/canvasCollabRuntime';
import { loginUrl } from '@/utils/loginRedirect';

/** 版本族终态（reload 自愈档——与 runtime VERSION_TERMINAL_REASONS 同表：schema-outdated/
 *  client-version-missing/client-version-invalid；server-outdated 是瞬态档不入） */
const VERSION_FAMILY: ReadonlySet<string> = new Set([
  CollabAuthReason.SCHEMA_OUTDATED,
  CollabAuthReason.CLIENT_VERSION_MISSING,
  CollabAuthReason.CLIENT_VERSION_INVALID,
]);

const TONE_CLASS: Record<string, string> = {
  error: 'bg-red-950/95 border-red-500/40 text-red-100',
  warn: 'bg-amber-950/95 border-amber-500/40 text-amber-100',
  info: 'bg-overlay-2/95 border-white/10 text-text-dim-1',
};

interface BannerContent { tone: keyof typeof TONE_CLASS; text: string; action?: ReactNode }

/** 逃生按钮（唯一逃生动作：导出本地画布→强制刷新——版本族与 message-too-big 共用，P-V⑧） */
function EscapeButton() {
  return (
    <button
      type="button"
      data-testid="collab-escape-btn"
      onClick={escapeWithLocalExport}
      className="shrink-0 px-3 h-7 rounded-lg bg-overlay-3 hover:bg-overlay-2 text-text text-xs border border-white/10"
    >
      导出本地画布并刷新
    </button>
  );
}

function resolveContent(
  connUi: 'ok' | 'hint' | 'banner',
  notice: { reason: string; terminal: boolean } | null,
  writeFrozen: boolean,
  escapePending: boolean,
): BannerContent | null {
  if (notice?.terminal) {
    const r = notice.reason;
    if (VERSION_FAMILY.has(r)) {
      return {
        tone: 'error',
        text: '系统已更新，页面版本过期',
        // 逃生 pending=runtime reload 自愈不可行（loop 保护/未同步守卫/ready 不可达）——落一键逃生
        action: escapePending
          ? <EscapeButton />
          : <span className="text-xs opacity-80">正在自动刷新…</span>,
      };
    }
    if (r === MESSAGE_TOO_BIG_TERMINAL_REASON) {
      return { tone: 'error', text: '画布内容超出单帧大小限制，无法继续同步', action: <EscapeButton /> };
    }
    if (r === CollabAuthReason.SESSION_EXPIRED || r === CollabAuthReason.UNAUTHENTICATED) {
      return {
        tone: 'error',
        text: '登录已过期',
        action: <a data-testid="collab-relogin-link" href={loginUrl()} className="shrink-0 underline text-xs">重新登录</a>,
      };
    }
    if (r === CollabAuthReason.FORBIDDEN || r === CollabAuthReason.NOT_FOUND) {
      return {
        tone: 'error',
        text: '无权访问该画布',
        action: <a data-testid="collab-back-works-btn" href="/works" className="shrink-0 underline text-xs">返回工作区</a>,
      };
    }
    return { tone: 'error', text: '协作连接已终止' };
  }
  if (notice) return { tone: 'warn', text: '服务繁忙，正在自动重试…' };
  if (writeFrozen) return { tone: 'warn', text: '服务维护中，编辑已暂停；恢复后可继续（请勿刷新页面）' };
  if (connUi === 'banner') return { tone: 'warn', text: '连接已断开，正在自动重连…' };
  if (connUi === 'hint') return { tone: 'info', text: '连接不稳定，正在自动重连…' };
  return null;
}

export function SyncBanner() {
  const connUi = useCanvasStore((s) => s.connUi);
  const wsAuthNotice = useCanvasStore((s) => s.wsAuthNotice);
  const writeFrozen = useCanvasStore((s) => s.writeFrozen);
  const collabEscapePending = useCanvasStore((s) => s.collabEscapePending);

  const content = resolveContent(connUi, wsAuthNotice, writeFrozen, collabEscapePending);
  if (!content) return null;
  return (
    <div
      data-testid="collab-sync-banner"
      role="alert"
      className={`absolute left-1/2 top-14 z-30 -translate-x-1/2 flex items-center gap-3 px-4 h-10 rounded-xl border text-sm whitespace-nowrap ${TONE_CLASS[content.tone]}`}
    >
      <span>{content.text}</span>
      {content.action}
    </div>
  );
}
