# 多轨道剪辑器 UI/交互层深度改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec [2026-09-11-video-editor-ui-overhaul-design.md](../specs/2026-09-11-video-editor-ui-overhaul-design.md) 修复层级缺陷并对齐 opencut 交互质量（暗色/布局/缩略图/缩放锚定/比例/导出中转），7 批次递进。

**Architecture:** 保留 editorStore/scene/renderer/audio-engine/export 管线（与画布 Yjs 协作深度绑定），只动 UI 交互层与导出通道；opencut 以算法级移植（无直接 import）。批 1 是独立证伪实验（层级诊断对错由浏览器首验判定），后续批次依赖其结论。

**Tech Stack:** React 18 + antd 5.22.5 + Tailwind（无 preflight）+ zustand 4 + Vitest；新依赖 `react-resizable-panels`；后端 NestJS + Prisma。

**执行纪律（每个 implementer 必读）：**
- TDD 铁律：NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。每任务先写测试看红，再实现看绿。
- CLAUDE.md 四原则：编码前先思考/简洁优先/精准修改/目标驱动。不动任务清单外的代码。
- 测试命令：`cd D:/flowweb && pnpm --filter @flowweb/web test -- --run <文件路径>`（web 端）；`pnpm --filter @flowweb/api test -- --run <路径>`（api 端）；`pnpm --filter @flowweb/shared test`（shared 端）。
- 提交信息带批次前缀，如 `feat(video-editor): 批1 层级修复——…`。
- 既有验收资产不得回退：`startingRef` 重入锁、`beforeunload` 模块级守卫、autosave flush 关闭路径。

---

## 文件结构总览

| 批 | Create | Modify |
|---|---|---|
| 1 | — | `components/VideoEditorShell.tsx`、`AssetPanel.tsx`、`ExportModal.tsx`、`PreviewPlayer.tsx` |
| 2 | — | `VideoEditorShell.tsx`、`PreviewPlayer.tsx`（+test）、`EditorTopBar.tsx`、`PropertiesPanel.tsx`、`AssetPanel.tsx`、`components/timeline/TimelinePanel.tsx`（+render/interact 两个 test——R6-B4 getByText→getByRole 同步）、`TimelineRuler.tsx`、`TrackRow.tsx`（R7 小项①：Task 4 亮→暗映射实际涉及的 5 组件此前漏列）、`apps/web/package.json`（Task 5 依赖）、`index.css`（全局，仅加编辑器段） |
| 3 | `timeline/placement.ts`（+test）、`renderer/poster.ts`（+test） | `types.ts`（shared 同步）、api 端 `video-project.service.ts`（defaultProjectData 单轨同步）、`store/editorStore.ts`、`components/AssetPanel.tsx`、`components/timeline/TimelinePanel.tsx`、`components/timeline/PlayheadLine.tsx`（140 常量）、`components/timeline/ClipBlock.tsx`、`components/timeline/TimelineRuler.tsx`、`hooks/useEditorKeyboard.ts` |
| 4+5 | `timeline/canvas-size.ts`（+test） | `types.ts`、`PreviewPlayer.tsx`、`hooks/usePreviewPlayback.ts`、`renderer/canvas-renderer.ts`、`scene/subtitle-layout.ts`、`export/precheck.ts`、`export/worker.ts`、`export/client.ts`、`export/upload.ts`、`api/videoProjectApi.ts`（R6-B11：resolution 联合改派生）、`capabilities.ts`（探测尺寸参数化）、`components/EditorTopBar.tsx`、`components/nodes/VideoEditNode.tsx`、api 端 `video-project.dto.ts`、`generated-media.service.ts` |
| 6 | — | `export/client.ts`、`export/worker.ts`、`export/upload.ts`、`components/ExportModal.tsx`（重构为 Popover）+ `ExportModal.test.tsx`（mock 工厂重写——pickSaveTarget 三态，R6）、`store/editorStore.ts` |
| 7 | — | api 端 `generated-media.service.ts`（+spec 补 assertOnConfirm mock）、`temp-cleanup.processor.ts`（+spec 的 where 断言同步）、`temp-cleanup.module.ts`（R6-B13：repeatable 调度注册——现状零入队者死代码）、`video-project.dto.ts` |

> types.ts 说明：`apps/web/src/pages/canvas/video-editor/types.ts` 是 `packages/shared/src/types/video-project.ts` 的 re-export 壳（仓内既有模式），schema 改动一律落 shared，web 侧跟随。

---

## 批 1｜层级修复（最小证伪实验）

**只做层级不动 theme。** 失败 = z-index 诊断错，停止后续批次回批重查。

### Task 1: Shell 弹层作用域（ConfigProvider + AntdApp + shellRef）

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.tsx`
- Test: `apps/web/src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx`（追加用例——**不用自建夹具文件**：自证式测试测的是夹具不是 Shell，删掉 Shell 的 ConfigProvider 后依然全绿，无回归保护价值）

- [ ] **Step 1: 写失败测试——真实 Shell 内触发弹层，断言挂载容器归属壳**

```tsx
// VideoEditorShell.test.tsx 追加（复用既有夹具：vi.mock upsertProject/patchProject 已就绪，
// 渲染真实 <VideoEditorShell /> 并 waitFor upsertProject 已调用——既有用例同款流程）
it('P0-A 回归：壳内 antd 弹层挂载容器归属壳节点（删 Shell 的 ConfigProvider 后此用例必红）', async () => {
  // 既有夹具渲染 + 就绪等待后：
  fireEvent.click(screen.getByText('导出'));   // 打开导出弹层（批 6 前仍是 Modal）
  await waitFor(() => {
    const wrap = document.querySelector('.ant-modal-wrap');
    expect(wrap).toBeTruthy();
    // 容器归属断言（真红点）：Modal 挂进壳内而非 body 直挂——
    // 无 ConfigProvider(getPopupContainer) 时 wrap.closest(壳) === null，用例红
    expect((wrap as HTMLElement).closest('[data-testid="video-editor-shell"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败（生产代码的真红）**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor/components/VideoEditorShell.test.tsx`
Expected: FAIL——`.ant-modal-wrap` 为 null（Modal 尚未挂进壳/或挂到 body 使 closest 为 null）。注意 exportOpen 由 Shell 内部 state 控制，若既有夹具未暴露导出按钮点击路径（EditorTopBar 渲染需 saveState），按既有夹具补 waitFor 即可，**不得改用自建探针夹具**。

- [ ] **Step 3: 改造 VideoEditorShell——加 ConfigProvider + AntdApp + shellRef，Shell 内 2 处静态 message 改 useApp()**

VideoEditorShell.tsx 关键改动（保留全部现有逻辑，只动弹层作用域与 message 来源）：

```tsx
import { useEffect, useRef, useState } from 'react';
import { ConfigProvider, App as AntdApp } from 'antd'; // ← 替换 `import { message } from 'antd'`

export function VideoEditorShell() {
  // ...现有 state/effect 全部保留...
  // ⚠ useRef 类型必须显式含 null：useRef<HTMLDivElement>(null) 在 @types/react 18 下推出 RefObject
  // （current 只读），回调 ref 内赋值会 TS 报错
  const focusRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);  // 弹层容器 ref
  const { message } = AntdApp.useApp();                 // ← 新增（:53 onConflict 与 :76 handleClose 内的 message.warning 来源替换，调用代码不变）
  // ...
  return (
    <BaseFullscreenModal open={open} onClose={handleClose} label="多轨剪辑" closeOnBackdrop={false} initialFocusRef={focusRef}>
      {/* ⚠ 一个元素只能有一个 ref 属性——回调 ref 合并两个目标（R3 必改①：漏挂 shellRef 则
          shellRef.current 恒 null，getPopupContainer 永远回退 body，修复静默失效且测试红）。
          MutableRefObject<HTMLDivElement|null> 可赋给 BaseFullscreenModal 的 initialFocusRef?: RefObject<HTMLElement> ✓ */}
      <div data-testid="video-editor-shell" tabIndex={-1}
        ref={(el) => { focusRef.current = el; shellRef.current = el; }}
        className="fixed inset-0 bg-[#F7F8FA] flex flex-col box-border nokey">
        {/* 批 1：弹层作用域——antd 弹层挂进壳内（高于壳 z-[100000] 的层叠由 DOM 顺序保证），
            ref 未挂载首帧兜底 body（getPopupContainer 不得返回 null）。
            ⚠ R6-B1 必改：<AntdApp> 默认渲染 <div class="ant-app">（antd es/app/index.js:22 component='div'），
            block + 高度 auto 会打断壳的 flex flex-col——flex-1/min-h-0 对非 flex 子项失效，整页布局塌陷
            （jsdom 不测布局，测试全绿但浏览器整页错乱）。必须 component={false} 渲染 Fragment（零 DOM，
            5.22.5 支持；仅 cssVar+component=false 组合有 dev 警告，本项目未启用 cssVar 无碍）。
            旁证（评审核验采纳）：BaseFullscreenModal.tsx:70 backdrop-blur-sm 会为 fixed 后代建立包含块
            与层叠上下文，但与壳同为 inset-0——实测等价，无副作用。 */}
        <ConfigProvider getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp component={false}>
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

- [ ] **Step 4: 跑既有测试确认无回归**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor`
Expected: 全 PASS（jsdom 无层叠上下文，本步只验证 DOM 结构与行为不破）

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/video-editor/components
git commit -m "feat(video-editor): 批1-1 编辑器弹层作用域——壳内 ConfigProvider getPopupContainer + AntdApp(component=false)，Shell 内 message 改上下文实例（P0-A）"
```

### Task 2: 编辑器内其余 8 处静态调用改 useApp()

**Files:**
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx:45,46,58,59`、`ExportModal.tsx:89,108`、`PreviewPlayer.tsx:45(Modal.confirm),55`
- Test: 上述组件既有测试文件（跑通为准，不新增用例——调用形态变化无行为变化）

- [ ] **Step 1: AssetPanel——顶部 `import { message } from 'antd'` 改 `import { App as AntdApp } from 'antd'` + 组件体内 `const { message } = AntdApp.useApp();`**

四处调用（:45 `message.error('仅支持视频、音频、图片文件')`、:46、:58 `message.success('上传完成')`、:59）代码不变，仅来源变。若 AssetPanel 不是组件根（是函数组件直接导出），`useApp()` 调用放在组件体首行。

- [ ] **Step 2: ExportModal 同法改造（:89 `message.warning('工程尚未就绪…')`、:108 `message.success('导出完成…')`）；注意 ExportModal 内的 `startExport` 是事件闭包——`useApp()` 返回的实例是稳定引用（antd 保证），闭包内直接用，不依赖 hooks 规则**

- [ ] **Step 3: PreviewPlayer——`Modal.confirm`（:45 片段重拍）改 `modal.confirm`，`message.error`（:55）改 `message.error`；`const { message, modal } = AntdApp.useApp();` 放组件体首行；删除 `import { Modal, ... } from 'antd'` 中的 Modal（Slider/Tooltip/message 若仍被用则保留，message 导入删除）**

- [ ] **Step 4: 跑批 1 全部测试（含 Task 1 的 Shell 级归属断言——ExportModal 单渲染无壳，归属断言只放 Shell 级，此处不重复）+ Commit**

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

> **toast 也依赖批 1（R7 第三节核实补记）**：修复前 message 同样不可见——antd message 经 `useMessage` 的 `getContainer: () => staticGetContainer?.() || getPopupContainer?.() || document.body`（message/useMessage.js:90，getPopupContainer 取自 ConfigContext），z-index = 12010（zIndexPopupBase + CONTAINER_MAX_OFFSET + 10，message/style/index.js:145）≈ 同样被壳 z-[100000] 覆盖。批 1 的 getPopupContainer 一落地 toast 容器即归壳内 → 可见，且处于暗色 ConfigProvider 内 → 批 2"toast 同暗色"前提成立。本步是批 1 的**第二红点**（证伪 z-index 诊断的双通道验证）。

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
  --ve-text-dim: rgba(226, 232, 240, 0.6);    /* 淡化文本专用 token——Tailwind3 无法对 var() 用 /透明度修饰符（生成声明被静默丢弃），禁止 text-[var(--ve-text)]/60 写法 */
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
- `text-[#4E5969]` → `text-[var(--ve-text)]`（次要文字同主文字——勿用斜杠透明度写法，淡化场景一律 --ve-text-dim）
- `text-[#86909C]` → `text-[var(--ve-text-dim)]`（专用 token——**禁用 `text-[var(--ve-text)]/60` 斜杠写法**，Tailwind3 对 var() 无法解析透明度通道）
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

- [ ] **Step 1: 安装依赖（R6-B5 必改：显式锁 v2）**

Run: `cd D:/flowweb && pnpm --filter @flowweb/web add react-resizable-panels@^2.1.9`
Expected: 安装 2.1.9（**禁止裸包名**——registry latest 已是 4.12.4，API 全变：v4 是 Group/Separator/像素语义 defaultSize/useDefaultLayout，本 plan 全部 JSX 与持久化契约按 v2 编写）。v2.1.9 为 2.x 末版（peer 声明 React ^16.14||^17||^18，本仓 React18 兼容 ✓）；v2 停更风险登记：面板布局 API 稳定、无已知影响本项目的缺陷，后续升级 v4 属独立改造不混入本次。

- [ ] **Step 2: 写失败测试——布局结构（面板组 + 持久化契约）**

```tsx
// VideoEditorShell.test.tsx 追加
it('布局为可调面板组：垂直(主区/时间轴) + 水平(素材/预览/属性) 各两级', () => {
  // 渲染 Shell（复用既有夹具），断言两级面板组与 3 个水平面板。
  // v2 DOM 属性 data-panel-group-id/data-panel-id（R6 评审对 v2 已发布包核实，待核实点①收敛）。
  expect(document.querySelectorAll('[data-panel-group-id]').length).toBeGreaterThanOrEqual(2);
  // 组 id 命名 ve-vertical/ve-horizontal 由实现写入，断言 querySelector('[data-panel-group-id="ve-vertical"]') 等精确匹配
});
```

- [ ] **Step 3: 实现布局改造（onLayout 自管持久化——spec 契约：键名 `ve-panel-sizes`、版本 v1、migrate 预留）**

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

// 持久化契约（对齐 opencut panel-store 模式：自管 {version, panels}，不用库内建 autoSaveId——
// 其键名/序列化由库控制无版本语义，不满足 spec"键名+版本+migrate"冻结条款）
const PANEL_STORAGE_KEY = 've-panel-sizes';
function loadPanelSizes(): { version: 1; panels: Record<string, number[]> } | null {
  try {
    const raw = localStorage.getItem(PANEL_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as { version: number } : null;
    return parsed?.version === 1 ? parsed as { version: 1; panels: Record<string, number[]> } : null; // 版本不符走默认（migrate 挂点）
  } catch { return null; }
}
// Shell 内（R4 建议：saved 惰性初始化一次——组件体内裸调 loadPanelSizes() 每次重渲重读 localStorage，
// 若库在 prop 变化时重应用 defaultSize 会导致拖动回弹；useState 惰性形一次性根除）：
const [saved] = useState(() => loadPanelSizes());
// R7-S4：onLayout 拖拽期间逐帧触发，localStorage.setItem 同步写逐帧落盘有卡顿风险——
// onLayout 只缓存进 ref，PanelResizeHandle 的 onDragging(isDragging=false)（v2 导出
// PanelResizeHandleOnDragging）拖拽结束时一次落盘：
const pendingSizesRef = useRef<Record<string, number[]>>({});
const saveLayout = (groupId: string) => (sizes: number[]) => { pendingSizesRef.current[groupId] = sizes; };
const flushLayout = () => {
  if (Object.keys(pendingSizesRef.current).length === 0) return;
  const cur = loadPanelSizes();
  localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ version: 1, panels: { ...cur?.panels, ...pendingSizesRef.current } }));
  pendingSizesRef.current = {};
};
// ⚠ 三个 PanelResizeHandle（水平组 2 个 cursor-col-resize + 垂直组 1 个 cursor-row-resize）**全部**挂
// onDragging={(isDragging) => { if (!isDragging) flushLayout(); }}（R8-N9：只挂两个则垂直方向拖动永不落盘，
// "刷新后尺寸保持"验收漏一半）。键盘 resize 是否触发 onDragging 未经证实——实现期键盘调宽后若刷新丢尺寸，
// 在 Panel 的 onResize 兜底 flush（登记待实测，非阻断）。

<div className="flex flex-1 min-h-0">
  <PanelGroup direction="vertical" id="ve-vertical" onLayout={saveLayout('ve-vertical')}>
    {/* ⚠ v2 的尺寸 prop 属于 Panel，PanelGroup 无 defaultSize（R3 必改⑤）——
        恢复布局 = 把保存的尺寸数组按序映射回各 Panel 的 defaultSize。
        ⚠ R4：横向三档默认和必须 =100（20+48+22=90 会右侧留缝）——定 22/56/22 */}
    <Panel defaultSize={saved?.panels['ve-vertical']?.[0] ?? 70} minSize={30}>
      <PanelGroup direction="horizontal" id="ve-horizontal" onLayout={saveLayout('ve-horizontal')}>
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[0] ?? 22} minSize={15} maxSize={40}><AssetPanel /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" />
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[1] ?? 56} minSize={30}><PreviewPlayer /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" />
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[2] ?? 22} minSize={15} maxSize={40}><PropertiesPanel /></Panel>
      </PanelGroup>
    </Panel>
    <PanelResizeHandle className="h-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-row-resize" />
    <Panel defaultSize={saved?.panels['ve-vertical']?.[1] ?? 30} minSize={15} maxSize={70}><TimelinePanel /></Panel>
  </PanelGroup>
</div>
```

说明：R7-S4 后 onLayout 只写 ref 不落盘（避免拖拽逐帧同步 localStorage 卡顿），落盘集中在 onDragging(false)（拖拽结束）——首次挂载若触发 onLayout 也只进 ref，拖拽未发生则 flushLayout 空写防护（pendingSizes 空 Map 早退），"首次回调覆盖 saved"问题随之消解；onLayout 首次挂载是否触发仍留装包实测登记（无害化——最多多 flush 一次等值数据）。

同步改动：
- `TimelinePanel.tsx:216` 的 `h-[280px]` 固定高删除（Panel 提供高度，内部 `flex flex-col min-h-0` 自适应）
- `AssetPanel.tsx:31` 的 `w-[260px] shrink-0`、`PropertiesPanel.tsx:74/81` 的 `w-[280px] shrink-0` 删除（Panel 控宽）
- TimelinePanel 视口测量：**已有 ResizeObserver 维护 viewportW state（:34-38，G9 注释）——无需改动**；`:232 widthPx={viewportW - 140}` 契约保留（140 提常量见批 3 Task 11）

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
- Test: `PreviewPlayer.test.tsx`（断言图标按钮）+ 既有断言同步：`components/timeline/TimelinePanel.render.test.tsx:59-62`、`components/timeline/TimelinePanel.interact.test.tsx:101,110`（R6-B4：10 处 getByText 改 getByRole——getByText 不读 aria-label，图标化后文字节点消失必红）

- [ ] **Step 1: 写失败测试**

```tsx
it('撤销/重做/分割/删除为图标按钮（原生 title 含快捷键——R6-B3：不用 antd Tooltip，其不写原生 title 属性，且与原生 title 双提示冗余）', () => {
  const undo = screen.getByRole('button', { name: '撤销' });   // name 匹配 aria-label
  expect(undo.querySelector('svg')).toBeTruthy();              // 图标
  expect(undo.getAttribute('title')).toContain('Ctrl+Z');      // 原生 title 属性
  expect(screen.getByRole('button', { name: '分割' }).getAttribute('title')).toContain('S');
});
```

- [ ] **Step 2: 跑红 → 实现（原生 title + aria-label，与既有 :90/:93 分割/删除 title 风格一致——简洁优先，不引入 Tooltip）**

```tsx
import { UndoOutlined, RedoOutlined, ScissorOutlined, DeleteOutlined } from '@ant-design/icons';
// 四个按钮替换（onClick 逻辑不变；title 取代原 Tooltip 计划——antd Tooltip 是 hover 弹层不写原生 title 属性）：
<button type="button" aria-label="撤销" title="撤销 Ctrl+Z" onClick={() => useEditorStore.getState().undo()}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><UndoOutlined /></button>
<button type="button" aria-label="重做" title="重做 Ctrl+Shift+Z" onClick={() => useEditorStore.getState().redo()}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><RedoOutlined /></button>
<button type="button" aria-label="分割" title="分割 S（在播放头处）" onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.splitClip(es.selectedClipId, es.playhead); }}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><ScissorOutlined /></button>
<button type="button" aria-label="删除" title="删除 Delete" onClick={() => { const es = useEditorStore.getState(); if (es.selectedClipId) es.removeClip(es.selectedClipId); }}
  className="text-[15px] text-[var(--ve-text)] bg-transparent border-0 cursor-pointer px-1.5 hover:text-white"><DeleteOutlined /></button>
