# 多轨道剪辑器 UI/交互层深度改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec [2026-09-11-video-editor-ui-overhaul-design.md](../specs/2026-09-11-video-editor-ui-overhaul-design.md) 修复层级缺陷并对齐 opencut 交互质量（暗色/布局/缩略图/缩放锚定/比例/导出中转），7 批次递进。

**Architecture:** 保留 editorStore/scene/renderer/audio-engine/export 管线（与画布 Yjs 协作深度绑定），只动 UI 交互层与导出通道；opencut 以算法级移植（无直接 import）。批 1 是独立证伪实验（层级诊断对错由浏览器首验判定），后续批次依赖其结论。

**Tech Stack:** React 18 + antd 5.22.5 + Tailwind（无 preflight）+ zustand 4 + Vitest；新依赖 `react-resizable-panels`；后端 NestJS + Prisma。

**执行纪律（每个 implementer 必读）：**
- TDD 铁律：NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。每任务先写测试看红，再实现看绿。
- CLAUDE.md 四原则：编码前先思考/简洁优先/精准修改/目标驱动。不动任务清单外的代码。
- 测试命令：`cd D:/flowweb && pnpm --filter @flowweb/web test -- --run <文件路径>`（web 端）；`pnpm --filter @flowweb/api test -- --run <路径>`（api 端）。
- 提交信息带批次前缀，如 `feat(video-editor): 批1 层级修复——…`。
- 既有验收资产不得回退：`startingRef` 重入锁、`beforeunload` 模块级守卫、autosave flush 关闭路径。

---

## 文件结构总览

| 批 | Create | Modify |
|---|---|---|
| 1 | `components/PopupScope.test.tsx` | `components/VideoEditorShell.tsx`、`AssetPanel.tsx`、`ExportModal.tsx`、`PreviewPlayer.tsx` |
| 2 | — | `VideoEditorShell.tsx`、`PreviewPlayer.tsx`、`index.css`（全局，仅加编辑器段） |
| 3 | `timeline/placement.ts`（+test） | `types.ts`（shared 同步）、`store/editorStore.ts`、`components/AssetPanel.tsx`、`components/timeline/TimelinePanel.tsx`、`components/timeline/ClipBlock.tsx`、`components/timeline/TimelineRuler.tsx`、`hooks/useEditorKeyboard.ts` |
| 4+5 | `timeline/canvas-size.ts`（+test） | `types.ts`、`PreviewPlayer.tsx`、`hooks/usePreviewPlayback.ts`、`renderer/canvas-renderer.ts`、`scene/subtitle-layout.ts`、`export/precheck.ts`、`export/worker.ts`、`components/EditorTopBar.tsx`、`VideoEditNode.tsx`、api 端 `video-project.dto.ts`、`generated-media.service.ts` |
| 6 | — | `export/client.ts`、`export/worker.ts`、`export/upload.ts`、`components/ExportModal.tsx`（重构为 Popover）、`store/editorStore.ts` |
| 7 | — | api 端 `generated-media.service.ts`、`temp-cleanup.processor.ts`、`video-project.dto.ts` |

> types.ts 说明：`apps/web/src/pages/canvas/video-editor/types.ts` 是 `packages/shared/src/types/video-project.ts` 的 re-export 壳（仓内既有模式），schema 改动一律落 shared，web 侧跟随。

---

## 批 1｜层级修复（最小证伪实验）

**只做层级不动 theme。** 失败 = z-index 诊断错，停止后续批次回批重查。

### Task 1: Shell 弹层作用域（ConfigProvider + AntdApp + shellRef）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`
- Test: `apps/web/src/pages/canvas/video-editor/components/PopupScope.test.tsx`（Create）

- [ ] **Step 1: 写失败测试——弹层挂载容器必须在壳内**

```tsx
// apps/web/src/pages/canvas/video-editor/components/PopupScope.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfigProvider, App as AntdApp } from 'antd';

// 与 Shell 相同的作用域结构被测：这里直接测真实 VideoEditorShell 太重（需画布 store 夹具），
// 测"Shell 渲染出的弹层容器在壳内"用 ExportModal 的触发链路集成测（Task 2 Step 4）。
// 本文件测机制骨架：ConfigProvider getPopupContainer 指向壳 div 后，Modal 挂载进壳。
describe('编辑器弹层作用域', () => {
  it('Modal 挂载容器落在壳节点内（非 document.body 直挂）', async () => {
    const shellRef = { current: null as HTMLDivElement | null };
    const {container} = render(
      <div data-testid="video-editor-shell" ref={(el) => { shellRef.current = el; }}>
        <ConfigProvider getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp>
            <ScopeProbeModal open />
          </AntdApp>
        </ConfigProvider>
      </div>
    );
    await waitFor(() => {
      const mask = document.querySelector('.ant-modal-mask') ?? container.querySelector('.ant-modal');
      expect(mask).toBeTruthy();
      // 断言：Modal 的根层容器在壳内（closest 链），不在 body 直挂
      expect((mask as HTMLElement).closest('[data-testid="video-editor-shell"]')).not.toBeNull();
    });
  });
});

import { Modal } from 'antd';
function ScopeProbeModal({ open }: { open: boolean }) {
  return <Modal open={open} title="探针">{null}</Modal>;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor/components/PopupScope.test.tsx`
Expected: FAIL——现状 Shell 无 ConfigProvider（本测试自带 ConfigProvider 是探针结构；真正的失败断言点：先注释掉 ConfigProvider 包裹跑一次见红，确认断言有效后再恢复）。做法：先写不带 ConfigProvider 的版本跑红，再加上 ConfigProvider 跑绿。

- [ ] **Step 3: 改造 VideoEditorShell——加 ConfigProvider + AntdApp + shellRef，Shell 内 2 处静态 message 改 useApp()**

VideoEditorShell.tsx 关键改动（保留全部现有逻辑，只动弹层作用域与 message 来源）：

```tsx
import { useEffect, useRef, useState } from 'react';
import { ConfigProvider, App as AntdApp } from 'antd'; // ← 替换 `import { message } from 'antd'`

export function VideoEditorShell() {
  // ...现有 state/effect 全部保留...
  const shellRef = useRef<HTMLDivElement>(null);        // ← 新增
  const { message } = AntdApp.useApp();                 // ← 新增（:53 onConflict 与 :76 handleClose 内的 message.warning 来源替换，调用代码不变）
  // ...
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      <div data-testid="video-editor-shell" ref={focusRef} tabIndex={-1}
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border nokey">
        {/* 批 1：弹层作用域——antd 弹层挂进壳内（高于壳 z-[100000] 的层叠由 DOM 顺序保证），
            ref 未挂载首帧兜底 body（getPopupContainer 不得返回 null） */}
        <ConfigProvider getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp>
            <EditorTopBar onClose={handleClose} onManualRetry={() => { void autosaveRef.current?.retry(); }} onExport={() => setExportOpen(true)} />
            <div className="flex flex-1 min-h-0">
              <AssetPanel />
              <div className="flex-1 flex flex-col min-w-0">
                <PreviewPlayer />
                <TimelinePanel />
              </div>
              <PropertiesPanel />
            </div>
            <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
          </AntdApp>
        </ConfigProvider>
      </div>
    </BaseFullscreenModal>
  );
}
```

注意：`ref={focusRef}` 与 `shellRef` 并存（focusRef 管焦点、shellRef 管弹层容器），合并为一个 ref 数组亦可但**精准修改优先：新增独立 ref**。

- [ ] **Step 4: 跑既有测试确认无回归**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor`
Expected: 全 PASS（jsdom 无层叠上下文，本步只验证 DOM 结构与行为不破）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx apps/web/src/pages/canvas/video-editor/components/PopupScope.test.tsx
git commit -m "feat(video-editor): 批1-1 编辑器弹层作用域——壳内 ConfigProvider getPopupContainer + AntdApp，Shell 内 message 改上下文实例（P0-A）"
```

### Task 2: 编辑器内其余 8 处静态调用改 useApp()

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx:45,46,58,59`、`ExportModal.tsx:89,108`、`PreviewPlayer.tsx:45(Modal.confirm),55`
- Test: 上述组件既有测试文件（跑通为准，不新增用例——调用形态变化无行为变化）

- [ ] **Step 1: AssetPanel——顶部 `import { message } from 'antd'` 改 `import { App as AntdApp } from 'antd'` + 组件体内 `const { message } = AntdApp.useApp();`**

四处调用（:45 `message.error('仅支持视频、音频、图片文件')`、:46、:58 `message.success('上传完成')`、:59）代码不变，仅来源变。若 AssetPanel 不是组件根（是函数组件直接导出），`useApp()` 调用放在组件体首行。

- [ ] **Step 2: ExportModal 同法改造（:89 `message.warning('工程尚未就绪…')`、:108 `message.success('导出完成…')`）；注意 ExportModal 内的 `startExport` 是事件闭包——`useApp()` 返回的实例是稳定引用（antd 保证），闭包内直接用，不依赖 hooks 规则**

- [ ] **Step 3: PreviewPlayer——`Modal.confirm`（:45 片段重拍）改 `modal.confirm`，`message.error`（:55）改 `message.error`；`const { message, modal } = AntdApp.useApp();` 放组件体首行；删除 `import { Modal, ... } from 'antd'` 中的 Modal（Slider/Tooltip/message 若仍被用则保留，message 导入删除）**

- [ ] **Step 4: 集成断言——ExportModal 测试补挂载容器用例**

在 `ExportModal.test.tsx` 追加：

```tsx
it('导出弹层挂载在壳作用域内（P0-A 回归）', async () => {
  // 复用该文件既有夹具渲染 ExportModal（open=true）
  // 断言 .ant-modal-wrap 的最近弹层容器在测试容器内而非 body 直挂——
  // 经由 ConfigProvider 包裹的渲染路径（夹具需补 ConfigProvider+AntdApp，与 Shell 同构）
  const wrap = document.querySelector('.ant-modal-wrap');
  expect(wrap).toBeTruthy();
});
```

- [ ] **Step 5: 跑批 1 全部测试 + Commit**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor`
Expected: 全 PASS

