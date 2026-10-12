// apps/web/src/pages/canvas/CanvasErrorBoundary.test.tsx
// Y0b-5 T2 红测（spec §5.6）：画布路由根 ErrorBoundary——componentDidCatch→
// invariant_violation{where:'react-boundary'}（★裁定 24⑹ 对齐既有 where 键——T2 初稿 surface
// 与 T0 schema 表矛盾）+同步 flushTelemetry（崩溃页随时被关——不等 30s 心跳）+降级 UI（刷新+
// 导出按钮）；★错误栈受控枚举（裁定 24 杂项）：error.name+首帧 file:line 折 detail——Y5 前可诊断
// 非只知崩了；挂载=canvas 路由根（不裹全局 App）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import { getRecentCollabDiag, _resetCollabDiagForTest, type CollabDiagEvent } from '@/utils/collabDiagnostics';

// runtime 依赖仅逃生导出（escapeWithLocalExport）——mock 隔离真模块（page.test 先例）；
// flushTelemetry mock：断言"同步 flush"调用面（真 flush 已在 collabDiagnostics.test 直测）。
// vi.hoisted：vi.mock 工厂提升到文件顶——工厂内引用需经 hoisted 绑定（page.test 先例）
const { escapeMock, flushMock } = vi.hoisted(() => ({ escapeMock: vi.fn(), flushMock: vi.fn() }));
vi.mock('@/stores/canvasCollabRuntime', () => ({ escapeWithLocalExport: escapeMock }));
vi.mock('@/utils/collabDiagnostics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/collabDiagnostics')>();
  return { ...actual, flushTelemetry: flushMock };
});

class Boom extends Error {
  constructor(message: string) { super(message); this.name = 'CanvasBoom'; }
}
/** 受控抛错子组件（render 期抛——getDerivedStateFromError/componentDidCatch 双触发；
 *  返回类型显式 ReactNode：body 恒 throw 无 return，void 推断不被 JSX 接受） */
function Throwing({ error }: { error: Error }): ReactNode { throw error; }

const detailsOf = (type: CollabDiagEvent['type']) =>
  getRecentCollabDiag().filter((e) => e.type === type).map((e) => e.detail ?? {});

describe('Y0b-5 T2：CanvasErrorBoundary（画布路由根）', () => {
  beforeEach(() => {
    _resetCollabDiagForTest();
    escapeMock.mockReset();
    flushMock.mockReset();
  });

  it('componentDidCatch→invariant_violation{where:"react-boundary"}+error.name+首帧 file:line 折 detail（受控枚举——无整栈）+同步 flushTelemetry', () => {
    const boom = new Boom('canvas exploded');
    render(
      <CanvasErrorBoundary>
        <Throwing error={boom} />
      </CanvasErrorBoundary>,
    );
    const entries = detailsOf('invariant_violation');
    expect(entries).toHaveLength(1);
    expect(entries[0].where).toBe('react-boundary');
    expect(entries[0].name).toBe('CanvasBoom');
    // 首帧 file:line（剥列号——仅路径:行字符串，无整栈）
    expect(String(entries[0].frame)).toMatch(/:\d+$/);
    expect(String(entries[0].frame)).not.toContain('\n');
    expect(flushMock).toHaveBeenCalledTimes(1);   // 同步 flush——崩溃页随时被关闭
  });

  it('降级 UI：刷新+导出两行动作（导出=escapeWithLocalExport 逃生通道）', () => {
    render(
      <CanvasErrorBoundary>
        <Throwing error={ new Boom('x') } />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    const exportBtn = screen.getByRole('button', { name: '导出本地画布' });
    exportBtn.click();
    expect(escapeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeTruthy();   // location.reload——T6 改道 safeReload（此测试只验存在不点击——jsdom reload 未实现）
  });

  it('无错时透传 children（零记录零 flush）', () => {
    const { container } = render(
      <CanvasErrorBoundary>
        <div data-testid="child">ok</div>
      </CanvasErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="child"]')).toBeTruthy();
    expect(detailsOf('invariant_violation')).toHaveLength(0);
    expect(flushMock).not.toHaveBeenCalled();
  });
});

describe('Y0b-5 T2：挂载=canvas 路由根（router.tsx——不裹全局 App）', () => {
  it('接线锚（源码文本）：/canvas element=CanvasErrorBoundary 包 CanvasPage；不裹 App 根', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'router.tsx'), 'utf8');
    const m = src.match(/path: '\/canvas', element: <([\s\S]{0,200}?)\/>/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('CanvasErrorBoundary');
    expect(m![1]).toContain('CanvasPage');
    // 不裹全局 App：App/main 入口零 CanvasErrorBoundary 引用
    const appSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'App.tsx'), 'utf8');
    expect(appSrc).not.toContain('CanvasErrorBoundary');
  });
});
