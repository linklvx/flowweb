// apps/web/src/pages/canvas/CanvasErrorBoundary.tsx
// Y0b-5 T2（spec §5.6）：画布路由根 ErrorBoundary——渲染异常兜底。componentDidCatch→
// invariant_violation{where:'react-boundary'}（★裁定 24⑹ 对齐既有 where 键）+同步 flushTelemetry
// （崩溃页随时被关闭——不等 30s 心跳批量）+降级 UI（刷新+导出逃生）。
// ★错误栈受控枚举（裁定 24 杂项）：error.name+首帧 file:line 折 detail（无整栈——schema 键域
// TELEMETRY_DETAIL_SCHEMA.invariant_violation{name,frame}=log-only）——Y5 前可诊断非只知崩了。
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordCollabDiag, flushTelemetry } from '@/utils/collabDiagnostics';
import { escapeWithLocalExport, safeReload } from '@/stores/canvasCollabRuntime';

/** 首帧 file:line（剥列号——仅 "路径:行" 受控字符串；截 160 尾段防长 URL 撑爆服务端 512B 单条上限） */
function firstFrameFileLine(stack?: string): string | undefined {
  const atLine = stack?.split('\n').find((l) => l.trim().startsWith('at'));
  const m = atLine?.match(/([^\s()]+:\d+):\d+\)?/);
  return m?.[1]?.slice(-160);
}

interface State { error: Error | null }

export class CanvasErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    recordCollabDiag('invariant_violation', {
      where: 'react-boundary',
      name: error.name,
      frame: firstFrameFileLine(error.stack),
    });
    flushTelemetry(); // 同步即刻上报——崩溃页随时被关闭，30s 心跳等不到
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          background: '#111827', color: '#f9fafb',
        }}>
          <p style={{ fontSize: 16, margin: 0 }}>画布渲染出现异常，可刷新重试；本地内容可先导出留存。</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Y0b-5 T6 改道 safeReload（reload 收敛 9 处）——未同步编辑在盘时落导出对话框不直接刷新 */}
            <button type="button" aria-label="刷新页面" style={{ fontSize: 14, padding: '6px 16px', cursor: 'pointer' }}
              onClick={() => safeReload('generic')}>
              刷新页面
            </button>
            <button type="button" aria-label="导出本地画布" style={{ fontSize: 14, padding: '6px 16px', cursor: 'pointer' }}
              onClick={() => escapeWithLocalExport()}>
              导出本地画布
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