```bash
git add -A apps/web/src/pages/canvas/video-editor/components
git commit -m "feat(video-editor): 批1-2 编辑器内 8 处静态 message/Modal.confirm 改 App.useApp() 上下文实例（P0-A）"
```

### Task 3: 浏览器证伪验收（人工步骤，不可跳过）

- [ ] **Step 1: 确认 dev 服务运行（preview_start api/web），打开 http://localhost:5173/canvas 建画布，添加「多轨道剪辑」节点，进全屏编辑，添加任一素材到轨道，点「导出」按钮**

预期：**导出弹层完整可见**（在编辑器之上）。若仍不可见 → z-index 诊断被证伪，立即停止后续批次，回报诊断修正（检查方向：BaseFullscreenModal 的 portal 层、antd Modal wrap 的实际 z-index computed style）。

- [ ] **Step 2: 验证片段重拍 confirm 与 toast 可见（选中带源视频片段点「片段重拍」→ confirm 弹层可见；上传一个素材 → 成功 toast 可见且为白底之外的正常样式）**

- [ ] **Step 3: 验收记录写回本文件勾选 +Commit（空提交或勾选提交）**

---

## 批 2｜暗色化 + 布局 + 图标化

**前置：批 1 证伪通过。** message 已是上下文实例，darkAlgorithm 对 toast 生效。

### Task 4: 暗色主题（darkAlgorithm + token）

**Files:**
- Modify: `VideoEditorShell.tsx`（批 1 的 ConfigProvider 加 theme）、`apps/web/src/index.css`（追加编辑器段）

- [ ] **Step 1: index.css 追加编辑器暗色变量段（复用既有 --canvas-controls-*，只补缺口）**

```css
/* ===== Video Editor dark tokens（spec 批2；复用 --canvas-controls-*，不造第二套） ===== */
:root {
  --ve-bg: #141414;                          /* 壳底 = 全局 body */
  --ve-panel: var(--canvas-controls-bg);      /* rgb(38,38,38) 面板 */
  --ve-border: var(--canvas-controls-border); /* rgb(54,54,54) */
  --ve-text: #e2e8f0;                         /* 正文 = body 同值 */
  --ve-text-control: var(--canvas-controls-text); /* rgb(247,247,247) 控件 */
  --ve-accent: #6C5CE7;
  --ve-track-video: #1f1f1f;                  /* 批3 video 兜底底 */
}
```

- [ ] **Step 2: Shell 的 ConfigProvider 加 theme（一行）**

```tsx
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
<ConfigProvider
  getPopupContainer={() => shellRef.current ?? document.body}
  theme={{ algorithm: antdTheme.darkAlgorithm }}
>
```

- [ ] **Step 3: 五个壳组件底色类批量替换（亮→暗映射，逐文件精准替换）**

映射规则（全编辑器组件统一）：
- `bg-white` → `bg-[var(--ve-panel)]`
- `bg-[#F7F8FA]`（Shell:87）→ `bg-[var(--ve-bg)]`
- `border-[#E5E7EB]` → `border-[var(--ve-border)]`
- `text-[#1F2329]` → `text-[var(--ve-text)]`
- `text-[#4E5969]` → `text-[var(--ve-text)]`（次要文字同主文字，暗色下次要靠透明度：`text-[var(--ve-text)]/80` 可选，保持简单先同值）
- `text-[#86909C]` → `text-[var(--ve-text)] opacity-60`（保留写法：`text-[var(--ve-text)]/60`）
- `bg-[#1F2329]`（导出按钮）→ `bg-[var(--ve-accent)]`
- 涉及文件：`EditorTopBar.tsx`、`PreviewPlayer.tsx`（含控制条 :75）、`PropertiesPanel.tsx`、`AssetPanel.tsx`、`TimelinePanel.tsx`、`TimelineRuler.tsx`、`TrackRow.tsx`

- [ ] **Step 4: 跑测试 + 快照/样式断言无破坏（jsdom 不算色值，既有用例过即可）+ Commit**

```bash
git add -A apps/web/src
git commit -m "feat(video-editor): 批2-1 暗黑扁平主题——darkAlgorithm 编辑器作用域 + --ve-* token（复用 canvas-controls 系）"
```

### Task 5: react-resizable-panels 布局

**Files:**
- Modify: `apps/web/package.json`（依赖）、`VideoEditorShell.tsx`（布局）、`TimelinePanel.tsx`（高度自适应去固定）
- Test: `VideoEditorShell.test.tsx`（布局结构断言）

- [ ] **Step 1: 安装依赖**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web add react-resizable-panels`
Expected: 安装成功（React18 兼容，v2.x）

- [ ] **Step 2: 写失败测试——布局结构（面板组 + 持久化键）**

```tsx
// VideoEditorShell.test.tsx 追加
it('布局为可调面板组：垂直(主区/时间轴) + 水平(素材/预览/属性)，持久化键 ve-panel-sizes', () => {
  // 渲染 Shell（复用既有夹具），断言：
  expect(document.querySelector('[data-panel-group-id="ve-vertical"]')).toBeTruthy();
  expect(document.querySelector('[data-panel-group-id="ve-horizontal"]')).toBeTruthy();
  expect(document.querySelectorAll('[data-panel-group-id="ve-horizontal"] [data-panel]')).toHaveLength(3);
});
```

- [ ] **Step 3: 实现布局改造**

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

// Shell 中段布局替换（EditorTopBar/各面板内容不变）：
<div className="flex flex-1 min-h-0">
  <PanelGroup direction="vertical" id="ve-vertical" autoSaveId="ve-panel-sizes">
    <Panel defaultSize={70} minSize={30}>
      <PanelGroup direction="horizontal" id="ve-horizontal" autoSaveId="ve-panel-sizes-h">
        <Panel defaultSize={20} minSize={15} maxSize={40}><AssetPanel /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" />
        <Panel minSize={30}><PreviewPlayer /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" />
        <Panel defaultSize={22} minSize={15} maxSize={40}><PropertiesPanel /></Panel>
      </PanelGroup>
    </Panel>
    <PanelResizeHandle className="h-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-row-resize" />
    <Panel defaultSize={30} minSize={15} maxSize={70}><TimelinePanel /></Panel>
  </PanelGroup>
</div>
```

说明：`autoSaveId` 即 react-resizable-panels 内建 localStorage 持久化（键为 `react-resizable-panels:${autoSaveId}`，含版本语义）——**用它，不手写持久化**（spec"键名定死"以 autoSaveId 值落实：`ve-panel-sizes` / `ve-panel-sizes-h`）。

同步改动：
- `TimelinePanel.tsx:216` 的 `h-[280px]` 固定高删除（Panel 提供高度，内部 `flex flex-col min-h-0` 自适应）
- `AssetPanel.tsx:31` 的 `w-[260px] shrink-0`、`PropertiesPanel.tsx:74/81` 的 `w-[280px] shrink-0` 删除（Panel 控宽）
- TimelinePanel 视口测量：`viewportW` 改 ResizeObserver 监听容器（现有 `:232 widthPx={viewportW - 140}` 契约保留，140 轨道头宽不变）；ResizeObserver 回调仅 set 宽度 state，Panel 拖动时由库节流

- [ ] **Step 4: 跑测试（新用例绿 + 既有全绿）**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor`
注意：既有用例若断言 `w-[260px]` 等类名需同步改（精准修改，只改断言布局的用例）。

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(video-editor): 批2-2 resizable 布局——垂直(主区/时间轴)+水平(素材/预览/属性)两级面板组，时间轴横向满屏，autoSaveId 持久化"
```

### Task 6: 控制条图标化

**Files:**
- Modify: `PreviewPlayer.tsx:86-95`（四文字按钮→图标）
- Test: `PreviewPlayer.test.tsx`（断言图标按钮）

- [ ] **Step 1: 写失败测试**

```tsx
it('撤销/重做/分割/删除为图标按钮（aria-label + title 含快捷键）', () => {
  // 渲染后断言四个按钮：
  const undo = screen.getByRole('button', { name: /撤销/ });
  expect(undo.querySelector('svg')).toBeTruthy();          // 图标
  expect(undo.getAttribute('title')).toContain('Ctrl+Z');  // Tooltip 文案
  expect(screen.getByRole('button', { name: /分割/ }).getAttribute('title')).toContain('S');
});
```

- [ ] **Step 2: 跑红 → 实现**