```

- [ ] **Step 3: 既有断言同步修正（精准修改，只改查询方式不改断言语义）**

三个文件 10 处 `getByText('撤销'/'重做'/'分割'/'删除')` → `getByRole('button', { name: '撤销' })` 等（aria-label 承接可查性）：
- `PreviewPlayer.test.tsx:86-89`（四条）、`:105`（fireEvent.click(getByText('删除'))）
- `TimelinePanel.render.test.tsx:59-62`（四条）
- `TimelinePanel.interact.test.tsx:101,110`（fireEvent.click getByText('分割'/'删除')）

- [ ] **Step 4: 跑绿 + 既有用例 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批2-3 控制条撤销/重做/分割/删除图标化（antd icons + 原生 title 快捷键提示，位置不变不加工具行）"
```

---

## 批 3｜时间轴交互（单轨动态建轨 / 缩略图 / 色表 / 缩放 / 标尺）

### Task 7: 初始单轨 + 测试夹具修复

**Files:**
- Modify: `packages/shared/src/types/video-project.ts:52-64`、api 端 `video-project.service.ts:19-26`（defaultProjectData 手抄 4 轨副本同步单轨——R6-B6）+ `video-project.service.spec.ts:37-43`（**R7-N4：断言默认 4 轨的 spec——`expect(created.data.tracks).toHaveLength(4)` / `toEqual(['video','subtitle','audio','audio'])` 改 1 轨 + `['video']`，测试名"4 轨"文案同步；全仓唯一断言默认轨的 api 测试，R6 漏列**）、`components/VideoEditorShell.tsx:35` 附近「4 轨」注释、测试夹具 6 文件（下详）
- Test: shared 包既有测试 + web 侧受影响夹具

> **R6-B6 影响面实测全量（6 文件 7 行）**——单轨化后 `.find(t => t.type === 'audio'|'subtitle')!` 返回 undefined 直接 TypeError（非断言失败）：
> ① `PropertiesPanel.test.tsx:15-28`（tracks[2] :21-22 / tracks[1] :27-28）② `TimelinePanel.render.test.tsx:11-18`（tracks[1] :12 / tracks[2] :14,:18）③ `store/editorStore.test.ts:64,184` ④ `store/editorStore.keyframe.test.ts:52,63,91` ⑤ `components/AssetPanel.test.tsx:126` ⑥ `components/timeline/TimelinePanel.interact.test.tsx:119`。
> 不受影响（已核）：`renderer/render-frame.test.ts:22-28` 自建 tracks 字面量、`scene/interpolate.test.ts:193` 自行覆写 tracks[0]；api 侧 `video-project.dto.spec.ts:10` 自带 tracks:[] 不受影响。
> 行为变化登记（无需改码）：`editorStore.addTrack` 命名取同型轨计数+1 自适配，首条音频轨从「音频3」变「音频1」。

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

- [ ] **Step 3: 修受影响夹具（上方 R6-B6 全量名单 6 文件）**：夹具改为显式 `addTrack('audio'|'subtitle')` 后取新轨 id，或手写 tracks 数组——与生产动态建轨路径一致。api 侧 `video-project.service.ts` defaultProjectData 的 tracks 字面量同步改单视频轨（注释「1 视频+1 字幕+2 音频」一并改）+ `video-project.service.spec.ts:37-43` 断言改 1 轨（R7-N4），`VideoEditorShell.tsx:35`「首建默认 4 轨工程」注释同步。

- [ ] **Step 4: 全量测试（shared + web + api 三端）+ Commit**

```bash
git add packages/shared/src apps/web/src/pages/canvas/video-editor apps/api/src/modules/video-project
git commit -m "feat(video-editor): 批3-1 初始工程单空视频轨（勘误③）+ 夹具显式建轨对齐 + api 缺省副本同步"
```

### Task 8: 建轨策略纯函数 placeAssetInTrack

**Files:**
- Create: `apps/web/src/pages/canvas/video-editor/timeline/placement.ts` + `placement.test.ts`

- [ ] **Step 1: 写失败测试（spec 3.1 全部分支）**

```ts
import { describe, it, expect } from 'vitest';
import { placeAssetInTrack } from './placement';
import { createDefaultProjectData } from '../types';
import type { ProjectData, AudioClip } from '../types';

const audioClip = (id: string, start: number, duration: number, trackId: string): AudioClip =>
  ({ id, trackId, type: 'audio', start, duration, sourceStart: 0, mediaId: 'ma', volume: 1, fade: { in: 0, out: 0 }, playbackSpeed: 1, keyframes: [] });

describe('placeAssetInTrack', () => {
  it('视频素材进已有空视频轨，起点 0', () => {
    const d = createDefaultProjectData();
    const r = placeAssetInTrack(d, { mimeType: 'video/mp4', durationSec: 5 });
    expect(r.trackId).toBe(d.tracks[0].id);
    expect(r.start).toBe(0);
    expect(r.createNewTrack).toBe(false);
  });
  it('无音频轨时放音频 → 标记建轨；轨尾口径 = 该轨 max(start+duration) 而非全局时长', () => {
    const d = createDefaultProjectData();
    // 视频轨已有 0-10s 片段（全局时长 10）
    d.clips.c1 = { id: 'c1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 10, sourceStart: 0, mediaId: 'm', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never;
    d.tracks[0].clips.push('c1');
    const r = placeAssetInTrack(d, { mimeType: 'audio/mp3', durationSec: 3 });
    expect(r.createNewTrack).toBe(true);   // 无音频轨 → 建
    expect(r.start).toBe(0);               // 新轨从 0
    // 显式补建音频轨 + 一条 0-3s 片段（不依赖 addTrack——纯函数测试直接构造数据）：
    const d2: ProjectData = { ...d, tracks: [...d.tracks, { id: 'ta', type: 'audio', name: '音频1', muted: false, hidden: false, clips: ['a1'] }], clips: { ...d.clips, a1: audioClip('a1', 0, 3, 'ta') } };
    const r2 = placeAssetInTrack(d2, { mimeType: 'audio/mp3', durationSec: 2 });
    expect(r2.createNewTrack).toBe(false);
    expect(r2.trackId).toBe('ta');
    expect(r2.start).toBe(3);              // 该轨轨尾 3，而非全局 10（轨尾口径用例）
  });
  it('mimeType 三分类：video/* 与 image/* → video 轨，audio/* → audio 轨', () => {
    const d = createDefaultProjectData();
    expect(placeAssetInTrack(d, { mimeType: 'image/png', durationSec: 4 }).trackId).toBe(d.tracks[0].id);
  });
});
```

- [ ] **Step 2: 跑红 → 实现（简洁优先：轨尾追加位置与轨内片段不可能重叠，无需重叠判定——canPlaceAt 依赖删除）**