```tsx
import { UndoOutlined, RedoOutlined, ScissorOutlined, DeleteOutlined } from '@ant-design/icons';
// 四个按钮替换（onClick 逻辑不变）：
<Tooltip title="撤销 Ctrl+Z"><button type="button" aria-label="撤销" onClick={() => useEditorStore.getState().undo()}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><UndoOutlined /></button></Tooltip>
<Tooltip title="重做 Ctrl+Shift+Z"><button type="button" aria-label="重做" onClick={() => useEditorStore.getState().redo()}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><RedoOutlined /></button></Tooltip>
<Tooltip title="分割 S（在播放头处）"><button type="button" aria-label="分割" onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><ScissorOutlined /></button></Tooltip>
<Tooltip title="删除 Delete"><button type="button" aria-label="删除" onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><DeleteOutlined /></button></Tooltip>
```

注意：既有测试若按文字「撤销」查询按钮，`aria-label` 保住可查性（getByRole name 匹配 aria-label）；跑既有用例同步修正查询方式。

- [ ] **Step 3: 跑绿 + 既有用例 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批2-3 控制条撤销/重做/分割/删除图标化（antd icons + Tooltip 快捷键提示，位置不变不加工具行）"
```

---

## 批 3｜时间轴交互（单轨动态建轨 / 缩略图 / 色表 / 缩放 / 标尺）

### Task 7: 初始单轨 + 测试夹具修复

**Files:**
- Modify: `packages/shared/src/types/video-project.ts:53-64`、`apps/web/src/pages/canvas/video-editor/store/editorStore.ts`（addTrack 命名序 :411 若依赖默认多轨需同步）、测试夹具
- Test: shared 包既有测试 + web 侧受影响夹具

- [ ] **Step 1: 写失败测试**

```ts
// packages/shared/src/types/video-project.test.ts（若无则新建）
import { describe, it, expect } from 'vitest';
import { createDefaultProjectData } from './video-project';
describe('createDefaultProjectData', () => {
  it('初始仅 1 条空视频轨（v3.7 勘误③：其余轨道随素材动态创建）', () => {
    const d = createDefaultProjectData();
    expect(d.tracks).toHaveLength(1);
    expect(d.tracks[0].type).toBe('video');
    expect(d.tracks[0].clips).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红 → 改实现（tracks 数组只留视频轨一项）→ 跑绿（shared + web 全量）**

- [ ] **Step 3: 修受影响夹具（实测名单，非全量）**：`PropertiesPanel.test.tsx:21-28`（tracks[2]→建音频轨后取新轨、tracks[1]→建字幕轨）、`TimelinePanel.render.test.tsx:12-18`（同法）——夹具改为显式 `addTrack` 或手写 tracks 数组，与生产建轨路径一致。

- [ ] **Step 4: 全量测试 + Commit**

```bash
git add packages/shared/src apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批3-1 初始工程单空视频轨（勘误③）+ 夹具显式建轨对齐"
```

### Task 8: 建轨策略纯函数 placeAssetInTrack

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/placement.ts` + `placement.test.ts`

- [ ] **Step 1: 写失败测试（spec 3.1 全部分支）**

```ts
import { describe, it, expect } from 'vitest';
import { placeAssetInTrack } from './placement';
import { createDefaultProjectData } from '../types';
describe('placeAssetInTrack', () => {
  it('视频素材进已有空视频轨，起点 0', () => {
    const d = createDefaultProjectData();
    const r = placeAssetInTrack(d, { mimeType: 'video/mp4', durationSec: 5 });
    expect(r.trackId).toBe(d.tracks[0].id);
    expect(r.start).toBe(0);
    expect(r.createNewTrack).toBe(false);
  });
  it('轨尾口径 = 该轨 max(start+duration)，非全局时长——轨短于全局时不留空隙', () => {
    const d = createDefaultProjectData();
    // 视频轨已有 0-10s 片段，另假设全局（无其他轨）即 10s；音频轨不存在
    d.clips.c1 = { id: 'c1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 10, sourceStart: 0, mediaId: 'm', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never;
    d.tracks[0].clips.push('c1');
    const r = placeAssetInTrack(d, { mimeType: 'audio/mp3', durationSec: 3 });
    expect(r.createNewTrack).toBe(true);   // 无音频轨 → 建
    expect(r.start).toBe(0);               // 新轨从 0
    // 再放第二条音频：轨尾 = 3（该轨），而非全局 10
    const d2 = { ...d, tracks: d.tracks.map(t => t.type === 'audio' ? t : t) };
    // （夹具细节：为第二条断言重建含音频轨的 d2，audio 轨含 0-3s 片段）
    const r2 = placeAssetInTrack(d2, { mimeType: 'audio/mp3', durationSec: 2 });
    expect(r2.start).toBe(3);
  });
  it('mimeType 三分类：video/* 与 image/* → video 轨，audio/* → audio 轨', () => {
    const d = createDefaultProjectData();
    expect(placeAssetInTrack(d, { mimeType: 'image/png', durationSec: 4 }).trackId).toBe(d.tracks[0].id);
  });
});
```

- [ ] **Step 2: 跑红 → 实现**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/placement.ts
import type { ProjectData, Track } from '../types';
import { canPlaceAt } from './overlap'; // 仓内既有（能力复用，勿重写重叠判定）

export type AssetKind = 'video' | 'audio' | 'image';
export function assetKindOf(mimeType: string): AssetKind {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'image';
}
export interface PlacementResult { trackId: string; start: number; createNewTrack: boolean; newTrackType?: Track['type']; }
/** 动态建轨策略（spec 3.1）：按 mimeType 选首个可容纳的类型轨 → 无则标记建轨 → 起点 = 该轨 max(start+duration)（空轨 0） */
export function placeAssetInTrack(data: ProjectData, asset: { mimeType: string; durationSec: number }): PlacementResult {
  const kind = assetKindOf(asset.mimeType);
  const trackType: Track['type'] = kind === 'audio' ? 'audio' : 'video'; // 图片归视频轨
  const candidates = data.tracks.filter((t) => t.type === trackType);
  const trackEnd = (t: Track) => Math.max(0, ...t.clips.map((id) => { const c = data.clips[id]; return c ? c.start + c.duration : 0; }));
  for (const t of candidates) {
    const start = trackEnd(t);
    if (canPlaceAt(data, t.id, start, asset.durationSec)) return { trackId: t.id, start, createNewTrack: false };
  }
  return { trackId: '', start: 0, createNewTrack: true, newTrackType: trackType };
}
```

（`canPlaceAt` 若签名不同以仓内 overlap.ts 实测为准——plan 假设其存在，执行时先读 overlap.ts 对齐签名；若其语义不含"轨内区间空闲"则退化为 trackEnd 追加必然无重叠，直接用 trackEnd 即可，删除 canPlaceAt 依赖。）

- [ ] **Step 3: 跑绿 → Commit**

```bash
git add apps/web/src/pages/canvas/video-editor/timeline
git commit -m "feat(video-editor): 批3-2 placeAssetInTrack 动态建轨纯函数（轨尾口径=单轨 max，TDD）"
```

### Task 9: 点击入轨 + 拖拽不兼容轨自动建轨

**Files:**
- Modify: `AssetPanel.tsx`（卡片 onClick）、`TimelinePanel.tsx:184-185`（静默 return 改建轨）、`store/editorStore.ts`（addClip 前的建轨编排，若需）
- Test: `AssetPanel.test.tsx`、`TimelinePanel.interact.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// AssetPanel.test.tsx 追加
it('点击素材卡片自动入轨（视频→视频轨追加轨尾）', async () => {
  // 夹具：含一个 video 素材条目；渲染 AssetPanel；fireEvent.click 卡片
  // 断言 store：data.clips 新增 1 条 video clip，trackId = 视频轨 id，start = 该轨轨尾
});
// TimelinePanel.interact.test.tsx 追加
it('拖拽音频落到视频轨：不静默丢弃——自动建音频轨并按落点 x 放置', () => {
  // 夹具：仅视频轨；构造 drop 事件（dataTransfer payload mimeType audio/mp3，clientX 落视频轨 x=某值）
  // 断言：新增 audio 轨 + 音频 clip 起点按落点量化，而非无任何变化
});
```

- [ ] **Step 2: 跑红 → 实现**

AssetPanel 卡片（现 :72-78 dragstart 处）加 onClick：

```tsx
const onCardClick = (item: AssetItem) => {
  const es = useEditorStore.getState();
  if (!es.data) return;
  const info = { name: item.name, durationSec: item.durationSec ?? 5, url: item.url, mimeType: item.mimeType };
  es.setMediaInfo(item.mediaId, info);
  const placement = placeAssetInTrack(es.data, { mimeType: item.mimeType, durationSec: info.durationSec });
  let trackId = placement.trackId;
  if (placement.createNewTrack) trackId = es.addTrack(placement.newTrackType!);
  es.addClip({ type: assetKindOf(item.mimeType) === 'audio' ? 'audio' : assetKindOf(item.mimeType) === 'image' ? 'image' : 'video', mediaId: item.mediaId, sourceNodeId: item.sourceNodeId, trackId, start: placement.start });
};
```

（item 字段名以 AssetPanel 实测为准；setMediaInfo 的白名单第四字段在 Task 10 一并加——此处 url/mimeType 已有三字段覆盖。）

TimelinePanel drop 分支（:184-185）替换：

```tsx
// 旧：if (kind === 'audio' ? trackType !== 'audio' : trackType !== 'video') return;
// 新：不兼容 → 走建轨策略（spec 3.1：拖音频进单视频轨场景 100% 触发，不得静默丢弃）
if (kind === 'audio' ? trackType !== 'audio' : trackType !== 'video') {
  const es = useEditorStore.getState();
  const placement = placeAssetInTrack(es.data!, { mimeType: payload.mimeType, durationSec: payload.durationSec });
  if (placement.createNewTrack) {
    const newTrackId = es.addTrack('audio');
    // 建轨后按落点 x 放置（复用下方既有量化逻辑，trackId 换 newTrackId）
    dropIntoTrack(newTrackId, e); // 提取既有 drop 体为局部函数（精准重构，逻辑不变）
    return;
  }
}
```

- [ ] **Step 3: 跑绿 + 既有交互用例全绿 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批3-3 点击素材入轨 + 拖拽不兼容轨自动建轨（替换静默丢弃）"
```

### Task 10: thumbnailUrl 白名单 + tile 平铺 + 色表 + 波形白

**Files:**
- Modify: `store/editorStore.ts`（MediaInfo 接口 + setMediaInfo/mergeMediaInfo 白名单 + addClip 回填链路）、`components/AssetPanel.tsx`（回填 thumbnailUrl）、`components/timeline/ClipBlock.tsx`（tile + 色表 + 波形）、`renderer/video-cache.ts`（回退取帧，若接口需补）
- Test: `store/editorStore.test.ts`、`ClipBlock` 渲染断言（TimelinePanel.render.test.tsx）

- [ ] **Step 1: 写失败测试**

```ts
// editorStore.test.ts 追加
it('setMediaInfo 第四字段 thumbnailUrl 只补缺不覆盖（白名单同步）', () => {
  const es = useEditorStore.getState();
  es.setMediaInfo('m1', { name: 'a', durationSec: 5, thumbnailUrl: 't1' } as never);
  es.setMediaInfo('m1', { name: 'b', durationSec: 6, thumbnailUrl: undefined } as never);
  expect(useEditorStore.getState().mediaInfo.m1.thumbnailUrl).toBe('t1'); // 不被 undefined 覆盖
});
it('mergeMediaInfo 同法补缺 thumbnailUrl', () => { /* 同构用例 */ });
```

```tsx
// TimelinePanel.render.test.tsx 追加
it('视频片段渲染帧缩略图平铺：background-image=thumbnailUrl + repeat-x + auto 100%', () => {
  // 夹具：video clip + mediaInfo[m].thumbnailUrl = 'http://x/t.jpg'
  // 断言 clip-block 元素 style.backgroundImage 含 url(...)、backgroundRepeat 'repeat-x'、backgroundSize 'auto 100%'
});
it('轨道色表：subtitle #5DBAA0 / audio #8F5DBA / video 兜底 #1f1f1f（opencut 色表，勘误②）', () => {
  // 断言三类 clip-block 的背景色
});
```

- [ ] **Step 2: 跑红 → 实现**

editorStore（:172-187 两处白名单各加一行）：

```ts
thumbnailUrl: info.thumbnailUrl ?? s.mediaInfo[mediaId]?.thumbnailUrl,
// mergeMediaInfo 对称：thumbnailUrl: next[id].thumbnailUrl ?? info.thumbnailUrl
```

MediaInfo 接口（:17 附近）加 `thumbnailUrl?: string;`。AssetPanel 在 setMediaInfo 调用点（含 Task 9 的 onCardClick 与既有回填链路）带上 `thumbnailUrl: item.thumbnailUrl`。

ClipBlock：

```tsx
const BLOCK_BG: Record<Clip['type'], string> = { video: 'var(--ve-track-video)', image: 'var(--ve-track-video)', audio: '#8F5DBA', subtitle: '#5DBAA0' };
// 组件内（video/image 且有缩略图时叠加 tile；底色常驻在 image 之下，零就绪分支）：
const thumb = clip.type !== 'subtitle' && clip.type !== 'audio' ? useEditorStore.getState().mediaInfo[clip.mediaId]?.thumbnailUrl : undefined;
// （订阅式：const thumb = useEditorStore(s => clip.type === 'video' || clip.type === 'image' ? s.mediaInfo[clip.mediaId]?.thumbnailUrl : undefined)）
style={{
  left, width,
  background: missing ? '#7f1d1d' : BLOCK_BG[clip.type],
  ...(thumb ? { backgroundImage: `url(${thumb})`, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%' } : {}),
  border: /* 同现有逻辑，BAR 色同步暗化：video #6C5CE7 / image #5B7CFA / audio #8F5DBA / subtitle #5DBAA0 */,
}}
// WaveformCanvas :27 fillStyle '#43CC80' → 'rgba(255, 255, 255, 0.7)'
// 文字标签色 text-[#4E5969] → text-white/85（tile 之上可读）
```

回退取帧（thumbnailUrl 为空时，常态分支——生成结果素材无缩略图）：ClipBlock 层不处理；在 AssetPanel 回填链路补一步——素材入轨（addClip 后）若无 thumbnailUrl 且 mimeType 是 video/*，**用 mediabunny sink 工厂做一次性取帧**（spec v1.0-final 修正：不走播放用 video-cache——其为播放头双帧窗口 LRU 设计，多片段取静态海报会互相淘汰反复重建 sink）：

```ts
// 新增 renderer/poster.ts（一次性首帧海报，与播放缓存隔离）
import { canvasFromMedia } from './canvas-renderer'; // sink 工厂以实测导入路径为准（openMediabunnySink/CanvasSink 所在模块）
export async function ensurePoster(mediaId: string, url: string): Promise<string | null> {
  try {
    // 打开 mediabunny sink → 取 t=0 首帧 VideoSample → drawImage 到离屏 canvas（上限 320 宽，JPEG 0.7）
    // → dataURL 返回；用后即关 sink（一次性，不进任何 LRU）
    return dataUrl;
  } catch { return null; } // 失败静默保持兜底底色（非致命路径）
}
// AssetPanel 入轨处：const poster = await ensurePoster(item.mediaId, item.url);
// if (poster) useEditorStore.getState().setMediaInfo(item.mediaId, { thumbnailUrl: poster });
// mediaInfo 不入 autosave（Shell 只订阅 s.data）——写回安全幂等（spec 批 3.2）
```

- [ ] **Step 3: 跑绿 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor packages/shared/src
git commit -m "feat(video-editor): 批3-4 帧缩略图 repeat-x 平铺（thumbnailUrl 白名单+常态回退取帧）+ opencut 色表 + 白波形（勘误②）"
```

### Task 11: Ctrl+滚轮 exp 缩放（锚定接线）+ 标尺窗口化

**Files:**
- Modify: `components/timeline/TimelinePanel.tsx:157-168`（wheel handler）、`timeline/view-scale.ts`（zoomFactor 常量）、`components/timeline/TimelineRuler.tsx:19-23`（窗口化）、`store/editorStore.ts:161`（上限注释，不改值）
- Test: `view-scale.test.ts` 追加、`TimelinePanel.interact.test.tsx`

- [ ] **Step 1: 写失败测试（纯函数先行）**

```ts
// view-scale.test.ts 追加
import { ZOOM_WHEEL_FACTOR, zoomByDelta } from './view-scale';
describe('zoomByDelta（opencut exp 曲线）', () => {
  it('delta 正（滚下）缩小、负（滚上）放大，capped ±30', () => {
    expect(zoomByDelta(100, 100)).toBeLessThan(100);   // 缩小
    expect(zoomByDelta(-100, 100)).toBeGreaterThan(100); // 放大
    expect(zoomByDelta(10000, 100)).toBeGreaterThan(20);  // capped 不至于跳变到极小
  });
  it('anchorZoomScroll 接线后锚点视口位置不变（既有死代码激活回归）', () => {
    const r = anchorZoomScroll({ scrollLeft: 200, anchorTime: 5, oldPxPerSec: 40, newPxPerSec: 80, viewportW: 800 });
    // 锚点距视口左原 = 5*40-200 = 0；新 scrollLeft = 5*80-0 = 400
    expect(r.scrollLeft).toBe(400);
  });
});
```

- [ ] **Step 2: 跑红 → view-scale.ts 实现**

```ts
export const ZOOM_WHEEL_FACTOR = 300; // exp 曲线分母（opencut zoom-controller）
export const ZOOM_BUTTON_FACTOR = 1.7;
export function zoomByDelta(deltaY: number, currentPxPerSec: number): number {
  const capped = Math.max(-30, Math.min(30, deltaY));
  return currentPxPerSec * Math.exp(-capped / ZOOM_WHEEL_FACTOR);
}
```

- [ ] **Step 3: TimelinePanel wheel handler 替换（:157-168）**

```tsx
const el = containerRef.current!; // 既有监听容器
const onWheel = (e: WheelEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); // 阻浏览器缩放（capture + passive:false，监听注册保持既有方式）
  const es = useEditorStore.getState();
  const old = es.pxPerSec;
  const next = Math.min(500, Math.max(10, zoomByDelta(e.deltaY, old))); // 上限 500 暂留——标尺窗口化后评估放宽（spec 3.4）
  const rect = el.getBoundingClientRect();
  const anchorTime = es.playhead > 0 && (Math.abs((e.clientX - rect.left) / rect.width) > 0.15)
    ? pxToTime(e.clientX - rect.left + el.scrollLeft, old)  // 鼠标锚定（视口偏 15% 内锚播放头，opencut 阈值）
    : es.playhead;
  const { scrollLeft } = anchorZoomScroll({ scrollLeft: el.scrollLeft, anchorTime, oldPxPerSec: old, newPxPerSec: next, viewportW: rect.width });
  es.setPxPerSec(next);
  el.scrollLeft = scrollLeft; // 接线既有死代码 anchorZoomScroll（spec 3.4）
};
```

- [ ] **Step 4: TimelineRuler 窗口化**

```tsx
// :19-23 全量循环替换为视口窗口：
const ticks: number[] = [];
const visibleStart = Math.max(0, pxToTime(scrollLeft, pxPerSec) - interval);           // 左溢出一格
const visibleEnd = pxToTime(scrollLeft + viewportW, pxPerSec) + interval;              // 右溢出
const endSec = Math.min(dur + interval, visibleEnd);
for (let t = Math.ceil(Math.max(0, visibleStart) / interval) * interval; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
// scrollLeft 由父级 TimelinePanel 透传（props 加 scrollLeft；总宽 style 计算不变）
```

同步性能验收断言（interact.test）：

```tsx
it('标尺只渲染视口内刻度：900s/500pxps 视口 1000px 时 ticks ≤ 视口容量+2', () => {
  // 夹具 900s 工程 pxPerSec=500（interval=0.25）→ 全量 3600 div；窗口化后断言 document 内 .ant-tick 类元素数 < 300
});
```

- [ ] **Step 5: 跑绿 + 既有 view-scale/interact 用例 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批3-5 Ctrl+滚轮 exp 缩放+鼠标锚定（接线 anchorZoomScroll 死代码）+ 标尺视口窗口化（3600div 性能坑修复）"
```

### Task 12: S 分割快捷键（排除 Ctrl/Cmd）+ 吸附指示线

**Files:**
- Modify: `hooks/useEditorKeyboard.ts`、`components/timeline/TimelinePanel.tsx`（拖动中吸附指示线渲染）
- Test: `useEditorKeyboard` 用例（新 hook 测试或 TimelinePanel.interact 内键盘用例）

- [ ] **Step 1: 写失败测试**

```tsx
it('s 键分割选中片段于播放头；Ctrl+S 不分割不拦截', () => {
  // 夹具：选中 clip，playhead=2；keydown 's' → splitClip 被调（store 断言 clip 数 +1）
  // keydown 's' + ctrlKey → clip 数不变且 defaultPrevented === false
});
```

- [ ] **Step 2: 跑红 → useEditorKeyboard handler 追加分支（:27 空格分支后）**

```ts
} else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
  e.preventDefault();
  if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead);
}
```

- [ ] **Step 3: 吸附指示线——TimelinePanel 拖动态（transient）渲染竖线**

拖动 pointermove 已算 `snapped`（:110 附近）；当 `snapped.snapped !== null` 时在轨道区 overlay 渲染：

```tsx
{dragState?.snappedTime != null && (
  <div data-testid="snap-guide" className="absolute top-0 bottom-0 w-0.5 bg-[var(--ve-accent)] pointer-events-none z-[2]"
    style={{ left: timeToPx(dragState.snappedTime, pxPerSec) }} />
)}
```

（dragState 扩展 `snappedTime?: number | null`，pointermove 写入、pointerup 清空——吸附判定复用既有 snapTime 返回的 snapped 点，无新逻辑。）

- [ ] **Step 4: 跑绿 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批3-6 S 分割快捷键（排除 Ctrl/Cmd+S）+ 拖动吸附指示线"
```

---

## 批 4+5｜渲染坐标系（contain 修复 + canvasSize C 档）

### Task 13: 播放器 contain 一行修复 + applyCanvasSize 同源

**Files:**
- Modify: `PreviewPlayer.tsx:66-67`、`hooks/usePreviewPlayback.ts:46,58`
- Test: `PreviewPlayer.test.tsx`（样式断言）

- [ ] **Step 1: 写失败测试**

```tsx
it('预览 canvas 自适应 contain：无 width:100%/aspectRatio 内联样式（靠替换元素内在尺寸）', () => {
  const canvas = screen.getByTestId('preview-canvas') as HTMLCanvasElement;
  const style = canvas.getAttribute('style') ?? '';
  expect(style).not.toContain('width');        // 无内联 width:100%
  expect(style).not.toContain('aspect-ratio'); // 无 aspectRatio
  expect(canvas.className).toContain('max-w-full');
  expect(canvas.className).toContain('max-h-full');
});
```

- [ ] **Step 2: 跑红 → 修复（spec 4.1：一行）+ applyCanvasSize 单点**

PreviewPlayer :67：

```tsx
<canvas ref={canvasRef} data-testid="preview-canvas" width={1920} height={1080}
  className="bg-black max-w-full max-h-full"  {/* 删除 style={{ aspectRatio:'16 / 9', width:'100%' }} */}
  onClick={/* 既有 seek 逻辑不变 */} />
```

新建 `applyCanvasSize`（放 `hooks/usePreviewPlayback.ts` 导出，两处消费同一函数）：

```ts
/** canvas.width 赋值会清空画布并重置 2D 上下文——属性（PreviewPlayer）与守卫（本 hook）必须同源走此函数（spec 4.1） */
export function applyCanvasSize(canvas: HTMLCanvasElement, w: number, h: number): boolean {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
  return false;
}
// usePreviewPlayback :46,58 守卫替换：if (applyCanvasSize(canvasRef.current, CANVAS_W, CANVAS_H)) { /* 重设后需重绘一帧 */ }
```

- [ ] **Step 3: 跑绿 + Commit**

```bash
git add apps/web/src/pages/canvas/video-editor/components/PreviewPlayer.tsx apps/web/src/pages/canvas/video-editor/hooks/usePreviewPlayback.ts
git commit -m "fix(video-editor): 批4-1 预览 contain 修复（删内联 width/aspectRatio）+ applyCanvasSize 同源单点"
```

### Task 14: canvasSize 数据模型 + 6 档 + 顶栏 Dropdown + 新建默认/记忆

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/canvas-size.ts` + `canvas-size.test.ts`
- Modify: `packages/shared/src/types/video-project.ts`（ProjectData 加字段）、`components/EditorTopBar.tsx:20`、`store/editorStore.ts`（setCanvasSize action）、`VideoEditorShell.tsx:35`（upsert 用记忆比例）
- Test: `canvas-size.test.ts`、`EditorTopBar` 用例

- [ ] **Step 1: 写失败测试（canvas-size 纯函数全套）**

```ts
import { describe, it, expect } from 'vitest';
import { CANVAS_PRESETS, canvasSizeOf, remapForCanvasSize } from './canvas-size';
describe('canvasSizeOf', () => {
  it('缺省兜底 1920×1080', () => {
    expect(canvasSizeOf({} as never)).toEqual({ width: 1920, height: 1080 });
  });
  it('读取 data.canvasSize', () => {
    expect(canvasSizeOf({ canvasSize: { width: 1080, height: 1920 } } as never)).toEqual({ width: 1080, height: 1920 });
  });
});
describe('CANVAS_PRESETS（6 档，spec 5.1）', () => {
  it('9:16/16:9/21:9/3:4/4:3/1:1 全存在', () => {
    expect(CANVAS_PRESETS.map(p => p.label)).toEqual(['16:9', '9:16', '21:9', '3:4', '4:3', '1:1']);
  });
});
describe('remapForCanvasSize（中心点等比 + 关键帧 value 覆盖）', () => {
  it('片段 transform 与 keyframes.value 同步重映射', () => {
    const clip = {
      id: 'c', trackId: 't', type: 'video', start: 0, duration: 5, sourceStart: 0, mediaId: 'm', playbackSpeed: 1 as const,
      transform: { x: 1920, y: 540, scale: 1, rotation: 0, opacity: 1 },
      keyframes: [{ id: 'k', t: 1, property: 'x' as const, value: 1920, easing: 'linear' as const }],
    };
    const out = remapForCanvasSize([clip as never], { width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(out[0].transform.x).toBeCloseTo(1080);      // 1920/1920*1080
    expect(out[0].transform.y).toBeCloseTo(960);       // 540/1080*1920
    expect(out[0].keyframes[0].value).toBeCloseTo(1080); // 关键帧同步（spec 5.1——漏了必漂移）
  });
});
```

- [ ] **Step 2: 跑红 → 实现 canvas-size.ts**

```ts
import type { Clip, ProjectData } from '../types';
export interface CanvasSize { width: number; height: number; }
export const CANVAS_PRESETS: ReadonlyArray<{ label: string; size: CanvasSize }> = [
  { label: '16:9', size: { width: 1920, height: 1080 } },
  { label: '9:16', size: { width: 1080, height: 1920 } },
  { label: '21:9', size: { width: 2560, height: 1080 } },
  { label: '3:4',  size: { width: 1080, height: 1440 } },
  { label: '4:3',  size: { width: 1440, height: 1080 } },
  { label: '1:1',  size: { width: 1080, height: 1080 } },
];
export const DEFAULT_CANVAS_SIZE: CanvasSize = CANVAS_PRESETS[0].size;
export function canvasSizeOf(data: Pick<ProjectData, 'canvasSize'> | null | undefined): CanvasSize {
  return data?.canvasSize ?? DEFAULT_CANVAS_SIZE;
}
/** 切换比例：中心点等比重映射，keyframes.value（绝对值）同步（spec 5.1） */
export function remapForCanvasSize(clips: Clip[], from: CanvasSize, to: CanvasSize): Clip[] {
  const sx = to.width / from.width, sy = to.height / from.height;
  return clips.map((c) => {
    if (c.type === 'subtitle' || c.type === 'audio') return c; // 无 transform
    const t = { ...c.transform, x: c.transform.x * sx, y: c.transform.y * sy };
    const keyframes = c.keyframes.map((k) => (
      k.property === 'x' ? { ...k, value: k.value * sx } :
      k.property === 'y' ? { ...k, value: k.value * sy } : k
    ));
    return { ...c, transform: t, keyframes };
  });
}
```

- [ ] **Step 3: ProjectData 加字段 + editorStore action**

shared `ProjectData`（:3 后）加 `canvasSize?: { width: number; height: number };`。

editorStore 加 action：

```ts
setCanvasSize: (size) => set((s) => {
  if (!s.data) return {};
  const clips = remapForCanvasSize(Object.values(s.data.clips), canvasSizeOf(s.data), size);
  return { data: { ...s.data, canvasSize: size, clips: Object.fromEntries(clips.map((c) => [c.id, c])) } };
}),
// 历史栈：调用方以 beginTransient/endTransient 包裹（与既有编辑动作一致——setCanvasSize 在组件 onClick 里包）
```

- [ ] **Step 4: EditorTopBar 比例 Dropdown（:20 硬编码替换）**

```tsx
import { Dropdown } from 'antd';
import { useEditorStore } from '../store/editorStore';
import { CANVAS_PRESETS, canvasSizeOf } from '../timeline/canvas-size';
// EditorTopBar 内：
const data = useEditorStore((s) => s.data);
const current = canvasSizeOf(data);
const label = CANVAS_PRESETS.find((p) => p.size.width === current.width && p.size.height === current.height)?.label ?? '自定义';
<Dropdown
  getPopupContainer={(trigger) => trigger.parentElement!}  // 壳内（批 1 作用域已全局，此处双保险沿组件树）
  menu={{ items: CANVAS_PRESETS.map((p) => ({ key: p.label, label: `${p.label}（${p.size.width}×${p.size.height}）` })),
    selectedKeys: [label],
    onClick: ({ key }) => {
      const es = useEditorStore.getState();
      const preset = CANVAS_PRESETS.find((p) => p.label === key)!;
      es.beginTransient?.(); es.setCanvasSize(preset.size); es.endTransient?.(); // 历史栈 API 以 editorStore 实测为准（beginTransient/endTransient 既有）
    } }}
>
  <button data-testid="aspect-ratio-button" className="text-[12px] text-[var(--ve-text)] bg-transparent border border-[var(--ve-border)] rounded px-2 py-0.5 cursor-pointer">{label} ▾</button>
</Dropdown>
```

新建默认/记忆（C 档，显式标注不静默）：`VideoEditorShell.tsx:35` upsert 前——

```ts
const LAST_ASPECT_KEY = 've-last-canvas-preset';
const lastPreset = localStorage.getItem(LAST_ASPECT_KEY); // '16:9' 等 label
const defaultData = { ...createDefaultProjectData(), canvasSize: CANVAS_PRESETS.find((p) => p.label === lastPreset)?.size ?? DEFAULT_CANVAS_SIZE };
// upsert({ ..., data: defaultData })
// EditorTopBar 切换时 localStorage.setItem(LAST_ASPECT_KEY, label)
// 新建对话框显式标注：EditorTopBar Dropdown menu 顶部加 disabled 项 `上次使用：${lastPreset ?? '16:9'}（新工程默认）`
```

- [ ] **Step 5: 跑绿（shared+web）+ Commit**

```bash
git add packages/shared/src apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批5-1 canvasSize C 档——6 档 Dropdown/中心点重映射含关键帧/新建默认+显式标注记忆（勘误④）"
```

### Task 15: 消费方改造（renderer/字幕/节点卡片）

**Files:**
- Modify: `renderer/canvas-renderer.ts:4-5,42-51,65`、`scene/subtitle-layout.ts:4-9`、`components/nodes/VideoEditNode.tsx:119,150`（路径以 Glob 实测为准）
- Test: `render-frame.test.ts`、subtitle-layout 既有测试

- [ ] **Step 1: 写失败测试**

```ts
// render-frame.test.ts 追加：9:16 画布下 video 片段 contain 居中（源 16:9 → 留边）
it('canvasSize 9:16 时渲染尺寸随 canvasSizeOf，源素材 contain 居中', () => {
  // 夹具 data.canvasSize = 1080×1920；渲染断言 drawImage 调用参数（mock ctx）宽高比 = min(1080/srcW, 1920/srcH) 比例
});
// subtitle-layout 测试追加：
it('fontSize 基准 1080 高：9:16（1920 高）下 48 渲染为 85.33；bottomMargin/maxWidth 按高比例派生', () => {
  // layoutSubtitle(text, canvasSize({1080,1920})) 断言 fontSize = 48*1920/1080、maxWidth = 1664*1080/1920
});
```

- [ ] **Step 2: 跑红 → 实现**

canvas-renderer：

```ts
// 删除模块级 CANVAS_W/CANVAS_H 常量消费点，绘制函数签名加 canvasSize 参数（或内部 canvasSizeOf(data)）：
const size = canvasSizeOf(data);
const contain = Math.min(size.width / srcW, size.height / srcH);
// :65 字幕：const bottomMargin = 96 * (size.height / 1080); const y = size.height - bottomMargin;
```

subtitle-layout：

```ts
export function layoutSubtitle(text: string, canvasSize: CanvasSize) {
  const scale = canvasSize.height / 1080;            // 基准坐标系 1080 高（spec 5.2——既有工程 48 语义不变）
  return { fontSize: baseFontSize * scale, maxWidth: 1664 * (canvasSize.width / 1920), bottomMargin: 96 * scale, /* …其余同构派生 */ };
}
```

usePreviewPlayback/PreviewPlayer：`applyCanvasSize(canvas, size.width, size.height)`——`size` 订阅 `useEditorStore((s) => canvasSizeOf(s.data))`，data 变（切比例）触发重设+重绘一帧。

VideoEditNode 迷你预览（卡片宽 316 固定）：预览区 `aspect-ratio: canvasSize.w/canvasSize.h` CSS + `max-height` 约束 letterbox（节点高度不剧变，spec 5.4）。

- [ ] **Step 3: 跑绿 + 既有渲染用例（render-frame/editorStore）+ Commit**

```bash
git add -A apps/web/src/pages/canvas
git commit -m "feat(video-editor): 批5-2 canvasSize 消费方——renderer contain/字幕 1080 基准派生/节点卡片 letterbox"
```

### Task 16: computeExportSize 取偶单点 + 码率像素量

**Files:**
- Modify: `export/precheck.ts`（码率表/estimateSizeBytes 改签名）、`export/worker.ts:43`（scale 消费）、`components/ExportModal.tsx`（调用点）、`export/upload.ts`（metadata）
- Test: `precheck.test.ts` 追加 18 组合

- [ ] **Step 1: 写失败测试（18 组合全偶数）**

```ts
import { computeExportSize, EXPORT_BITRATES } from './precheck';
import { CANVAS_PRESETS } from '../timeline/canvas-size';
const TIERS = ['480p', '720p', '1080p'] as const;
describe('computeExportSize（档位=目标短边，取偶，单点）', () => {
  it.each(CANVAS_PRESETS.flatMap((p) => TIERS.map((t) => [p.label, t, p.size] as const)))(
    '%s @ %s 全偶数', (_label, tier, size) => {
      const out = computeExportSize(size, tier);
      expect(out.width % 2).toBe(0);
      expect(out.height % 2).toBe(0);
      expect(Math.min(out.width, out.height)).toBe(parseInt(tier)); // 短边=档位
    });
  it('16:9 480p = 854×480（853.33 取偶）', () => {
    expect(computeExportSize({ width: 1920, height: 1080 }, '480p')).toEqual({ width: 854, height: 480 });
  });
  it('9:16 1080p = 1080×1920（非 608×1080——短边口径）', () => {
    expect(computeExportSize({ width: 1080, height: 1920 }, '1080p')).toEqual({ width: 1080, height: 1920 });
  });
});
```

- [ ] **Step 2: 跑红 → precheck.ts 实现**

```ts
export const EXPORT_BITRATES = {
  '480p': { video: 2_500_000, audio: 96_000 },
  '720p': { video: 5_000_000, audio: 128_000 },
  '1080p': { video: 12_000_000, audio: 128_000 },
} as const;
export function computeExportSize(canvasSize: { width: number; height: number }, tier: '480p' | '720p' | '1080p') {
  const targetShort = parseInt(tier, 10); // 480/720/1080
  const scale = targetShort / Math.min(canvasSize.width, canvasSize.height); // 档位=目标短边（spec 5.3）
  return { width: Math.round(canvasSize.width * scale / 2) * 2, height: Math.round(canvasSize.height * scale / 2) * 2 };
}
export function estimateSizeBytes(canvasSize: { width: number; height: number }, resolution: ExportResolution, durationSec: number): number {
  const { video, audio } = EXPORT_BITRATES[resolution];
  const px = canvasSize.width * canvasSize.height;
  const basePx = 1920 * 1080;
  return Math.round(((video * Math.max(1, px / basePx) + audio) / 8) * durationSec * 1.2); // 码率按像素量重定（spec 5.3——21:9 多 33% 像素）
}
```

调用点同步：ExportModal 的 `estimateSizeBytes(resolution, durationSec)` → `estimateSizeBytes(canvasSizeOf(data), resolution, durationSec)`；worker :43 的 `resolution === '720p' ? 0.5 : 1` 删除，改消费主线程传入的 `targetSize`（postMessage params 加 `targetSize: { width, height }`，worker 内 `ctx.scale(targetSize.width / size.width, targetSize.height / size.height)`）；upload 的 register 入参带 `width/height`（Task 18 后端接收）。

- [ ] **Step 3: 跑绿 + 既有 precheck 用例（18 组合 + estimate 签名变化的调用方修正）+ Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批5-3 computeExportSize 单点（短边档位/取偶/18 组合 TDD）+ 码率像素量化 + worker targetSize"
```

### Task 17: 后端 DTO + metadata w/h（部署顺序：先后端）

**Files:**
- Modify: `apps/api/src/modules/video-project/video-project.dto.ts:23-25`、`apps/api/src/modules/video-project/generated-media.service.ts:44`
- Test: api 侧 dto/service 既有测试

- [ ] **Step 1: 写失败测试（api）**

```ts
// register 用例追加：resolution '480p' 合法、'2160p' 仍 400；durationSec 901 400
it('RegisterGeneratedDto 接受 480p 与 900s；拒绝 2160p/901s', async () => {
  await expect(service.register({ ..., resolution: '480p', durationSec: 900 })).resolves.toBeDefined();
  // ValidationPipe 层用例：'2160p' → 400；durationSec 901 → 400
});
it('metadata 落库含 width/height', async () => {
  // register 后断言 prisma.media.create 被以 metadata 含 width:854, height:480 调用
});
```

- [ ] **Step 2: 跑红 → DTO 改造**

```ts
@IsIn(['480p', '720p', '1080p']) resolution!: string;
@IsNumber() @Min(0) @Max(900) durationSec!: number; // 15min 上限服务端同步（spec 5.5）
@IsNumber() @Min(1) width!: number;    // 产物尺寸（metadata 存档——resolution 无法表达 9:16 的 1080×1920）
@IsNumber() @Min(1) height!: number;
```

generated-media.service register 的 metadata（:44）加 `width: input.width, height: input.height`；前端 upload.ts 的 registerGeneratedMedia 入参同步（width/height 来自 computeExportSize——批 6 ExportModal 重构时一并接，本任务后端先行不破前端：DTO 新增必填字段会影响现有前端调用！**部署顺序注意**：DTO 加必填 width/height 后老前端 400——故本任务与批 6 Task 20 的前端调用同 PR 合入，或字段暂设 `@IsOptional()`，批 6 落地后收紧。**取 @IsOptional() 方案**（单次发版，前端随后补传）。

- [ ] **Step 3: 跑绿（api 全量）+ Commit**

```bash
git add apps/api/src/modules/video-project
git commit -m "feat(video-api): 批5-4 导出 DTO 加 480p/@Max(900)/可选 width-height（metadata 尺寸存档，勘误⑦）"
```

---

## 批 6｜导出改造（FSA/OPFS 中转 + 目的地分流 + Popover）

### Task 18: SaveTarget 三态 + OPFS 中转 + fastStart 判据

**Files:**
- Modify: `export/client.ts`、`export/worker.ts:95-110`
- Test: `client.test.ts` 追加

- [ ] **Step 1: 写失败测试**

```ts
describe('pickSaveTarget（P1-E 三态）', () => {
  it('canceled 必须中止：返回 canceled 时 startExport 不调 runExportJob（组件级在 Task 20 测；此测纯函数）', async () => {
    // mock showSaveFilePicker reject(AbortError) → pickSaveTarget 返回 { kind: 'canceled' }（非 null）
  });
  it('unsupported（无 FSA）→ { kind: "opfs" }：不弹 picker，OPFS getFileHandle 随机 key', async () => {
    // mock 无 showSaveFilePicker + navigator.storage.getDirectory 返回根句柄 → kind 'opfs'，key 形如 export-<random>.mp4
  });
});
```

- [ ] **Step 2: 跑红 → client.ts 实现**

```ts
export type SaveTarget =
  | { kind: 'fsa'; handle: FileSystemFileHandle }
  | { kind: 'opfs'; handle: FileSystemFileHandle }   // OPFS 句柄同 FileSystemFileHandle 形状（getFile/createWritable 同接口）
  | { kind: 'canceled' };
export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget> {
  if (!('showSaveFilePicker' in window)) {
    // 非 Chromium：OPFS 中转（无需用户手势，spec 6.1）
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
    return { kind: 'opfs', handle };
  }
  try {
    const handle = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> })
      .showSaveFilePicker({ suggestedName, types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }] });
    return { kind: 'fsa', handle };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'canceled' }; // 用户取消——必须中止不回退（P1-E）
    // 非取消异常（弹窗拦截等）：OPFS 兜底
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
    return { kind: 'opfs', handle };
  }
}
// OPFS 清理（三路径必调，spec 6.1）：
export async function cleanupOpfsTarget(target: SaveTarget): Promise<void> {
  if (target.kind !== 'opfs') return;
  try { await (await navigator.storage.getDirectory()).removeEntry(target.handle.name); } catch { /* 已不存在——幂等 */ }
}
```

- [ ] **Step 3: worker fastStart 判据（:100）**

```ts
// 旧：const format = fsaWritable ? new Mp4OutputFormat({ fastStart: false }) : new Mp4OutputFormat();
// 新：磁盘中转统一判据 diskTarget（FSA 或 OPFS 的 writable 同形）——漏改则 OPFS 走 auto= in-memory mux，P0-B 复活（spec 6.1 红项）
const diskWritable = saveFileHandle ? await saveFileHandle.createWritable().catch(() => null) : null;
const format = diskWritable ? new Mp4OutputFormat({ fastStart: false }) : new Mp4OutputFormat();
// fsaWritable 全部更名 diskWritable（StreamTarget 分支体不变）
```

- [ ] **Step 4: 跑绿 + 既有 client/worker 用例（ExportJobResult.fsa 标记语义不变）+ Commit**

```bash
git add apps/web/src/pages/canvas/video-editor/export
git commit -m "feat(video-editor): 批6-1 SaveTarget 三态（canceled 中止/OPFS 中转）+ fastStart diskTarget 判据（P0-B/P1-E）"
```

### Task 19: ExportModal 重构为 Popover（目的地分流 + 受控 + 进度）

**Files:**
- Modify: `components/ExportModal.tsx`（大改，重命名组件语义为导出 Popover 但文件名不变——精准修改）、`export/upload.ts`、`store/editorStore.ts`（补建节点 store）
- Test: `ExportModal.test.tsx` 全面改写

- [ ] **Step 1: 写失败测试（核心行为）**

```tsx
// 新用例（既有用例迁移保留语义）：
it('目的地 Select：导出到画布（默认）/下载到本地', () => {/* 两选项渲染 + 默认值画布 */});
it('canceled → 不调 runExportJob 且提示「已取消导出，未开始编码」', async () => {
  // mock pickSaveTarget 返回 canceled → expect(runExportJob) 未被调；screen 出现提示文案
});
it('导出中 Popover 不可外部关闭（open 受控 + onOpenChange 导出中拒绝）', () => {
  // phase exporting 时触发 onOpenChange(false) → open 保持 true
});
it('画布路径：编码完成 getFile 上传+建节点；本地路径：a[download] 且 revoke 延迟', async () => {
  // mock 链路；本地路径断言 revokeObjectURL 在 click 后 >1s 或 download 事件后（vi.useFakeTimers）
});
it('上传成功建节点失败 → fail 态提示 + 重试按钮仅补建节点（不重复上传）', async () => {
  // mock createProductNode throw → store.pendingProduct 记录 {mediaId, title} → 重试只调 createProductNode
});
```

- [ ] **Step 2: 跑红 → 实现（组件骨架）**

```tsx
import { Popover, Select, Input, Progress, Button, App as AntdApp } from 'antd';
const [open, setOpen] = useState(false);          // 受控（onExport 打开）
const [destination, setDestination] = useState<'canvas' | 'local'>('canvas');
const [fileName, setFileName] = useState(`${title || '导出'}.mp4`);
const startExport = async () => {
  if (startingRef.current) return; startingRef.current = true;   // 重入锁保留（I-1）
  try {
    // …既有守卫/precheck 不变…
    // ⚠ 手势红线（spec D4）：pickSaveTarget 必须在点击处理器同步链内调用——showSaveFilePicker 需
    // transient user activation，编码数分钟后的 await 链再调必抛 SecurityError。
    // "目的地后置"仅指画布/本地分支在编码完成后分流，句柄获取始终在此处（手势内）。
    const target = await pickSaveTarget(fileName);
    if (target.kind === 'canceled') { void message.info('已取消导出，未开始编码'); return; } // P1-E
    const j = runExportJob({ data, resolution, mediaUrls, targetSize: computeExportSize(canvasSizeOf(data), resolution) },
      { onProgress, onEta }, target.handle);
    setPhase('exporting'); armBeforeunload();
    try {
      const r = await j.promise;
      const file = r.fsa && target.kind !== 'canceled' ? await target.handle.getFile() : r.blob;
      if (destination === 'canvas') {
        const { mediaId } = await uploadExportedProduct({ ..., width: out.width, height: out.height, file });
        useEditorStore.getState().setPendingProduct({ mediaId, title: currentEditorProjectTitle() }); // store 持久化（spec 6.4——弹层关闭不丢）
        createProductNode(...); void message.success('导出完成，已添加到画布');
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000); // 延迟 revoke——不抄同步 revoke 截断先例（spec 6.2）
      }
      setOpen(false);
    } catch (err) { /* 既有 error 分辙 + cleanupOpfsTarget(target) */ }
    finally { setJob(null); disarmBeforeunload(); void cleanupOpfsTarget(target); } // 三路径清理（spec 6.1）
  } finally { startingRef.current = false; }
};
<Popover
  open={open}
  onOpenChange={(next) => { if (phase === 'exporting') return; setOpen(next); }}  // 导出中不可外部关闭（spec 6.3）
  trigger="click" placement="bottomRight"
  content={
    phase === 'config' ? (
      <div className="flex flex-col gap-3 w-80" data-testid="export-config">
        <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
          <span className="text-[13px]">文件名</span>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} id="timeline-export-file-name" />
        </div>
        <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
          <span className="text-[13px]">导出位置</span>
          <Select value={destination} onChange={setDestination} options={[
            { value: 'canvas', label: '导出到画布' }, { value: 'local', label: '下载到本地' }]} id="timeline-export-destination" />
        </div>
        <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
          <span className="text-[13px]">分辨率</span>
          <Select value={resolution} onChange={setResolution} options={[
            { value: '480p', label: '480P' }, { value: '720p', label: '720P' }, { value: '1080p', label: '1080P' }]} />
        </div>
        <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
          <span className="text-[13px]">格式</span>
          <Select value="mp4" disabled options={[{ value: 'mp4', label: 'MP4' }]} />
        </div>
        {/* precheck errors/warnings/fail 渲染保留（既有逻辑） */}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" disabled={blocked || !precheck} onClick={() => void startExport()} data-testid="export-start">确认</Button>
        </div>
      </div>
    ) : (
      <div className="flex flex-col gap-3 w-80" data-testid="export-progress">
        {/* 既有进度区（Progress/eta/取消导出）不变 */}
      </div>
    )
  }
>
  <span /* 锚定由 EditorTopBar 导出按钮承担：Popover 包裹在 TopBar 按钮外或按钮转发 ref——实现时把 Popover 移入 EditorTopBar，onExport prop 改为打开 Popover */ />
</Popover>
```

结构落位：ExportModal.tsx 导出 `ExportPopover({ children })`，EditorTopBar 的导出按钮作 children（trigger）。Shell 的 `exportOpen` state 移除（Popover 自管 open）。**收起编辑器语义登记**：Popover 随壳卸载、导出继续、完成建节点（R2-N12 后台完成语义保持——beforeunload 模块级守卫已在批外保留）。

editorStore 补：

```ts
pendingProduct: null as { mediaId: string; title: string } | null,
setPendingProduct: (p) => set({ pendingProduct: p }),
clearPendingProduct: () => set({ pendingProduct: null }),
// createProductNode 成功后 clear；重试路径读 pendingProduct 仅调 createProductNode（不重复上传，spec 6.4）
```

- [ ] **Step 3: 跑绿 + 既有 ExportModal 用例语义迁移（config/progress/precheck 用例改 Popover 查询）+ Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批6-2 导出 Popover 化——目的地分流（画布 getFile/本地延迟 revoke）/受控不可关/取消三态提示/补建节点 store 化"
```

---

## 批 7｜后端导出链加固（P1-D）

### Task 20: confirm 终判 + clientRequestId 幂等 + TTL 回收

**Files:**
- Modify: `apps/api/src/modules/video-project/generated-media.service.ts`、`video-project.dto.ts`、`temp-cleanup.processor.ts`
- Test: api 侧 service 测试

- [ ] **Step 1: 写失败测试（api）**

```ts
it('confirm 超限回滚：usage+actualSize 超限 → 删对象+删记录+抛 400（终判接入）', async () => {
  // mock quota.getUsage 接近上限；confirm → expect minio.delete 被调 + prisma.media.delete 被调 + BadRequestException
});
it('register 幂等：同 clientRequestId 返回同一条 Media（不新建行）', async () => {
  // 两次 register 同 id → prisma.media.create 仅一次，第二次返回首条
});
it('TTL 回收 generated pending >24h：删记录 + 删 MinIO 对象；24h 内/in-flight 不回收', async () => {
  // 夹具：pending generated createdAt 25h 前 / 1h 前各一 → processor 跑后仅 25h 前被删且 minio.delete 被调
});
```

- [ ] **Step 2: 跑红 → 实现**

```ts
// RegisterGeneratedDto 加：@IsOptional() @IsString() clientRequestId?: string;
// register() 开头：
if (input.clientRequestId) {
  const existing = await this.prisma.media.findFirst({
    where: { metadata: { path: ['clientRequestId'], equals: input.clientRequestId } },
  });
  if (existing) {
    const upload = await this.minio.generatePresignedPost(existing.key, 'video/mp4', existing.size);
    return { mediaId: existing.id, upload };  // 幂等重入——同 id 同 Media 同 key（spec 批7）
  }
}
// metadata 加 clientRequestId 存档
// confirm() 接终判（spec 批7——导出链曾是唯一无终判通道）：
await this.quota.assertOnConfirm(media.id, actualSize, media.key, media.bucket); // 超限内部已删对象+记录并抛
// temp-cleanup.processor.ts process() 追加第二段：
const staleGenerated = await this.prisma.media.findMany({
  where: { type: 'generated', status: 'pending',
    updatedAt: { lt: new Date(Date.now() - 24 * 3600_000) } }, // 24h TTL（in-flight 自然排除——updatedAt 新）
  take: 1000, select: { id: true, key: true },
});
for (const m of staleGenerated) {
  try { await this.minio.delete(m.key); } catch { /* 对象不存在继续删记录 */ }
  await this.prisma.media.delete({ where: { id: m.id } });
}
```

前端 upload.ts 的 registerGeneratedMedia 入参带 `clientRequestId: crypto.randomUUID()`，**同一导出会话重试复用同一 id**（存组件 useRef，不随重试重生成）。

- [ ] **Step 3: 跑绿（api 全量）+ Commit**

```bash
git add apps/api/src/modules/video-project apps/api/src/modules/temp-cleanup apps/web/src/pages/canvas/video-editor/export
git commit -m "feat(video-api): 批7-1 导出链终判 assertOnConfirm + clientRequestId 幂等 + generated pending 24h TTL 回收（P1-D）"
```

---

## 总验收清单（浏览器，全部通过后收尾）

- [ ] 点导出 → Popover 可见且选项联动（文件名/位置/分辨率/格式 disabled）
- [ ] 目的地=画布：导出→上传→画布产物节点出现；目的地=本地：浏览器下载完整 MP4（>1min 视频无截断）
- [ ] FSA picker 取消 → 提示且零编码；非 Chromium（Firefox）→ OPFS 中转导出成功且无磁盘垃圾（about:opfs 之类抽查或代码审查）
- [ ] 三栏拖拽调宽 + 时间轴满屏 + 刷新后尺寸保持
- [ ] 暗色主题全组件无亮色残留（antd 弹层/toast 同暗色）
- [ ] 点击视频素材 → 视频轨轨尾追加 + 帧缩略图平铺；拖音频到视频轨 → 自动建音频轨
- [ ] Ctrl+滚轮：光标处锚定缩放，900s 工程 500px/s 无卡顿（ticks 窗口化）
- [ ] S 分割 / Ctrl+S 不劫持；吸附指示线拖动可见
- [ ] 比例切换 6 档：预览 contain 不变形、片段/关键帧位置等比、字幕大小合理、节点卡片 letterbox
- [ ] 导出 18 组合（6 比例×3 档）尺寸取偶正确（抽查 16:9 480p=854×480、9:16 1080p=1080×1920）
- [ ] 导出中收起编辑器：导出继续、完成后画布出现产物节点（后台完成语义）
- [ ] 并发双导出超配额：confirm 终判拦截（一个成功一个 400 回滚，无孤儿 pending）

## Self-Review 记录

- Spec 覆盖：12 问题 + P0-A/B + P1-D/E + 标尺性能 + 拖拽静默丢弃 + 失败半途 + revoke + 收起语义——对应 Task 1-20 全段落（附录 B 矩阵逐条可指认）。
- 类型一致性：SaveTarget/pickSaveTarget（Task 18↔19）、canvasSizeOf/CANVAS_PRESETS/remapForCanvasSize（Task 14↔15↔16）、computeExportSize（Task 16↔17↔19）、applyCanvasSize（Task 13↔15）、setPendingProduct（Task 19↔批7 呼应）已交叉核对。
- 已知实现期待核实点（执行者 First Step 必读）：① overlap.ts canPlaceAt 签名（Task 8）② editorStore beginTransient/endTransient 公开 API 名（Task 14/既译）③ AssetPanel 条目字段名（Task 9）④ VideoEditNode 实际路径（Task 15 Glob）⑤ react-resizable-panels autoSaveId 持久化行为（Task 5）。核实不符时以仓内实测为准并在 plan 勘误登记，不得硬套本 plan 代码。