```ts
// apps/web/src/pages/canvas/video-editor/timeline/placement.ts
import type { ProjectData, Track } from '../types';

export type AssetKind = 'video' | 'audio' | 'image';
export function assetKindOf(mimeType: string): AssetKind {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'image';
}
export interface PlacementResult { trackId: string; start: number; createNewTrack: boolean; newTrackType?: Track['type']; }
/** 动态建轨策略（spec 3.1 / D8）：取该类型第一条轨 → 起点 = 该轨 max(start+duration)（空轨 0）；无该类型轨 → 标记建轨。
 *  轨尾追加位与轨内既有片段不可能重叠，故不做重叠判定（原 canPlaceAt 依赖为死代码，评审第 5 条删除）。 */
export function placeAssetInTrack(data: ProjectData, asset: { mimeType: string; durationSec: number }): PlacementResult {
  const trackType: Track['type'] = assetKindOf(asset.mimeType) === 'audio' ? 'audio' : 'video'; // 图片归视频轨
  const track = data.tracks.find((t) => t.type === trackType);
  if (!track) return { trackId: '', start: 0, createNewTrack: true, newTrackType: trackType };
  const start = Math.max(0, ...track.clips.map((id) => { const c = data.clips[id]; return c ? c.start + c.duration : 0; }));
  return { trackId: track.id, start, createNewTrack: false };
}
```

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
  // 夹具：含一个 video 素材条目；fireEvent.click 卡片（asset-item-* 条目）
  // 断言 store：data.clips 新增 1 条 video clip，trackId = 视频轨 id，start = 该轨轨尾
});
it('点击团队素材/生成结果卡片同法入轨（三种卡片形状归一化——R6-B7）', async () => {
  // 各一条用例：team-asset-item-* / generated-item-*（生成结果需 mediaInfo 先有 mimeType）
});
// TimelinePanel.interact.test.tsx 追加
it('拖拽音频落到视频轨：不静默丢弃——自动建音频轨并按落点 x 放置', () => {
  // 夹具：仅视频轨；drop payload mimeType audio/mp3 落视频轨
  // 断言：新增 audio 轨 + 音频 clip 起点按落点量化
});
it('drop 到字幕轨仍忽略且不新建任何轨（R6-B14——改道分支不得顺带废掉 review I1 语义）', () => {
  // 既有 AssetPanel.test.tsx:113-128「字幕轨忽略」用例语义保持，补断言：
  // drop 后 data.tracks 仍只有 1 条（不新建视频/音频轨）——原用例只断言字幕轨 clips 空，
  // 改道逻辑会让片段溜进新建轨而字幕轨仍空（用例假绿语义漂移），必须加轨数断言封住
});
```

- [ ] **Step 2: 跑红 → 实现**

**R6-B7 前置事实**：AssetPanel 三种卡片三种形状——①全集资产 AssetItem（`originalName`、`nodeDurationSec ?? metadata.durationSec`、有 sourceNodeId/thumbnailUrl）②团队素材 TeamAssetItem（`name`、`durationSec`、无 sourceNodeId）③生成结果（读 `mediaInfo[mediaId]` 的 name/durationSec/mimeType，无 thumbnailUrl）。AssetItem **无** name/durationSec 字段（useWorkflowAssets.ts:5-11）。归一化核心函数 + 三处 onClick 各自构造：

```tsx
// AssetPanel.tsx 模块级（归一化入轨核心——三种卡片共用；norm 是唯一入参，杜绝字段名漂移）
function addAssetToTimeline(norm: {
  mediaId: string; mimeType: string; name: string; durationSec: number; url?: string;
  sourceNodeId?: string; thumbnailUrl?: string;
}) {
  const es = useEditorStore.getState();
  if (!es.data) return;
  es.setMediaInfo(norm.mediaId, { name: norm.name, durationSec: norm.durationSec, url: norm.url, mimeType: norm.mimeType });
  const placement = placeAssetInTrack(es.data, { mimeType: norm.mimeType, durationSec: norm.durationSec });
  const trackId = placement.createNewTrack ? es.addTrack(placement.newTrackType!) : placement.trackId;
  const k = assetKindOf(norm.mimeType);
  es.addClip({ type: k === 'audio' ? 'audio' : k === 'image' ? 'image' : 'video',
    mediaId: norm.mediaId, sourceNodeId: norm.sourceNodeId, trackId, start: placement.start });
}
// 三种卡片 onClick（durationSec 缺省 5，同 drag payload 口径）：
// ① 全集资产：addAssetToTimeline({ mediaId: i.mediaId, mimeType: i.mimeType, name: i.originalName,
//    durationSec: i.nodeDurationSec ?? (i.metadata as {durationSec?: number}).durationSec ?? 5, url: i.url,
//    sourceNodeId: i.sourceNodeId || undefined, thumbnailUrl: i.thumbnailUrl ?? undefined })
// ② 团队素材：addAssetToTimeline({ mediaId: it.mediaId, mimeType: it.mimeType, name: it.name,
//    durationSec: it.durationSec ?? 5, url: it.url, thumbnailUrl: it.thumbnailUrl ?? undefined })   // sourceNodeId 省略——素材库来源不建边
// ③ 生成结果：addAssetToTimeline({ mediaId, mimeType: info!.mimeType, name: info!.name ?? mediaId,
//    durationSec: info!.durationSec ?? 5, url: info!.url })   // draggable 已按 mimeType 有无守卫，click 同款判空
```

（setMediaInfo 的 thumbnailUrl 白名单第四字段在 Task 10 一并加——此处三字段已有。）

TimelinePanel drop 分支（:184-185）替换（R4 必改② + R6-B14 + **R7-N2 必改**：dropIntoTrack 是函数声明，ESM 恒严格模式下块内 function 声明是**块级作用域**——声明必须提升到 handleClipDrop 函数体顶部，两处调用（错型改道分支 + 兼容路径）都在函数作用域内可见；写在 if 块内则块外调用 Cannot find name）：

```tsx
// handleClipDrop 函数体顶部（payload 解析之后、轨道匹配之前）：
function dropIntoTrack(trackId: string, e: React.DragEvent<HTMLDivElement>) {
  /* 既有 drop 体（setMediaInfo + addClip，trackId 换参）——量化落点逻辑不变（rect 取自 e.currentTarget 不受 trackId 换参影响） */
}
// 旧：if (kind === 'audio' ? trackType !== 'audio' : trackType !== 'video') return;
// 新（语义拆分——R6-B14：先判字幕轨保持忽略，原分支同时覆盖「错型改道」与「字幕轨拒绝」两种语义，
// 整条替换会让字幕轨 drop 也去新建视频轨，废掉 review I1「错型不入库」既定决策且既有用例假绿）：
if (trackType === 'subtitle') return; // 字幕轨不接受 drop（review I1 保持——改道只针对 audio↔video 错型）
if (kind === 'audio' ? trackType !== 'audio' : trackType !== 'video') {
  // audio↔video 错型 → 走建轨策略改道（spec 3.1：拖音频进单视频轨场景 100% 触发，不得静默丢弃）
  const es = useEditorStore.getState();
  const p = placeAssetInTrack(es.data!, { mimeType: payload.mimeType, durationSec: payload.durationSec });
  dropIntoTrack(p.createNewTrack ? es.addTrack(p.newTrackType!) : p.trackId, e);
  return; // ← 关键：不兼容轨绝不继续走原（被悬停轨）trackId 分支
}
dropIntoTrack(trackEl.dataset.trackId!, e); // 兼容路径不变
```

- [ ] **Step 3: 跑绿 + 既有交互用例全绿 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批3-3 点击素材入轨 + 拖拽不兼容轨自动建轨（替换静默丢弃）"
```

### Task 10: thumbnailUrl 白名单 + tile 平铺 + 色表 + 波形白

**Files:**
- Create: `renderer/poster.ts`（+test，R6-B8：自建一次性首帧海报工厂——不动 video-cache）
- Modify: `store/editorStore.ts`（MediaInfo 接口 + setMediaInfo/mergeMediaInfo 白名单 + addClip 回填链路）、`components/AssetPanel.tsx`（回填 thumbnailUrl + poster fire-and-forget）、`components/timeline/ClipBlock.tsx`（tile + 色表 + 波形）
- Test: `store/editorStore.test.ts`、`renderer/poster.test.ts`、`ClipBlock` 渲染断言（TimelinePanel.render.test.tsx）

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
// 组件内——必须用 selector 订阅（非 getState）：ensurePoster 异步写回 mediaInfo 后要触发已挂载片段重渲染
const thumb = useEditorStore((s) => (clip.type === 'video' || clip.type === 'image') ? s.mediaInfo[clip.mediaId]?.thumbnailUrl : undefined);
style={{
  left, width,
  // ⚠ 长写并行声明——禁用 background 简写 + backgroundImage 混排（简写会清掉 image，"海报偶尔消失"型陷阱，评审第 10 条）
  backgroundColor: missing ? '#7f1d1d' : BLOCK_BG[clip.type],
  ...(thumb ? { backgroundImage: `url(${thumb})`, backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%' } : {}),
  border: /* 同现有逻辑，BAR 色同步暗化：video #6C5CE7 / image #5B7CFA / audio #8F5DBA / subtitle #5DBAA0 */,
}}
// WaveformCanvas :27 fillStyle '#43CC80' → 'rgba(255, 255, 255, 0.7)'
// 文字标签色 text-[#4E5969] → text-white/85（tile 之上可读）
```

回退取帧（thumbnailUrl 为空时，常态分支——生成结果素材无缩略图）：**独立子步骤 TDD**（R4 小项：只有注释没有实现/测试违反 plan 开头的 TDD 铁律）。

**R6-B8 前置事实（已一手核实）**：全仓无 openPosterSink/frameToCanvas/poster.ts；video-cache.ts:171-193 实物是 `openMediabunnySink(url)` 返回 `{ canvases(start), dispose() }`——不含单帧取画布接口，且被 export/worker.ts:11 消费**不宜改名/改签名**。故 poster.ts **自建**一次性工厂（不经 video-cache，spec v1.0-final：播放 LRU 双帧窗口会互相淘汰静态海报）；mediabunny `CanvasSink` 有 `getCanvas(ts)`（video-cache.ts:166 注释记录的 d.ts 事实），资源主口是 `Input.dispose()`（CanvasSink 自身无 dispose）。测试 mock 直接对齐真实 mediabunny API 形状（vi.mock('mediabunny')，与 vitest 惯例一致）。
**R7-N1 修正（对 mediabunny@1.56.1 d.ts 一手核实）**：① `getCanvas(timestamp)` 返回 `WrappedCanvas = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp; duration }`（mediabunny.d.ts:5414）——**不是 canvas 本身**，取 `frame.canvas`；② `InputOptions.formats` **必填**（d.ts:2518）——`new Input({ source })` 编译报错，须 `formats: ALL_FORMATS`（与 video-cache.ts:175 同款）；③ poster 仅主线程使用，getCanvas 在 DOM 语境产 HTMLCanvasElement（media-sink.js:1448），但恒绘制进新 canvas 归一化类型（不早退返回 src）。
**R8-N6 补记**：apps/web **未安装 canvas 包**——jsdom 下 `document.createElement('canvas')` 的 `getContext()`/`toDataURL()` 均走 notImplemented 返回 null，`toJpegDataUrl` 内部新建的 out canvas 必须在测试里整体桩化（mkCanvas 只覆盖了 mediabunny mock 链路的**源** canvas，覆盖不到 `document.createElement` 产物——无桩则 `null.drawImage` TypeError 被 ensurePoster catch 吞掉返回 null，断言必红且报错被掩盖）。桩法参照仓内先例 `apps/web/src/hooks/useThumbnails.test.ts:62-94`（createMockCanvas + createElementSpy 只劫持 canvas tag 其余 passthrough）。（行号出处口径统一：R7 引 mediabunny.d.ts:5414/:2516 为打包单文件 d.ts；分文件视图为 media-sink.d.ts:178-180（WrappedCanvas/getCanvas）/input.d.ts:21-23（formats 必填）——同一内容两种视图。）

```ts
// renderer/poster.test.ts
// R7-N1：桩形状对齐 mediabunny@1.56.1 真实 API——getCanvas 返回 WrappedCanvas {canvas,timestamp,duration}
// （非 canvas 本身）；InputOptions.formats 必填（mock 须提供 ALL_FORMATS 占位）
// R8-N6：jsdom 无 canvas 包——toJpegDataUrl 内部 document.createElement('canvas') 必须 spy 桩化
// （先例 useThumbnails.test.ts:62-94：createElementSpy 只劫持 canvas tag，其余 passthrough 原实现）
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
const dispose = vi.fn();
const getCanvas = vi.fn();
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  Input: class { constructor(public opts: unknown) {} // eslint-disable-line
    getPrimaryVideoTrack = vi.fn().mockResolvedValue({ canDecode: () => Promise.resolve(true) });
    dispose = dispose; },
  UrlSource: class { constructor(public url: string) {} }, // eslint-disable-line
  CanvasSink: class { constructor(public track: unknown, public opts: unknown) {} // eslint-disable-line
    getCanvas = (ts: number) => getCanvas(ts); },
}));
// （TDZ 注意：vi.mock 工厂引用上方 const——工厂在首次动态 import('mediabunny') 时才执行，届时模块顶层
//  const 已初始化，预计无 TDZ；实测若报 Cannot access before initialization 改 vi.hoisted() 包一层）
import { ensurePoster } from './poster';
// R8-N6：out canvas 桩——toJpegDataUrl 的 document.createElement('canvas') 产物（getContext + toDataURL 双桩）
const outCtx = { drawImage: vi.fn() };
const outCanvas = { getContext: () => outCtx, toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,OUT') } as unknown as HTMLCanvasElement;
let createElementSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeAll(() => {
  const orig = document.createElement.bind(document);
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(
    ((tag: string, ...rest: unknown[]) => (tag === 'canvas' ? outCanvas : orig(tag, ...rest))) as typeof document.createElement,
  );
});
afterAll(() => { createElementSpy?.mockRestore(); });
beforeEach(() => { dispose.mockClear(); getCanvas.mockClear(); outCtx.drawImage.mockClear(); }); // R8：模块级 vi.fn 跨用例累积——手动清调用记录（用例 1 的 toHaveBeenCalledOnce 依赖此清理）
const mkCanvas = (w: number) => ({ width: w, height: Math.round(w * 9 / 16),   // 源 canvas——只进 mock 链路
  getContext: () => ({ drawImage: vi.fn() }),
  toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,AAA') } as unknown as HTMLCanvasElement);
const wrapped = (c: HTMLCanvasElement) => ({ canvas: c, timestamp: 0, duration: 0.04 }); // WrappedCanvas 形状
describe('ensurePoster（一次性首帧海报）', () => {
  it('成功：getCanvas(0) → frame.canvas → 恒绘制进新 canvas（≤320 宽）→ JPEG dataURL，且 Input.dispose 用后即调', async () => {
    getCanvas.mockResolvedValue(wrapped(mkCanvas(1920)));  // 源 1920 宽——必须缩到 320
    const r = await ensurePoster('http://x/v.mp4');
    expect(r).toMatch(/^data:image\/jpeg;base64,/);
    expect(getCanvas).toHaveBeenCalledWith(0);
    expect(outCtx.drawImage).toHaveBeenCalled();           // R8：经 out canvas 桩绘制（非早退）
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('源 ≤320 宽：同样经新 canvas 输出（恒绘制——顺带归一化 HTMLCanvasElement 类型，R7-N1 虚警防护）', async () => {
    getCanvas.mockResolvedValue(wrapped(mkCanvas(320)));
    expect(await ensurePoster('http://x/v.mp4')).toMatch(/^data:image\/jpeg;base64,/);
  });
  it('失败/无视频轨/getCanvas 返回 null：返回 null（静默保持兜底底色）且 dispose 仍被调（finally）', async () => {
    getCanvas.mockRejectedValue(new Error('decode fail'));
    expect(await ensurePoster('http://x/v.mp4')).toBeNull();
    expect(dispose).toHaveBeenCalled();
    getCanvas.mockResolvedValue(null);
    expect(await ensurePoster('http://x/v.mp4')).toBeNull();
  });
});
```

实现（R7-N1 修正：`frame.canvas` 取画布——getCanvas 返回 WrappedCanvas 对象；`formats: ALL_FORMATS` 必填与 video-cache.ts:175 同款）：

```ts
// 新增 renderer/poster.ts（一次性首帧海报，与播放缓存隔离）
export async function ensurePoster(url: string): Promise<string | null> {
  let input: { dispose(): void } | null = null;
  try {
    const { Input, UrlSource, CanvasSink, ALL_FORMATS } = await import('mediabunny');
    const inp = new Input({ source: new UrlSource(url), formats: ALL_FORMATS }); // formats 必填（input.d.ts）——与 video-cache.ts:175 同款
    input = inp;
    const track = await inp.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { fit: 'contain' });   // CanvasSink 无 dispose——资源主口是 Input.dispose
    const frame = await sink.getCanvas(0);                     // t=0 首帧，WrappedCanvas | null
    if (!frame) return null;
    return toJpegDataUrl(frame.canvas, 320);
  } catch { return null; }                                     // 失败静默保持兜底底色（非致命路径）
  finally { try { input?.dispose(); } catch { /* 已释放 */ } } // 用后即关——一次性，不进任何 LRU
}
/** 恒绘制进新 HTMLCanvasElement（≤maxW 等比缩）——不做早退返回 src：frame.canvas 是
 *  HTMLCanvasElement | OffscreenCanvas 联合（OffscreenCanvas 无 toDataURL），恒绘归一化类型。 */
function toJpegDataUrl(src: HTMLCanvasElement | OffscreenCanvas, maxW: number): string {
  const w = Math.min(maxW, src.width);
  const scale = w / src.width;
  const out = document.createElement('canvas');
  out.width = w; out.height = Math.max(1, Math.round(src.height * scale));
  out.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.7);
}
// AssetPanel addAssetToTimeline 尾部（同步函数内 fire-and-forget——不阻塞入轨交互）：
//   if (!norm.thumbnailUrl && norm.mimeType.startsWith('video/') && norm.url) {
//     void ensurePoster(norm.url).then((poster) => {
//       if (poster) useEditorStore.getState().setMediaInfo(norm.mediaId, { thumbnailUrl: poster });
//     });
//   }
// mediaInfo 不入 autosave（Shell 只订阅 s.data）——写回安全幂等（spec 批 3.2）
```

- [ ] **Step 3: 跑绿 + Commit**

```bash
git add -A apps/web/src/pages/canvas/video-editor packages/shared/src
git commit -m "feat(video-editor): 批3-4 帧缩略图 repeat-x 平铺（thumbnailUrl 白名单+常态回退取帧）+ opencut 色表 + 白波形（勘误②）"
```

### Task 11: Ctrl+滚轮 exp 缩放（锚定接线）+ 标尺窗口化

**Files:**
- Modify: `components/timeline/TimelinePanel.tsx:157-168`（wheel handler）、`timeline/view-scale.ts`（zoomFactor 常量）、`components/timeline/TimelineRuler.tsx:19-23`（窗口化）、`components/timeline/PlayheadLine.tsx:10`（`left: 140 + …` 第三处硬编码改 TRACK_HEADER_W 常量——R6 修正：140 全仓共 3 处，非 2 处）
- Test: `view-scale.test.ts` 追加、`TimelinePanel.interact.test.tsx`

> R6 修正：原列 `editorStore.ts:161`（"上限注释，不改值"）删除——该行只有 setPxPerSec 的 clamp 表达式无任何注释，是空步骤。上限 500 是否放宽由标尺窗口化后的浏览器验收承担（spec 3.4），本任务不动。

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

**坐标口径红线（评审第 3 条）**：监听容器是 `scrollRef`（TimelinePanel.tsx:32，**不是 containerRef——该名不存在**），且该滚动区首行含 140px 轨头角位（:231）——`e.clientX - rect.left` 含 140px 偏移，必须扣除，否则锚点必偏 140/pxPerSec 秒（对照：drop 路径用轨道体自身 rect 无此问题，两处口径不同勿照抄）。140 同步提常量（消除 :232 的第二处硬编码）：

```tsx
// R7-S3：TRACK_HEADER_W 声明在 timeline/view-scale.ts（非 TimelinePanel.tsx 顶部）——
// 消费方 TimelineRuler/PlayheadLine 都是 TimelinePanel 的子组件，从 TimelinePanel 导入常量会循环导入
// （可运行但脆弱）；view-scale.ts 是纯常量+纯函数模块（PlayheadLine.tsx:2 已 import timeToPx 自它），天然无环。
// view-scale.ts：export const TRACK_HEADER_W = 140; // 轨道头列宽——全仓三处硬编码统一替换：TimelinePanel:231 w-[140px] 类名、:232 widthPx={viewportW-140}、PlayheadLine.tsx:10 left:140+…（R6：第三处原漏）
const el = scrollRef.current!; // 既有监听容器（:32）
const onWheel = (e: WheelEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); // 阻浏览器缩放（capture + passive:false，监听注册保持既有方式）
  const es = useEditorStore.getState();
  const old = es.pxPerSec;
  const next = Math.min(500, Math.max(10, zoomByDelta(e.deltaY, old))); // 上限 500 暂留——标尺窗口化后评估放宽（spec 3.4）
  const rect = el.getBoundingClientRect();
  const cursorOffsetPx = e.clientX - rect.left - TRACK_HEADER_W; // 扣轨头（滚动区含 140px 角位列）
  const anchorTime = es.playhead > 0 && (Math.abs(cursorOffsetPx / rect.width) > 0.15)
    ? pxToTime(cursorOffsetPx + el.scrollLeft, old)  // 鼠标锚定（视口偏 15% 内锚播放头，opencut 阈值）
    : es.playhead;
  const { scrollLeft } = anchorZoomScroll({ scrollLeft: el.scrollLeft, anchorTime, oldPxPerSec: old, newPxPerSec: next, viewportW: rect.width - TRACK_HEADER_W });
  es.setPxPerSec(next);
  el.scrollLeft = scrollLeft; // 接线既有死代码 anchorZoomScroll（spec 3.4）
};
```

- [ ] **Step 4: TimelineRuler 窗口化**

```tsx
// :19-23 全量循环替换为视口窗口：
// ⚠ 统一口径规则（R5 必改②，三处消费共用）：凡在 scrollRef 内容坐标系里做时间↔像素换算，必须扣
// TRACK_HEADER_W——标尺局部坐标原点在内容 x=140 之后（可见区在标尺局部坐标 = [scrollLeft-140,
// scrollLeft+viewportW-140]）。滚轮（Step 3）/标尺（本处）/吸附指示线（Task 12）三条路径同源。
const ticks: number[] = [];
const visibleStart = Math.max(0, pxToTime(scrollLeft - TRACK_HEADER_W, pxPerSec) - interval); // 扣轨头列宽——不扣则左缘 140px 无刻度带（pxPerSec=10 时 14s 空白，-interval 溢出盖不住）
const visibleEnd = pxToTime(scrollLeft + viewportW, pxPerSec) + interval;              // 终点多渲 140px 冗余 tick（标尺末端实际止于 scrollLeft+viewportW-140）——无害可接受（R6 修正：原"widthPx 已隐含扣减"表述有误，实为本式未扣 140）
const endSec = Math.min(dur + interval, visibleEnd);
for (let t = Math.ceil(Math.max(0, visibleStart) / interval) * interval; t <= endSec; t += interval) ticks.push(Number(t.toFixed(4)));
// ⚠ scrollLeft 必须有响应式来源（R3 建议⑥）：scrollLeft 是 DOM 滚动位非 React state——
// TimelinePanel 在 scrollRef 上加 onScroll（rAF 节流写 state，**single-flight 守卫** R4 建议：
// 无守卫每个滚动事件排一帧 → 滚动期整条时间轴每帧重渲，窗口化省下的 DOM 又被 React 渲染吃掉）：
//   const [scrollLeft, setScrollLeft] = useState(0);
//   const rafRef = useRef(0);
//   const onScroll = () => {
//     if (rafRef.current) return;                          // single-flight：在飞帧不再排
//     rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setScrollLeft(el.scrollLeft); });
//   };
// 并把 state 透传 props + **TimelineRuler memo 化**（React.memo——scrollLeft 变化只重渲标尺，
// TrackRow/ClipBlock 不随滚动重渲）。jsdom 测试注意：jsdom 不派发滚动事件也不做真实布局，
// 窗口化用例直接给定 scrollLeft prop 断言输出，勿依赖 fireEvent.scroll 自动重算。
// Task 11 的 wheel handler 写 el.scrollLeft = scrollLeft（直接写 DOM）后，同步刷该 state
// （同一 rAF 里 set，或 el.dispatchEvent(new Event('scroll')) 触发 onScroll 路径）。
```

同步性能验收断言（interact.test）：

```tsx
it('标尺只渲染视口内刻度：900s/500pxps 视口 1000px 时刻度元素 < 300', () => {
  // 夹具 900s 工程 pxPerSec=500（interval=0.25）→ 全量 3600 个 tick div；
  // 窗口化后按组件真实刻度类名/加 data-testid 查询（⚠ 勿用 .ant-tick——那是 antd 类名空间，
  // TimelineRuler 刻度不是 antd 组件）。直接给定 scrollLeft prop（jsdom 不派发滚动事件）断言输出数量。
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

- [ ] **Step 3: 吸附指示线——TimelinePanel 拖动态渲染竖线（R6-B9 必改：必须 useState，dragRef 写入不触发重渲染）**

**R6-B9 前置事实**：拖动状态是 `dragRef`（TimelinePanel.tsx:58 useRef，DragState 是 :46-57 的 interface 类型名）——面板没有 dragState state，往 ref 写字段指示线恒不显示（且若测试直接渲染该 JSX 反而假绿）。显式新增 state 承载吸附时间，pointermove 仅在值变化时 setState（避免每帧重渲——吸附点跳变频率远低于 move 事件）：

```tsx
// TimelinePanel 组件体（dragRef 声明旁）：
const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
// onWindowPointerMove 的 move 分支内（既有 snapTime 调用处，吸附判定复用其返回的 snapped 点，无新逻辑）：
//   const snappedPoint = snapTime(...) // 既有调用——snapped 非 null 时即吸附时间
//   const nextGuide = snappedPoint?.snapped != null ? snappedPoint.time : null;
//   if (nextGuide !== snapGuideTime) setSnapGuideTime(nextGuide);   // 值变化才 set
// pointerup / pointercancel（既有清理处）：setSnapGuideTime(null)
// 轨道区 overlay 渲染：
{snapGuideTime != null && (
  <div data-testid="snap-guide" className="absolute top-0 bottom-0 w-0.5 bg-[var(--ve-accent)] pointer-events-none z-[2]"
    style={{ left: TRACK_HEADER_W + timeToPx(snapGuideTime, pxPerSec) }} />
)}
```

（**⚠ left 基准与挂载容器同源（R4 建议）**：指示线挂在含 140px 轨头的滚动内容 wrapper 内（`relative min-w-max` 那层）⇒ 必须 `+ TRACK_HEADER_W`——与 R2 修掉的滚轮 140px 偏移同类口径问题，两路径勿混。TrackRow/ClipBlock 已 memo 不受该 state 重渲影响；面板自身重渲拖拽期间已有 transient 写入，成本可接受。）

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

editorStore 加 action——**必须走既有统一入栈路径 `commit()`**（editorStore.ts:104，内部含 stopCapturing 断画布合并窗；手写 set + begin/endTransient 漏 stopCapturing 且绕过 ensureAutoEdges，评审第 11 条）。**R6 补：EditorState 接口声明一并加**（仓内惯例每个 action 都有接口声明，如 :68/:78 setPlayhead/setPxPerSec 先例）：

```ts
// EditorState 接口（:68 附近 action 声明区）：setCanvasSize: (size: CanvasSize) => void;
setCanvasSize: (size) => {
  commit((d) => {
    const clips = remapForCanvasSize(Object.values(d.clips), canvasSizeOf(d), size);
    return { ...d, canvasSize: size, clips: Object.fromEntries(clips.map((c) => [c.id, c])) };
  }, { structural: false }); // 结构不变（tracks 不动）——与 moveClip 同款 opts
},
// 调用方（EditorTopBar）无需再包 transient——commit 即完整入栈（undo 可回退比例切换）
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
      es.setCanvasSize(preset.size); // ⚠ 不包 beginTransient/endTransient（R3 必改④）——
      // setCanvasSize 内部已走 commit() 完整入栈；外层再包 transient 会双入栈（commit 先入 S0，
      // endTransient 又发现 S0!==S1 再入一次），一次切比例产生两条历史
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
- Modify: `renderer/canvas-renderer.ts:4-5,42-51,65`、`scene/subtitle-layout.ts:4-41`、`apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx:119,188-189`（R6-B10 行号修正：:119 迷你画布 backing store `canvas.width = CANVAS_W`（改）；:150 是卡片宽 316（**不改**）；aspectRatio '16 / 9' 真正落点 :188-189 node-mini-canvas）
- Test: `render-frame.test.ts`、subtitle-layout 既有测试

> **R6-B10 前置事实（已一手核实）**：scene/subtitle-layout.ts 实际导出 `SUBTITLE_SPEC`（:4-9，含 canvasW/canvasH/bottomMargin:96/maxWidth:1664/maxLines:2）与 `layoutSubtitleLines(text, style, measure)`（:16-20）——**无 layoutSubtitle 函数、无基础字号常量**（fontSize 来自 SubtitleClip.style.fontSize，默认 48 在 editorStore.ts:227）。测试与实现按下述真实口径写。

- [ ] **Step 1: 写失败测试**

```ts
// render-frame.test.ts 追加：9:16 画布下 video 片段 contain 居中（源 16:9 → 留边）
it('canvasSize 9:16 时渲染尺寸随 canvasSizeOf，源素材 contain 居中', () => {
  // 夹具 data.canvasSize = 1080×1920；渲染断言 drawImage 调用参数（mock ctx）宽高比 = min(1080/srcW, 1920/srcH) 比例
});
// subtitle-layout.test.ts 追加（真实口径：layoutSubtitleLines 第四参 canvasSize，缺省 1920×1080 既有用例语义不变）：
it('fontSize 基准 1080 高：9:16（1920 高）下 style.fontSize 48 渲染为 85.33；maxWidth 按宽比例派生', () => {
  const measure = () => 1; // 恒窄——强制逐字换行，可观测 maxWidth 语义（不必精确）
  const r = layoutSubtitleLines('测试', { fontSize: 48, color: '#fff', letterSpacing: 0 }, measure, { width: 1080, height: 1920 });
  expect(r.fontSize).toBeCloseTo(48 * 1920 / 1080);          // 85.333…（高比例）
  // lineHeight 同步高比例派生（fontSize * 1.4 * scaleH）
  expect(r.lineHeight).toBeCloseTo(48 * 1.4 * 1920 / 1080);
});
it('缺省第四参 = 既有 1920×1080 基准（既有工程 48 语义不变——spec 5.2）', () => {
  const r = layoutSubtitleLines('a', { fontSize: 48, color: '#fff', letterSpacing: 0 }, () => 1);
  expect(r.fontSize).toBe(48);   // 不传 canvasSize——基准行为逐位不变
});
```

- [ ] **Step 2: 跑红 → 实现**

canvas-renderer（基准常量保留 + 每帧参数注入——R3 建议⑦修正构造器方案）：

```ts
// ① 基准常量改名保留（不删——fontSize/maxWidth/bottomMargin 全以 1920×1080 基准定义，删了会再冒魔法数）：
export const BASE_CANVAS_W = 1920;  // 原 CANVAS_W——仅供基准换算（如 size.height / BASE_CANVAS_H）
export const BASE_CANVAS_H = 1080;  // 原 CANVAS_H
// ② canvasSize 用**每帧参数**而非构造器注入——构造器方案在播放循环里会陈旧（usePreviewPlayback
//    播放 effect 依赖 [playing, canvasRef]，播放中切比例 renderer 仍持旧尺寸，要暂停才更新）。
//    renderFrameAt 本身拿得到 data ⇒ draw 加第三参，无状态可陈旧、不改 makeFrameDeps 签名：
draw(visual, subtitles, canvasSizeOf(data)): void {   // CanvasRenderer.draw 签名扩展
  const size = canvasSizeOf(data);
  const contain = Math.min(size.width / srcW, size.height / srcH);
  // :65 字幕：const bottomMargin = 96 * (size.height / BASE_CANVAS_H); const y = size.height - bottomMargin;
}
// ⚠ R7-S5：CANVAS_W/CANVAS_H 在 canvas-renderer 内的消费点全列（机械改名会编译报错提示，但机械替换成
// BASE_* 就能编译通过且 9:16 下画错——黑边不满/中心偏移/字幕错位；四处必须改用运行时 size）：
//   :24 黑底 fillRect(0, 0, size.width, size.height)
//   :34 overlay fillRect(0, 0, size.width, size.height)（toBlack/toWhite 全屏）
//   :49 中心 translate(size.width / 2 + transform.x, size.height / 2 + transform.y)
//   :70 字幕水平中心 fillText(line, size.width / 2, ...)（:65 y 同段已在上方注释）
// CANVAS_W/CANVAS_H 仓内其余消费点（VideoEditNode 迷你预览/usePreviewPlayback 守卫）改 canvasSizeOf(data)
```

subtitle-layout（R6-B10：按实物 `layoutSubtitleLines` 改造——加可选第四参 canvasSize，缺省基准既有行为逐位不变）：

```ts
import type { CanvasSize } from '../timeline/canvas-size';
// SUBTITLE_SPEC 常量保留（maxLines 等仍消费）；函数签名扩展：
export function layoutSubtitleLines(
  text: string,
  style: SubtitleClip['style'],
  measure: (s: string, font: string) => number,
  size: CanvasSize = { width: SUBTITLE_SPEC.canvasW, height: SUBTITLE_SPEC.canvasH },
): SubtitleLayout {
  const scaleH = size.height / SUBTITLE_SPEC.canvasH;                    // 基准坐标系 1080 高（spec 5.2——既有工程 48 语义不变）
  const scaleW = size.width / SUBTITLE_SPEC.canvasW;
  const fontSize = style.fontSize * scaleH;                              // style.fontSize 语义 = 基准 1080 高像素
  const font = `${fontSize}px ${SUBTITLE_FONT}`;
  const fits = (s: string) => measure(s, font) <= SUBTITLE_SPEC.maxWidth * scaleW;  // maxWidth 按宽比例派生
  // …换行/截断循环不变（maxLines 语义不随比例变）…
  return { lines: capped, lineHeight: Math.round(fontSize * 1.4), fontSize };
}
// canvas-renderer :65 消费处：bottomMargin 改 SUBTITLE_SPEC.bottomMargin * (size.height / BASE_CANVAS_H)、
//   y = size.height - bottomMargin；绘制字号/行高取 layoutSubtitleLines 返回值（不再用 style.fontSize 原值）
```

usePreviewPlayback/PreviewPlayer：`applyCanvasSize(canvas, size.width, size.height)`——`size` 订阅 `useEditorStore((s) => canvasSizeOf(s.data))`，data 变（切比例）触发重设+重绘一帧。

VideoEditNode：`:119` 迷你播放循环的 `canvas.width = CANVAS_W; canvas.height = CANVAS_H` 改 `canvasSizeOf(projectData)`（backing store 随工程比例）；`:188-189` node-mini-canvas 的 `style={{ aspectRatio: '16 / 9' }}` 改 `aspectRatio: ${w}/${h}`（CSS 比例）+ `max-height` 约束 letterbox（卡片宽 316 固定不动、节点高度不剧变，spec 5.4）。

- [ ] **Step 3: 跑绿 + 既有渲染用例（render-frame/editorStore）+ Commit**

```bash
git add -A apps/web/src/pages/canvas
git commit -m "feat(video-editor): 批5-2 canvasSize 消费方——renderer contain/字幕 1080 基准派生/节点卡片 letterbox"
```

### Task 16: computeExportSize 取偶单点 + 码率像素量

**Files:**
- Modify: `export/precheck.ts`（码率表/estimateSizeBytes 改签名/导出 `ExportResolution` 类型）、`export/worker.ts:21,43`、`export/client.ts:4`、`export/upload.ts:5`、`api/videoProjectApi.ts:51`（**R6-B11：四处 `'720p' | '1080p'` 字面量联合全部改从 precheck 导入的 `ExportResolution` 派生**——precheck.ts:9 `keyof typeof EXPORT_BITRATES` 加 '480p' 自动扩展只对 precheck 自身生效，字面量联合不会跟动、TS 直接报错）、`components/ExportModal.tsx:133`（Radio options 加 480P）、`capabilities.ts:30`（**R6-B11 补漏：canEncodeVideo 探测硬编码 1920×1080——加可选 probeSize 参数，ExportModal 调用时传 `computeExportSize(canvasSizeOf(data), '1080p')`，9:16/21:9 工程探测尺寸不失真**）
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
  const out = computeExportSize(canvasSize, resolution);        // 按输出像素（评审第 9 条）——
  const outPx = out.width * out.height;                          // 21:9 的 480p 输出 1138×480 勿按 2560×1080 画布像素高估
  const tierPx = parseInt(resolution, 10) ** 2 * (1920 / 1080); // 档位参考像素（16:9 基准——16:9 各档结果与旧口径一致）
  return Math.round(((video * Math.max(1, outPx / tierPx) + audio) / 8) * durationSec * 1.2);
}
```

调用点同步：ExportModal 的 `estimateSizeBytes(resolution, durationSec)` → `estimateSizeBytes(canvasSizeOf(data), resolution, durationSec)`，**且 sizeBytes 的 useMemo deps 补 data**（现 :54 为 `[resolution, durationSec]`——不含 data 则 Popover 开着切比例后配额预检仍用旧尺寸，R8-N10 附）；worker :43 的 `resolution === '720p' ? 0.5 : 1` 删除，改消费主线程传入的 `targetSize`（postMessage params 加 `targetSize: { width, height }`）。**⚠ worker 侧两处必须同源（R6-B11 修正：原"三处"之一不成立——worker 无显式 VideoEncoder 尺寸配置，编码尺寸由 mediabunny CanvasSource 从 OffscreenCanvas 隐式决定，全文件已核）**：① **OffscreenCanvas 创建尺寸 = targetSize**（:46，否则导出仍是画布分辨率、metadata 报的目标值与实际不符） ② `ctx.scale(targetSize.width / size.width, targetSize.height / size.height)`（:48——逻辑坐标仍按 canvasSize 绘制，物理像素缩到 targetSize）。另 `ExportResolution` 类型从 precheck.ts 导出（`keyof typeof EXPORT_BITRATES`），client.ts/worker.ts/upload.ts/videoProjectApi.ts 四处 resolution 字段改 `ExportResolution` 引用；ExportModal Radio options（:133）加 `{ label: '480P', value: '480p' }`；capabilities 探测参数化（R7 小项②：**第二参** probeSize——现签名 `detectExportCapabilities(deps?)` 只有一参（capabilities.ts:24），ExportModal.tsx:69 现无参调用；加 `probeSize = { width: 1920, height: 1080 }` 第二参，:30 的 canEncodeVideo config 用 probeSize——默认值保既有单测不变，ExportModal :69 调用点传 `computeExportSize(canvasSizeOf(data), '1080p')` 最坏档探测）；upload 的 register 入参带 `width/height`（Task 18 后端接收）。

- [ ] **Step 3: 跑绿 + 既有 precheck 用例（18 组合 + estimate 签名变化的调用方修正）+ Commit**

```bash
git add -A apps/web/src
git commit -m "feat(video-editor): 批5-3 computeExportSize 单点（短边档位/取偶/18 组合 TDD）+ 码率像素量化 + worker targetSize + ExportResolution 四处派生 + capabilities 探测参数化"
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
// import 行（:2）同步补 Max（现无——R7 小项③）；width/height 带 @IsOptional()（与同段散文结论一致——
// 单次发版前端随后补传，必填会 400 老前端）：
import { ..., Max } from 'class-validator';
@IsIn(['480p', '720p', '1080p']) resolution!: string;
@IsNumber() @Min(0) @Max(900) durationSec!: number; // 15min 上限服务端同步（spec 5.5）
@IsOptional() @IsNumber() @Min(1) width?: number;    // 产物尺寸（metadata 存档——resolution 无法表达 9:16 的 1080×1920）
@IsOptional() @IsNumber() @Min(1) height?: number;
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

- [ ] **Step 1: 写失败测试（deps 注入——R6：不依赖 vi.stubGlobal 覆盖 navigator）**

```ts
describe('pickSaveTarget（P1-E 三态）', () => {
  const fakeRoot = () => ({ getFileHandle: vi.fn().mockResolvedValue({ name: 'export-x.mp4' }) });
  it('canceled：FSA AbortError → { kind: "canceled" }（非 null——组件级中止行为在 Task 19 测，此测纯函数）', async () => {
    const r = await pickSaveTarget('a.mp4', { deps: {
      hasFsa: () => true,
      pick: () => Promise.reject(new DOMException('aborted', 'AbortError')),
    } });
    expect(r).toEqual({ kind: 'canceled' });
  });
  it('unsupported（无 FSA）→ OPFS 随机 key 且登记 sessionOpfsKeys（R6-B12）', async () => {
    const root = fakeRoot();
    const r = await pickSaveTarget('a.mp4', { deps: { hasFsa: () => false, getOpfsRoot: () => Promise.resolve(root as never) } });
    expect(r.kind).toBe('opfs');
    expect(root.getFileHandle).toHaveBeenCalledWith(expect.stringMatching(/^export-.+\.mp4$/), { create: true });
    // sessionOpfsKeys 登记（下次导出扫描清理的依据）
  });
  it('SecurityError → onDegraded("security") 被调 + 降级 OPFS', async () => {
    const onDegraded = vi.fn();
    const r = await pickSaveTarget('a.mp4', { onDegraded, deps: {
      hasFsa: () => true,
      pick: () => Promise.reject(new DOMException('inactive', 'SecurityError')),
      getOpfsRoot: () => Promise.resolve(fakeRoot() as never),
    } });
    expect(onDegraded).toHaveBeenCalledWith('security');
    expect(r.kind).toBe('opfs');
  });
});
describe('openOpfsTarget（画布路径专用，R7-N3/R8-N8）', () => {
  it('开随机 key 的 OPFS 文件并登记 sessionOpfsKeys（deps 注入——jsdom 无 navigator.storage）', async () => {
    const root = { getFileHandle: vi.fn().mockResolvedValue({ name: 'export-x.mp4' }) };
    const { openOpfsTarget, sessionOpfsKeys } = await import('./client');
    sessionOpfsKeys.clear();
    const r = await openOpfsTarget({ deps: { getOpfsRoot: () => Promise.resolve(root as never) } });
    expect(r.kind).toBe('opfs');
    expect(root.getFileHandle).toHaveBeenCalledWith(expect.stringMatching(/^export-.+\.mp4$/), { create: true });
    expect([...sessionOpfsKeys][0]).toMatch(/^export-.+\.mp4$/); // 登记——下次导出开头扫描即清的依据
  });
});
```

- [ ] **Step 2: 跑红 → client.ts 实现（R6：deps 注入——jsdom 无 showSaveFilePicker 亦无 navigator.storage，OPFS 分支必须可注入才可测；capabilities.ts ExportCapsDeps 同款先例）**

```ts
export type SaveTarget =
  | { kind: 'fsa'; handle: FileSystemFileHandle }
  | { kind: 'opfs'; handle: FileSystemFileHandle }   // OPFS 句柄同 FileSystemFileHandle 形状（getFile/createWritable 同接口）
  | { kind: 'canceled' };
export interface SaveTargetDeps {
  hasFsa?: () => boolean;                                              // 默认 () => 'showSaveFilePicker' in window
  pick?: (suggestedName: string) => Promise<FileSystemFileHandle>;     // 默认 window.showSaveFilePicker（绑 window 调用防 this 丢失）
  getOpfsRoot?: () => Promise<FileSystemDirectoryHandle>;              // 默认 () => navigator.storage.getDirectory()
}
export async function pickSaveTarget(
  suggestedName: string,
  opts: { onDegraded?: (reason: 'security') => void; deps?: SaveTargetDeps } = {},
): Promise<SaveTarget> {
  const d = opts.deps ?? {};
  const hasFsa = d.hasFsa ?? (() => 'showSaveFilePicker' in window);
  const pick = d.pick ?? ((name: string) => (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> })
    .showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }] }));
  const getRoot = d.getOpfsRoot ?? (() => navigator.storage.getDirectory());
  const openOpfs = async (): Promise<SaveTarget> => {
    const root = await getRoot();
    const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
    sessionOpfsKeys.add(handle.name);                                  // R6-B12：本会话登记（见下）
    return { kind: 'opfs', handle };
  };
  if (!hasFsa()) return openOpfs();                                    // 非 Chromium：OPFS 中转（无需用户手势，spec 6.1）
  try {
    return { kind: 'fsa', handle: await pick(suggestedName) };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'canceled' }; // 用户取消——必须中止不回退（P1-E）
    if (e instanceof DOMException && e.name === 'SecurityError') {
      // 激活窗口耗尽/弹窗拦截（R3 必改②）——经 onDegraded 回调提示调用方（"未能打开保存对话框，已改用应用内中转"），
      // 不得与普通异常混入静默降级（用户选的保存位置被静默忽略是最差体验）
      opts.onDegraded?.('security');
    }
    return openOpfs();                                                 // 其余异常（含 SecurityError 降级）→ OPFS
  }
}
// R7-N3：画布路径专用——不弹 FSA picker 直接开 OPFS（无手势依赖，用户无需为"导出到画布"选本地保存位置）
// R8-N8：deps 注入与 pickSaveTarget 同款（jsdom 无 navigator.storage，裸调不可测——plan 自定 TDD 铁律不得自破）
export async function openOpfsTarget(deps: Pick<SaveTargetDeps, 'getOpfsRoot'> = {}): Promise<SaveTarget> {
  const root = await (deps.getOpfsRoot?.() ?? navigator.storage.getDirectory());
  const handle = await root.getFileHandle(`export-${crypto.randomUUID()}.mp4`, { create: true });
  sessionOpfsKeys.add(handle.name);
  return { kind: 'opfs', handle };
}
// R6-B12：本会话创建的 OPFS key 登记（模块级）——本地路径 a.click() 是 fire-and-forget 不能即时
// removeEntry（截断下载，R2④），成功清理延后到下次导出开头；无此 Set 则一天内连导 N 次留 N 份大文件
// （24h 年龄阈值对本会话 key 过松）。陌生 key 仍按 24h 阈值清（防误删其他标签页在飞文件）。
const sessionOpfsKeys = new Set<string>();
// OPFS 清理（画布路径成功/失败后即时调——upload 已 await 完成，无下载竞态，spec 6.1）：
export async function cleanupOpfsTarget(target: SaveTarget): Promise<void> {
  if (target.kind !== 'opfs') return;
  try { await (await navigator.storage.getDirectory()).removeEntry(target.handle.name); } catch { /* 已不存在——幂等 */ }
  sessionOpfsKeys.delete(target.handle.name);
}
// 导出开头扫描（job 启动后 fire-and-forget，Task 19 接线）：先清本会话 Set 全部 key（上次本地导出残留，
// 此时下载早已完成），再清 24h 外陌生 export-*.mp4：
export { sessionOpfsKeys };
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
- Test: `ExportModal.test.tsx` 全面改写（**R6 必改子步骤 0：先重写 mock 工厂**——现 :13-17 mock 只导出 `{ runExportJob, pickSaveFile, ExportJobError }`，改用 pickSaveTarget 后 7 个用例整批 TypeError；mock 改为导出 `pickSaveTarget`（可按用例 mockResolvedValue 三态）+ `openOpfsTarget`（R7-N3 画布路径）+ `cleanupOpfsTarget`/`sessionOpfsKeys` 空实现 + `cleanupStaleOpfsExports` 空实现；jsdom 既无 showSaveFilePicker 也无 navigator.storage，组件测试一律走 mock 不触真实现——纯函数侧已由 Task 18 deps 注入用例覆盖）

- [ ] **Step 0: 重写 ExportModal.test.tsx mock 工厂（上注）——先跑既有 7 用例确认 mock 缺口（红），再改写为 pickSaveTarget 三态 mock（组件用例按 destination/canceled/fsa 分支各配 mockResolvedValue）**

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
it('画布路径：不弹 FSA picker（直接 openOpfsTarget）→ 编码完成 getFile 上传+建节点+即时清理', async () => {
  // mock openOpfsTarget 返回 opfs 句柄 → 断言 pickSaveTarget 未被调；上传后 cleanupOpfsTarget 被调
});
it('本地路径三分支（R7-N3）：FSA → worker 直写后不 a.click 不 createObjectURL；OPFS → a[download] 且 revoke 延迟', async () => {
  // FSA：mock pickSaveTarget 返回 {kind:'fsa'} → 断言 URL.createObjectURL 未被调（双份文件防线）
  // OPFS：mock 返回 {kind:'opfs'} → createObjectURL + a.click，revokeObjectURL 在 60s 后（vi.useFakeTimers）
});
it('上传成功建节点失败 → fail 态提示 + 重试按钮仅补建节点（不重复上传）', async () => {
  // mock createProductNode throw → store.pendingProduct 记录 {mediaId, title} → 重试只调 createProductNode
});
it('成功导出后 pendingProduct 清空（R3 必改③——防重复建节点）', async () => {
  // mock 全链路成功 → expect(useEditorStore.getState().pendingProduct).toBeNull()
});
it('R8-N5 回退择源：worker 回退 Buffer（fsa:false）→ 画布路径上传 blob 而非 0 字节句柄文件', async () => {
  // mock runExportJob resolve { blob: 非空 Blob(size>0), fsa: false } + openOpfsTarget 返回 opfs 句柄
  // （其 getFile 若被调须返回 0 字节 File——用 size:0 的 new File([], 'x.mp4') 显式暴露被误用的后果）
  // 断言 uploadExportedProduct 收到的 file.size > 0（即 blob 而非 handle.getFile() 产物）——
  // 对应 client.test.ts:63 契约缝合点的组件侧闭环
});
it('R8-N7 OPFS 打开失败（Firefox 无痕 getDirectory 拒绝）→ fail 态提示而非 unhandled rejection', async () => {
  // mock openOpfsTarget reject(new Error('...')) → 断言 fail 分辙文案出现（"上次导出失败"）、
  // phase 回 config、Popover 仍可交互——而非静默（promise rejection 无 catch）
});
```

- [ ] **Step 2: 跑红 → 实现（组件骨架）**

```tsx
import { Popover, Select, Input, Progress, Button, App as AntdApp } from 'antd';
const [open, setOpen] = useState(false);          // 受控（点击导出按钮打开——R4 小项：onExport prop 已删，注释同步）
const [destination, setDestination] = useState<'canvas' | 'local'>('canvas');
const [fileName, setFileName] = useState(`${title || '导出'}.mp4`);
// R8-N7：job 失败与前置段异常（OPFS 打开等）共用同一 fail 分辙——canceled 特判收进 helper（原 :111 语义不变）
const onExportFail = (err: unknown) => {
  if (err instanceof ExportJobError && err.category === 'canceled') { setPhase('config'); return; }
  const category = err instanceof ExportJobError ? err.category : 'unknown';
  const quotaHit = /存储空间不足|配额|quota/i.test((err as Error).message); // R3-3：后端实测文案"存储空间不足"
  setFail({ category, message: quotaHit ? '存储配额在导出期间被占用，请清理团队存储后重试' : (err as Error).message });
  setPhase('config');
};
const startExport = async () => {
  if (startingRef.current) return; startingRef.current = true;   // 重入锁保留（I-1）
  try {
    // …既有守卫/precheck 不变…
    // ⚠ R7-N3 必改：句柄获取按目的地分流（原"统一 FSA 优先"与目的地语义冲突——
    //   画布+FSA：用户为"导出到画布"被迫选本地保存位置，磁盘留一份未索要的文件；
    //   本地+FSA：worker StreamTarget 已直写所选位置，再 a.click() 触发浏览器下载 = 用户拿两份文件）：
    //   · destination === 'canvas' → openOpfsTarget()（无手势依赖，不弹 picker）
    //   · destination === 'local' → pickSaveTarget(fileName, { onDegraded })（FSA 优先）
    // ⚠ 手势红线（spec D4，语义随分流收窄）：FSA picker 仅 local 路径调用，且必须在点击处理器同步链内
    //   （showSaveFilePicker 需 transient user activation ~5s 窗口，编码数分钟后的 await 链再调必抛
    //   SecurityError）。⚠ R3 必改②：手势链上不得插入任何 await（含 OPFS 残留扫描）。扫描放 job 起来之后：
    const target = destination === 'canvas'
      ? await openOpfsTarget()
      : await pickSaveTarget(fileName, { onDegraded: () => { void message.info('未能打开保存对话框，已改用应用内中转'); } }); // R7-S2：onDegraded 接线——不接线则 R3② 的"不得静默降级"端到端落空
    if (target.kind === 'canceled') { void message.info('已取消导出，未开始编码'); return; } // P1-E
    const out = computeExportSize(canvasSizeOf(data), resolution); // R8-N10：一次定义两处消费（targetSize + upload 的 width/height——原骨架此处内联、下方 out 未定义必编译错）
    const j = runExportJob({ data, resolution, mediaUrls, targetSize: out },
      { onProgress, onEta }, target.handle);
    void cleanupStaleOpfsExports(); // 编码期间顺带清理过期残留（fire-and-forget，try/catch 全包——Firefox 无痕 getDirectory 拒绝时静默跳过）
    setJob(j); setPhase('exporting'); armBeforeunload(); // ⚠ setJob(j) 必须保留（R4 必改③——现网 :101 同款；丢了则取消按钮 job?.cancel() 空转、进度区拿不到 job）
    try {
      // ⚠ R8-N5：恢复 r.fsa 择源（R7 版误删）。worker 的 createWritable() 失败（OPFS 配额耗尽/IO 错——浏览器
      // 真实可触发）会回退 BufferTarget：数据只在 blob、句柄文件仍是 {create:true} 的 0 字节。不择源则：
      // 画布/本地读 handle.getFile() 拿 0 字节静默上传/下载；本地 FSA 分支更是 blob 被丢弃、用户分文未得却见
      // "导出完成"（静默数据丢失）。既有契约：现网 ExportModal.tsx:105 `r.fsa && handle ? getFile() : r.blob`
      // （注释明示"防 0 字节静默上传"）+ client.test.ts:63 契约缝合点用例——属"既有验收资产不得回退"纪律范围。
      const r = await j.promise; // ExportJobResult { blob, fsa }——fsa 即 Task 18 diskWritable（OPFS 句柄亦真）
      if (destination === 'canvas') {
        const file = r.fsa ? await target.handle.getFile() : r.blob; // 择源——回退 Buffer 时读 blob
        const { mediaId } = await uploadExportedProduct({ ..., width: out.width, height: out.height, file });
        await publishProduct(mediaId, currentEditorProjectTitle() || '多轨剪辑'); // R3 必改③：set→create→clear 收拢一个 helper
        void message.success('导出完成，已添加到画布');
      } else if (target.kind === 'fsa' && r.fsa) {
        void message.success('导出完成，已保存到所选位置');        // R7-N3：worker 已直写——不得再 a.click()（两份文件）
      } else {
        // 本地 OPFS 中转（读回下载）**或** FSA 句柄 createWritable 失败回退 Buffer（blob 兜底下载）——
        // 两种情况都必须产出真实文件，不择源静默提示成功 = 静默数据丢失（R8-N5）
        const file = r.fsa ? await target.handle.getFile() : r.blob;
        const url = URL.createObjectURL(file);
        const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);      // 延迟 revoke——不抄同步 revoke 截断先例（spec 6.2）
        // ⚠ 本地 OPFS 路径**不在此处 cleanupOpfsTarget**——a.click() 是 fire-and-forget，浏览器还在读
        // OPFS 文件时 removeEntry 会截断下载。残留靠 sessionOpfsKeys 下次导出扫描清理（R6-B12）。
      }
      setOpen(false);
    } catch (err) {
      onExportFail(err); // canceled 特判 + quotaHit 分辙均收在 helper（原 :111 语义不变）
    }
    finally { setJob(null); disarmBeforeunload(); if (destination === 'canvas') void cleanupOpfsTarget(target); } // 画布路径即时清理（upload 已 await 无竞态；失败亦经此清不完整残留；r.fsa=false 时清 0 字节空壳无碍）
  } catch (err) {
    // ⚠ R8-N7：前置段会抛——openOpfsTarget/pickSaveTarget 内 OPFS 打开（navigator.storage.getDirectory()）
    // 在 Firefox 无痕等场景 reject；旧 pickSaveFile 是 catch { return null; } 吞一切不可能抛，新分流路径必须兜。
    // 不兜则 void startExport() 成 unhandled rejection：startingRef 已被 finally 复位（按钮恢复）但零提示零产物。
    onExportFail(err);
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
        {pendingProduct && (
          <Button data-testid="retry-product-node" onClick={() => {
            const p = useEditorStore.getState().pendingProduct!;
            void publishProduct(p.mediaId, p.title)  // 复用同一 helper（set→create→clear）
              .then(() => void message.success('产物节点已补建'))
              .catch((e: Error) => void message.error(`补建失败：${e.message}`)); // 失败留存可再试
          }}>重试（仅补建产物节点）</Button>
        )}
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
  {/* children = EditorTopBar 的导出按钮（trigger）——R3 建议⑧：归属已在下方"结构落位"定案，无实现期决策 */}
</Popover>
```

结构落位（评审第 6 条定案，不留实现期决策）：**ExportPopover 归 EditorTopBar**——`ExportModal.tsx` 导出 `ExportPopover`，内部 Popover 的 children = EditorTopBar 的导出按钮（trigger）；**删除 Shell 的 `exportOpen` state 与 EditorTopBar 的 `onExport` prop**（Popover 自管 open），Shell 不再渲染 `<ExportModal>`；`EditorTopBar.test.tsx` / `VideoEditorShell.test.tsx` 中 onExport/exportOpen 相关断言同批改写，**批 1 的 Shell 级归属断言同批把 `.ant-modal-wrap` 选择器改为 `.ant-popover`**（容器归属断言逻辑不变——否则批 6 落地留红灯）。OPFS 残留回收 `cleanupStaleOpfsExports()`（模块级：**① 先清 `sessionOpfsKeys` 全部 key（R6-B12——上次本地导出的下载早已完成，无年龄门槛；不清则一天连导 N 次留 N 份大文件）② 再迭代根目录匹配 `export-*.mp4` 且 lastModified > 24h 的陌生 key → removeEntry（24h 门槛防误删其他标签页在飞文件）**；**整体 try/catch 静默**——Firefox 无痕模式 getDirectory 拒绝，不得影响导出主流程。迭代器 TS 形态直接用兜底写法：`for await (const name of (root as unknown as { keys(): AsyncIterableIterator<string> }).keys())`——TS DOM lib 的 keys() 类型如可直接用则去强转）——在 startExport 的 job 启动后 fire-and-forget（见上方 R3 必改②），替代本地路径的即时清理，兼收上次崩溃残留。**收起编辑器语义登记**：Popover 随壳卸载、导出继续、完成建节点（R2-N12 后台完成语义保持——beforeunload 模块级守卫已在批外保留）。**R7-S6 已知行为登记**：收起后 `message.success('导出完成，已添加到画布')` 的 holder 随 AntdApp/壳卸载而不存在——完成 toast 静默丢失（产物节点照建、验收项照绿），一期接受不加兜底（改静态 message 会脱离壳作用域暗色，为一条 toast 不值得双通道）。

editorStore 补 + **publishProduct 模块级 helper**（R3 必改③：成功路径漏 clear 会让 pendingProduct 常驻 → 重试按钮常在 → 再点建重复节点。收拢一个入口，成功与重试共用）：

```ts
// editorStore（R7 小项④：state 字段与两个 action 均进 EditorState 接口声明——同 setCanvasSize 惯例）：
pendingProduct: null as { mediaId: string; title: string } | null,
setPendingProduct: (p) => set({ pendingProduct: p }),
clearPendingProduct: () => set({ pendingProduct: null }),

// ExportModal.tsx 模块级（createProductNode 抛错时 pendingProduct 留存供重试；成功即 clear）：
const publishProduct = async (mediaId: string, title: string) => {
  const es = useEditorStore.getState();
  es.setPendingProduct({ mediaId, title });        // 先落 store——create 中途抛错/弹层被收起均可重试
  createProductNode(currentEditorSourceNodeId(), currentEditorProjectId(), mediaId, title); // 同步（product-node.ts:9 返回 nodeId）——抛错自然向上传（R4 小项：删空壳 try/catch）
  useEditorStore.getState().clearPendingProduct();
};
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
- Modify: `apps/api/src/modules/video-project/generated-media.service.ts`、`video-project.dto.ts`、`temp-cleanup.processor.ts`、`temp-cleanup.module.ts`（providers 注册调度服务——**R6-B13 必改：调度注册，现状 processor 是零入队者死代码**，全仓 grep 仅 constants/module/processor 三处引用、无 producer 无 repeat 注册，不补调度则"24h TTL 回收"只是纸面功能）、`generated-media.service.spec.ts`（:28 quota mock 只有 assertCanUpload——confirm 终判接入后补 assertOnConfirm mock）、`temp-cleanup.processor.spec.ts`（:41-45 断言 `{ type:'temp', expiresAt }` where——OR 扩展后同步）
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.scheduler.service.ts`（+spec——R7-S1：镜像 subscription-scheduler.service.ts 先例的独立 @Injectable() 调度服务，remove-then-add + tz:'UTC'）
- Test: api 侧 service/processor/scheduler 测试

> **R6-B13(1) 事实更正**：R2② 原记述"Media 无 updatedAt（schema :286-309 仅 createdAt/expiresAt）"**有误**——updatedAt 在 schema.prisma:315（模型跨 286-333；type/status 为 String 非 enum，@@index([expiresAt]) 在 :330）。**复用 expiresAt 的决定保留，理由更正**：storage-quota.service.ts:15-22 的 getUsage 只统计 `status:'completed', deletedAt:null`——pending 行天然不计配额，与 updatedAt 无关；expiresAt 既有语义（临时文件过期）与 generated pending 的 24h TTL 同字段同索引，OR 扩展复用最省。

- [ ] **Step 1: 写失败测试（api）**

```ts
it('confirm 超限回滚：usage+actualSize 超限 → 删对象+删记录+抛 400（终判接入）', async () => {
  // mock quota.getUsage 接近上限；confirm → expect minio.delete 被调 + prisma.media.delete 被调 + BadRequestException
});
it('register 幂等：同 clientRequestId 返回同一条 Media（不新建行）', async () => {
  // 两次 register 同 id → prisma.media.create 仅一次，第二次返回首条
});
it('TTL 回收 generated pending：expiresAt<now 删记录+删对象；confirm 成功置 expiresAt=null 不被回收', async () => {
  // 夹具：pending generated expiresAt 1h 前 / 23h 后各一 → processor 跑后仅过期者被删且 minio.delete 被调
  // （temp-cleanup.processor.spec.ts :41-45 既有 where 断言同步为 OR 扩展形态——R6-B13(3)）
  // confirm 成功路径断言：media.update 含 expiresAt: null（completed 产物不进 24h 回收）
  // + generated-media.service.spec.ts 的 quota mock 补 assertOnConfirm（:28 现只有 assertCanUpload）
});
it('调度注册：先清旧 repeatable 再 add（镜像 subscription-scheduler 先例——R7-S1）', async () => {
  // mock Queue（getRepeatableJobs 返回一条旧记录）：onModuleInit 后
  // removeRepeatableByKey 被调（先于 add），add 被以 { repeat: { pattern: '17 * * * *', tz: 'UTC' }, jobId: 'temp-cleanup-hourly' } 调用
});
```

- [ ] **Step 2: 跑红 → 实现**

```ts
// RegisterGeneratedDto 加：@IsOptional() @IsString() clientRequestId?: string;
// register() 幂等分支——**查询必须带 status: 'pending' 约束（R4 必改①）**：
if (input.clientRequestId) {
  const existing = await this.prisma.media.findFirst({
    where: {
      metadata: { path: ['clientRequestId'], equals: input.clientRequestId },
      status: 'pending',  // 已 completed 的同 id 命中即语义错误（复用旧产物——第二次导出会静默覆盖第一次的 key 并让两节点指向同一 media）
    },
  });
  if (existing) {
    const upload = await this.minio.generatePresignedPost(existing.key, 'video/mp4', existing.size);
    return { mediaId: existing.id, upload };  // 幂等重入——同 id 同 Media 同 key（spec 批7）
  }
}
// metadata 加 clientRequestId 存档
// **前端 id 生命周期（R5 必改①修正声明位置）**：clientRequestId = "一次导出尝试"——
// ref 与 startingRef 并列声明在**组件体**（:50 旁；startExport 是事件处理器，渲染期外调
// useRef 直接抛 Invalid hook call）：
//   组件体：const exportReqIdRef = useRef<string | null>(null);
//   startExport 内：exportReqIdRef.current ??= crypto.randomUUID();  // 首次进入生成；同一次尝试内 register 重试复用
//   上传时传 exportReqIdRef.current；外层 finally（startingRef.current = false 处）exportReqIdRef.current = null;
// ⚠ 禁止组件级长期隐式复用——同会话第二次导出会命中幂等拿到第一次的 key/size：
// 上传覆盖第一次产物 + content-length-range 按首帧字节 ±1024 钉死 → 第二次重编码必超范围 → MinIO 400。
// 已知接受项（同段登记）：① findFirst+create 无唯一约束，同 id 并发双建——startingRef 前端串行化 +
// 每次导出独立 id 下实际不可达 ② metadata.path JSON 过滤走全表扫+逐行取值（无索引）——量级可控
// （单团队导出频次低），若未来成热路径需 raw SQL 表达式索引或改独立列。
// register() 写 expiresAt = now + 24h（R6 更正后理由：复用 expiresAt——getUsage 只统计 completed/deletedAt:null，
// pending 不计额；in-flight 行因 expiresAt 在未来天然不被收走；@@index([expiresAt]) :330 现成索引）：
//   prisma.media.create({ data: { ..., expiresAt: new Date(Date.now() + 24 * 3600_000) } })
// confirm() 接终判（spec 批7——导出链曾是唯一无终判通道）：
await this.quota.assertOnConfirm(media.id, actualSize, media.key, media.bucket); // 超限内部已删对象+记录并抛
// temp-cleanup.processor.ts 的过期过滤扩为 OR（不新增第二段查询——与 temp 同语义同字段）：
const expiredMedias = await this.prisma.media.findMany({
  where: {
    expiresAt: { lt: new Date() },
    OR: [{ type: 'temp' }, { type: 'generated', status: 'pending' }],
  },
  take: 1000, select: { id: true, key: true },
});
// 既有循环不动（已含 minio.delete + media.delete——generated pending 复用同删除路径）
// 注意：confirm 成功路径要把 expiresAt 置 null（completed 产物不该被 24h 回收）——media.update({ data: { status: 'completed', size: actualSize, expiresAt: null } })

// R6-B13(2) 必改 + R7-S1 修订：调度注册（现状 processor 零入队者——module 只 registerQueue 无 repeat 无 producer，死代码）。
// 仓内已有完全对应先例：modules/subscription/task/subscription-scheduler.service.ts:12-29——
// @Injectable() 独立调度服务（非 Module 类挂 OnModuleInit）+ 先 getRepeatableJobs/removeRepeatableByKey 清旧
// （注释明示"avoid duplicates on restart"——反证"BullMQ 按 name+repeat 天然幂等"不成立，勿依赖）+ tz:'UTC'。
// 镜像先例新建 temp-cleanup.scheduler.service.ts：
@Injectable()
export class TempCleanupSchedulerService implements OnModuleInit {
  constructor(@InjectQueue(TEMP_CLEANUP_QUEUE_NAME) private readonly queue: Queue) {}
  async onModuleInit() {
    // Remove existing repeatable jobs to avoid duplicates on restart（先例同款——subscription-scheduler:13-18）
    const jobs = await this.queue.getRepeatableJobs();
    for (const job of jobs) await this.queue.removeRepeatableByKey(job.key);
    await this.queue.add('temp-cleanup', undefined, {
      repeat: { pattern: '17 * * * *', tz: 'UTC' },   // 每小时（避开整点扎堆）+ tz 显式（先例同款）
      jobId: 'temp-cleanup-hourly',
    });
  }
}
// temp-cleanup.module.ts：providers: [TempCleanupProcessor, TempCleanupSchedulerService]
// processor 是 WorkerHost 子类（process(_job) 方法承接任意 job name）——无需改动承接侧。
// TDD：scheduler 单测 mock Queue——断言 removeRepeatableByKey 先于 add 被调、add 以 { repeat: { pattern, tz:'UTC' }, jobId } 调用（新 temp-cleanup.scheduler.spec.ts）。
```

前端 upload.ts 的 registerGeneratedMedia 入参带 `clientRequestId`（id 生命周期见上方 R4 必改①定案：一次导出尝试内复用、结束即清空）。

- [ ] **Step 3: 跑绿（api 全量）+ Commit**

```bash
git add apps/api/src/modules/video-project apps/api/src/modules/temp-cleanup apps/web/src/pages/canvas/video-editor/export
git commit -m "feat(video-api): 批7-1 导出链终判 assertOnConfirm + clientRequestId 幂等 + generated pending 24h TTL 回收 + temp-cleanup 调度注册（P1-D）"
```

---

## 总验收清单（浏览器，全部通过后收尾）

- [ ] 点导出 → Popover 可见且选项联动（文件名/位置/分辨率/格式 disabled）
- [ ] 目的地=画布：**不弹保存对话框**（R7-N3）→ 导出→上传→画布产物节点出现；目的地=本地：Chromium 弹保存框 → **所选位置文件完整可播且下载目录无第二份**（R7-N3：FSA 直写不 a.click）；非 Chromium → 浏览器下载完整 MP4（>1min 无截断）；**OPFS 残留验收口径 = "下次导出后无 OPFS 残留"**（R6-B12：sessionOpfsKeys 登记本会话 key、下次导出开头扫描即清；24h 阈值只管陌生 key）
- [ ] FSA picker 取消 → 提示且零编码；非 Chromium（Firefox）→ OPFS 中转导出成功
- [ ] **R8-N5 回退场景**：模拟 `createWritable()` 失败（OPFS 配额临界——大文件压一次）→ 画布上传/本地下载必须是真实非空文件，**不得产出 0 字节产物或静默数据丢失**（r.fsa 择源兜底读 blob）
- [ ] 同会话连续两次导出（均成功）：两个产物节点指向**不同** media，第二次内容不覆盖第一次（R4 必改①回归）
- [ ] 三栏拖拽调宽 + 时间轴满屏 + 刷新后尺寸保持
- [ ] 暗色主题全组件无亮色残留（antd 弹层/toast 同暗色；**BaseFullscreenModal 自身 chrome 若有标题条/关闭按钮一并目检**——壳 fixed inset-0 覆盖下不应露出亮色缝，R4 小项）
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
- **R2 修订（2026-09-12 plan 评审 14 条全采纳）**：①批 1 回归测试改真实 Shell 夹具（自证式夹具删除）②TTL 改复用 expiresAt（Media 无 updatedAt）③滚轮锚定扣 TRACK_HEADER_W=140 + scrollRef 名修正 + 提常量④OPFS 本地路径不即时清理（改导出开头扫过期）⑤placement 删 canPlaceAt 死代码（轨尾追加无重叠可能）+ 夹具写实⑥Popover 归属定案 EditorTopBar（删 Shell exportOpen/onExport）+ 补建重试按钮落地 + canceled 分支保留⑦持久化改 onLayout 自管 `{version:1, panels}`（弃 autoSaveId）⑧--ve-text-dim 专用 token（Tailwind3 var() 不支持斜杠透明度）⑨estimateSizeBytes 改输出像素⑩backgroundColor 长写 + selector 订阅⑪setCanvasSize 走 commit()（含 stopCapturing）⑫BASE_CANVAS_W/H 保留 + CanvasRenderer 构造器注入 canvasSize⑬纪律段补 shared 测试命令。⑭ResizeObserver 已 stub（test-setup.ts:17）无需处理。
- **R3 修订（2026-09-12 plan 评审二轮）**：回调 ref 合并挂载 shellRef/OPFS 扫描挪 job 后+SecurityError onDegraded/publishProduct 收拢/Dropdown 删双入栈/Panel 级 defaultSize/标尺 scrollLeft 响应式/canvasSize 每帧参数/删占位注释——8 条全采纳。
- **R5 修订（2026-09-12 plan 评审四轮 2 必改+6 小项全采纳）**：①exportReqIdRef 声明移回组件体（事件处理器内调 useRef 必抛 Invalid hook call——startExport 内只碰 .current，外层 finally 清空）②标尺窗口起点扣 TRACK_HEADER_W（140 第三处消费，固化为"scrollRef 内容坐标系换算必扣轨头"统一规则——滚轮/标尺/吸附线三处同源）。小项：Task 1 stale"并存"注意段整删（第三次清理）/OPFS 迭代器悬空引用改内联兜底写法（for await + keys() 强转）/批 3 文件表补 poster.ts（Create）与 canvas-renderer.ts（Modify）/Task 15 路径确定化/poster 桩 toDataURL 一行/幂等无索引登记接受项（与并发双建同段）。
- **R6 修订（2026-09-12 plan 评审五轮·确认版审核 14 阻断+7 事实错误+4 细节全采纳，全部断言一手复核属实）**：
  - **B1** Task 1 `<AntdApp component={false}>`（默认渲染 div.ant-app 打断壳 flex 链——flex-1 失效整页塌陷，jsdom 测不出）；backdrop-blur-sm 包含块等价性登记。
  - **B5** Task 5 锁 `react-resizable-panels@^2.1.9`（registry latest=4.12.4 API 全变：Group/Separator/像素语义；v2.1.9=2.x 末版 React18 peer ✓，停更风险登记）。
  - **B3/B4** Task 6 去 Tooltip 改原生 title（antd Tooltip 不写原生 title 属性，测试实现矛盾）+ 3 文件 10 处 getByText→getByRole 同步（getByText 不读 aria-label）。
  - **B6** Task 7 夹具影响面 2→6 文件 7 行（editorStore.test/keyframe.test/AssetPanel.test/interact.test 的 `.find(t=>t.type)!` 单轨化后 TypeError）+ api video-project.service.ts defaultProjectData 4 轨副本同步 + Shell:35 注释。
  - **B7/B14** Task 9 三种卡片形状归一化（AssetItem 是 originalName/nodeDurationSec 非 name/durationSec；团队/生成结果各不同）→ addAssetToTimeline(norm) 共用核心；drop 改道分支先判 subtitle 保持忽略（review I1 语义不被顺带废掉），用例补轨数断言防假绿。
  - **B8** Task 10 poster 工厂自建（openPosterSink/frameToCanvas 全仓不存在；实物 openMediabunnySink 形状 {canvases,dispose} 且被 worker 消费不宜动）——`CanvasSink.getCanvas(0)` + 手动缩 ≤320 宽（不依赖 CanvasSink width 选项未核实面），测试 vi.mock('mediabunny') 对齐真实 API。
  - **B9** Task 12 吸附线 useState（dragRef 写入不触发重渲染，指示线恒不显示）。
  - **B10** Task 15 实物口径：subtitle-layout 是 SUBTITLE_SPEC + layoutSubtitleLines(text,style,measure)（无 layoutSubtitle/无基础字号常量，默认 48 在 editorStore:227）——加第四参 canvasSize 缺省基准；VideoEditNode 真正落点 :188-189 aspectRatio（:150 是卡片宽 316 不改）。
  - **B11** Task 16 四处 `'720p'|'1080p'` 字面量联合改 ExportResolution 派生（client/worker/upload/videoProjectApi）+ ExportModal Radio 加 480P + capabilities.ts:30 探测尺寸参数化（原硬编码 1920×1080）+ "worker 三处同源"更正为两处（无显式 encoder config，尺寸由 OffscreenCanvas→CanvasSource 隐式决定）。
  - **B12** Task 18 sessionOpfsKeys 模块级 Set（本地路径成功清理延后到下次导出开头即清本会话 key——24h 阈值只管陌生 key；消除"一天连导 N 次留 N 份大文件"+"下次导出后无残留"验收矛盾）+ pickSaveTarget deps 注入（jsdom 无 showSaveFilePicker/navigator.storage，capabilities ExportCapsDeps 同款先例）+ Task 19 Step 0 mock 工厂重写显式子步骤（原 :13-17 只导 pickSaveFile，改后 7 用例整批 TypeError）。
  - **B13** Task 20 三处：updatedAt 事实更正（schema:315 实有——R2② 记述错误；复用 expiresAt 理由换为 getUsage 只统计 completed）+ temp-cleanup 调度注册子任务（现状零入队者死代码，module OnModuleInit 注册 hourly repeatable job + jobId 固定）+ 2 个 spec 文件入清单（processor.spec where 断言/generated spec quota mock 补 assertOnConfirm）。
  - 细节×4：editorStore:161 空注释步骤删除/140px 硬编码实为 3 处（补 PlayheadLine.tsx:10 入 TRACK_HEADER_W 替换）/标尺终点多渲 140px 表述更正/Task 14 补 EditorState 接口声明（仓内惯例）。
- **R6 已核实消解**（评审对 plan 待核实点①的收敛）：react-resizable-panels v2 DOM 属性确为 data-panel-group-id/data-panel-id（v2 已发布包核对）——Task 5 断言选择器成立，剩 onLayout 首次挂载是否触发仍留实测。
- **R7 修订（2026-09-12 plan 评审六轮·R6 修订版审核 4 阻断+6 建议+4 小项采纳，断言逐条对包类型/仓内文件一手复核）**：
  - **N1** Task 10 poster 对齐 mediabunny@1.56.1 真实 API（d.ts 核实）：getCanvas 返回 WrappedCanvas{canvas,timestamp,duration}（:5414）**非 canvas 本身**——取 `frame.canvas`；InputOptions.formats **必填**（:2518）——`new Input({source, formats: ALL_FORMATS})` 与 video-cache.ts:175 同款；toJpegDataUrl 恒绘制进新 HTMLCanvasElement（归一化 OffscreenCanvas 联合，不早退返回 src）；mock 桩同步（返回 wrapped 对象 + ALL_FORMATS 占位）——原 R6 桩与实现同错会假绿。
  - **N2** Task 9 dropIntoTrack 提升到 handleClipDrop **函数体顶部**（R6 版误放 if 块内——ESM 恒严格模式块内 function 声明是块级作用域，块外调用 Cannot find name，与自注"必须提升"矛盾）。
  - **N3** Task 18/19 句柄获取按目的地分流（原"统一 FSA 优先"两冲突：本地+FSA 直写后再 a.click=用户拿两份文件；画布+FSA=为导画布被迫选本地位置且留垃圾文件）：画布→`openOpfsTarget()` 不弹 picker（OPFS 无手势依赖）；本地→pickSaveTarget（FSA 优先），FSA 分支直写完成后仅提示不 a.click，无 FSA→OPFS+a.click+延迟 revoke。D4 手势红线语义收窄（FSA picker 仅 local 路径手势内）。验收清单本地路径口径同步（FSA=所选位置文件且下载目录无第二份）。
  - **N4** Task 7 补 `video-project.service.spec.ts:37-43`（断言默认 4 轨——全仓唯一断言默认轨的 api 测试，R6 漏列，单轨化必红）。
  - **S1** Task 20 调度改镜像仓内先例 subscription-scheduler.service.ts:12-29（独立 @Injectable() 服务非 Module 挂 OnModuleInit；**先 getRepeatableJobs+removeRepeatableByKey 清旧再 add**——先例注释反证"BullMQ 按 name+repeat 天然幂等"不成立；tz:'UTC'）。
  - **S2** Task 19 pickSaveTarget 调用点接线 onDegraded（+message.info 提示）——不接线则 R3②"不得静默降级"端到端落空。
  - **S3** TRACK_HEADER_W 声明移 timeline/view-scale.ts（原 TimelinePanel.tsx 顶部——消费方 TimelineRuler/PlayheadLine 是其子组件，循环导入；view-scale 是纯常量模块且 PlayheadLine 已 import 之）。
  - **S4** Task 5 onLayout 拖拽逐帧同步写 localStorage 改 ref 缓存 + PanelResizeHandle onDragging(false) 拖拽结束一次落盘（空写防护；"首次挂载覆盖 saved"随之无害化）。
  - **S5** Task 15 canvas-renderer 基准消费点全列 :24/:34/:49/:70（机械替换 BASE_* 能编译但 9:16 画错——黑底/overlay fillRect、中心 translate、字幕水平中心四处必须用运行时 size）。
  - **S6** 批 6 收起后完成 toast 随 AntdApp 卸载静默丢失——登记已知行为（产物节点照建；静态 message 兜底会脱离壳暗色，不为一条 toast 开双通道）。
  - 小项×4：批 2 文件表补 Task 4 实涉 5 组件 + package.json/capabilities probeSize 明确为**第二参**（现签名一参，:69 无参调用）/Task 17 代码块补 @IsOptional() 与 Max import（与散文结论一致）/pendingProduct 补 EditorState 接口声明。
  - **不采纳 1 项（理由登记；R8 理由更正）**：Task 5 断言改用 getPanelGroupElement(id) 的可选建议——`data-panel-group-id` 属性选择器已被 R7 评审对 v2 constants.d.ts（declarations/src/constants.d.ts）一手证实；R8 评审进而对 v2 index.d.ts 证实 getPanelGroupElement **确在导出清单**（原"导出可用性未经证实"表述作废）——结论不变，理由更正为**两种写法等价、属性选择器零额外导入**，保守保留属性选择器。
  - **toast 通道澄清补记（R7 第三节）**：批 1 修复同时覆盖 toast（message/useMessage.js:90 getContainer 链 + z=12010 同被壳覆盖）——Task 3 Step 2 补记为第二红点，批 2"toast 同暗色"前提成立依据。
- **R8 修订（2026-09-12 plan 评审八轮·R7 修订版审核：3 阻断+3 小项+2 实测注意+1 理由更正，全部采纳，断言逐条对仓内源码一手复核属实）**：
  - **N5（阻断）** Task 19 恢复 `const r = await j.promise; const file = r.fsa ? await target.handle.getFile() : r.blob;` 择源——R7 分流骨架误删。worker 的 `createWritable().catch(() => null)` 回退 BufferTarget 是既有设计（worker.ts:95/:113/:192 fsa 标记回传 + client.test.ts:63 契约缝合点用例 + 现网 ExportModal.tsx:105 注释"防 0 字节静默上传"——属"既有验收资产不得回退"纪律）；不择源则回退发生时画布上传/本地下载 0 字节文件、本地 FSA 分支 blob 被丢却提示成功（静默数据丢失）。三分支与 r.fsa 交叉定案：画布/本地下载分支均择源；本地 FSA 分支 `target.kind==='fsa' && r.fsa` 才直写成功仅提示，r.fsa=false 落 else 走 blob 兜底下载。验收清单补"回退场景不得 0 字节"项。
  - **N6（阻断）** Task 10 poster.test.ts 补 out canvas 桩——apps/web 未装 canvas 包，jsdom `document.createElement('canvas')` 的 getContext()/toDataURL() 均 notImplemented 返回 null；R7 的 mkCanvas 只覆盖 mediabunny mock 链路的源 canvas，覆盖不到 toJpegDataUrl 内部新建 canvas（无桩则 null.drawImage TypeError 被 catch 吞、断言必红且报错被掩盖）。桩法：createElementSpy 只劫持 canvas tag 其余 passthrough（先例 apps/web/src/hooks/useThumbnails.test.ts:62-94）+ beforeEach mockClear（模块级 vi.fn 跨用例累积）+ TDZ 注意（vi.hoisted 备选）+ mediabunny 行号出处口径统一（打包单文件 d.ts:5414/:2516 ↔ 分文件 media-sink.d.ts:178-180/input.d.ts:21-23）。
  - **N7（阻断）** Task 19 startExport 外层补 catch → onExportFail——旧 pickSaveFile 是 `catch { return null; }` 吞一切不可能抛；新 openOpfsTarget/pickSaveTarget 的 OPFS 打开（navigator.storage.getDirectory()）在 Firefox 无痕等场景 reject，不兜则 `void startExport()` 成 unhandled rejection（startingRef 被 finally 复位、按钮恢复但零提示零产物）。canceled 特判+quotaHit 分辙收进 onExportFail helper，内层（job 失败）外层（前置段异常）共用，原 :111 语义不变。Step 1 补对应用例两条（N5 择源/N7 fail 态）。
  - **N8（小）** Task 18 openOpfsTarget 加 `deps?: Pick<SaveTargetDeps, 'getOpfsRoot'>` 注入 + 补单测（随机 key 形状 + sessionOpfsKeys 登记）——裸 navigator.storage 在 jsdom 不可测，plan 自定 TDD 铁律不得自破。
  - **N9（小）** Task 5 onDragging 落盘注释"两个 handle"更正"**三个** PanelResizeHandle（水平组 2 + 垂直组 1）全部挂"——漏挂垂直组则主区/时间轴拖动永不落盘，"刷新后尺寸保持"验收漏一半；键盘 resize 是否触发 onDragging 登记待实测（Panel.onResize 兜底 flush 备选）。
  - **N10（小）** Task 19 骨架补 `const out = computeExportSize(canvasSizeOf(data), resolution);` 一次定义两处消费（原骨架 targetSize 内联、upload 处 out 未定义必编译错）；Task 16 sizeBytes useMemo deps 补 data（现 :54 `[resolution, durationSec]` 不含 data——Popover 开着切比例后配额预检用旧尺寸）。
  - **R7 修复项确认**：评审逐条独立证实 N1/N2/N4/S1/S3/S4/S5/S6+小项×4 全部准确落地（S4 的 handle 计数由本轮 N9 更正）；v2 onDragging API 签名（PanelResizeHandle.d.ts）证实成立。
- **R4 修订（2026-09-12 plan 评审三轮 3 必改+4 建议+9 小项全采纳）**：①clientRequestId 生命周期收紧"一次导出尝试"（组件级 useRef 跨导出复用会静默毁首产物——幂等命中旧 key+content-length-range 钉死必 400）+ 幂等查询加 status:'pending'②拖拽分支全形态（不兼容轨一律改道+必须早退+newTrackType 勿硬编码+dropIntoTrack TDZ 提升声明）③骨架补回 setJob(j)（取消按钮防空转）。建议：横向默认 22/56/22 和=100+saved 惰性初始化/rAF single-flight+标尺 memo/吸附线 +TRACK_HEADER_W 同源/worker 三处同源（scale+OffscreenCanvas+encoder config）。小项：ensurePoster 补 mock 单测（TDD 铁律）/stale 注释与受控注释清理/ExportResolution 随码率表自动扩展/本地路径验收口径"下次导出后无残留"/幂等并发缺口登记接受项/.ant-tick 类名勘误+jsdom 滚动限制/publishProduct 删空壳 try/catch/壳 chrome 暗色目检。**R4 已核实消解**：canvas-controls 变量名✓（index.css:17-19）、addTrack 返回 id✓（:413）、createProductNode 同步✓、open 复位五项✓（:65-70）、手势链无隐藏 await✓（:88-93）、VideoEditNode 路径=components/nodes/VideoEditNode.tsx（Task 15 git add 范围 pages/canvas 勿缩）。
- 已知实现期待核实点（R8 后剩 2 条，均无害化/非阻断）：① react-resizable-panels v2 onLayout 首次挂载是否即触发——S4 改 ref 缓存 + onDragging 落盘后，首次触发最多多 flush 一次等值数据（空写防护），不再有覆盖 saved 风险；装包后照实测登记即可。② v2 handle 键盘 resize 是否触发 onDragging（R8-N9 附注）——不触发则键盘调宽后刷新丢该次尺寸，Panel.onResize 兜底 flush 为备选修法，非阻断。DOM 属性名已由 R6/R7 两轮对 v2 发布包核实成立；mediabunny poster 接口 R7-N1 已按 d.ts 一手核实修正（frame.canvas + formats 必填），无待核实面。核实不符时以仓内实测为准并在 plan 勘误登记，不得硬套本 plan 代码。

