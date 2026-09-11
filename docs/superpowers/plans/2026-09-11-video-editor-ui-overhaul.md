# 多轨道剪辑器 UI/交互层深度改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec [2026-09-11-video-editor-ui-overhaul-design.md](../specs/2026-09-11-video-editor-ui-overhaul-design.md) 修复层级缺陷并对齐 opencut 交互质量（暗色/布局/缩略图/缩放锚定/比例/导出中转），7 批次递进。

**Architecture:** 保留 editorStore/scene/renderer/audio-engine/export 管线（与画布 Yjs 协作深度绑定），只动 UI 交互层与导出通道；opencut 以算法级移植（无直接 import）。批 1 是独立证伪实验（层级诊断对错由浏览器首验判定），后续批次依赖其结论。

**Tech Stack:** React 18 + antd 5.22.5 + Tailwind（无 preflight）+ zustand 4 + Vitest；新依赖 `react-resizable-panels`；后端 NestJS + Prisma。

**执行纪律（每个 implementer 必读）：**
- TDD 铁律：NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。每任务先写测试看红，再实现看绿。
- CLAUDE.md 四原则：编码前先思考/简洁优先/精准修改/目标驱动。不动任务清单外的代码。
- 测试命令：`cd D:/flowweb && pnpm --filter @flowweb/web test -- --run <文件路径>`（web 端）；`pnpm --filter @flowweb/api test -- --run <路径>`（api 端）；`pnpm --filter @flowweb/shared test`（shared 端）。
- **类型门（R18-G3 升格全局——原 R17-F2 只批 4+5，漏批 6/7 必填字段密集区）**：web 端每 Task「跑绿」= 该范围 vitest **+ `pnpm --filter @flowweb/web exec tsc -b`**（vitest 不做类型检查，tsconfig include:["src"] 含测试文件——「测试全绿+build/CI 红」窗口经 R10-2/R11-A6/R13① 三次咬过后全程关门；tsc -b 为 build 的轻量等价，dist/、*.tsbuildinfo 已 gitignore 无卫生风险）；每批次收尾再跑完整 `pnpm --filter @flowweb/web build`。**api 端不适用此告诫**——其 test 脚本自带 `tsc -p tsconfig.spec.json --noEmit`（package.json:8）。
- 提交信息带批次前缀，如 `feat(video-editor): 批1 层级修复——…`。
- 既有验收资产不得回退：`startingRef` 重入锁、`beforeunload` 模块级守卫、autosave flush 关闭路径。

---

## 文件结构总览

| 批 | Create | Modify |
|---|---|---|
| 1 | — | `components/VideoEditorShell.tsx`、`AssetPanel.tsx`、`ExportModal.tsx`、`PreviewPlayer.tsx` |
| 2 | — | `VideoEditorShell.tsx`、`PreviewPlayer.tsx`（+test）、`EditorTopBar.tsx`、`PropertiesPanel.tsx`、`AssetPanel.tsx`、`components/timeline/TimelinePanel.tsx`（+render/interact 两个 test——R6-B4 getByText→getByRole 同步）、`TimelineRuler.tsx`、`TrackRow.tsx`（R7 小项①：Task 4 亮→暗映射实际涉及的 5 组件此前漏列）、`apps/web/package.json`（Task 5 依赖）、`index.css`（全局，仅加编辑器段） |
| 3 | `timeline/placement.ts`（+test）、`renderer/poster.ts`（+test） | `types.ts`（shared 同步）、api 端 `video-project.service.ts`（defaultProjectData 单轨同步）、`store/editorStore.ts`、`components/AssetPanel.tsx`、`components/timeline/TimelinePanel.tsx`、`components/timeline/PlayheadLine.tsx`（140 常量）、`components/timeline/ClipBlock.tsx`、`components/timeline/TimelineRuler.tsx`、`hooks/useEditorKeyboard.ts` |
| 4+5 | `timeline/canvas-size.ts`（+test） | `types.ts`、`PreviewPlayer.tsx`、`hooks/usePreviewPlayback.ts`、`renderer/canvas-renderer.ts`、`renderer/render-frame.ts`（R9-3：draw 类型 2→3 参 + :37 传 canvasSizeOf(data)）、`export/worker.ts`（R9-4：:12/:46 常量改名同值同步；targetSize 改造在批 6 前置的 Task 16 内）、`scene/subtitle-layout.ts`、`export/precheck.ts`、`export/client.ts`、`export/upload.ts`、`api/videoProjectApi.ts`（R6-B11：resolution 联合改派生）、`capabilities.ts`（探测尺寸参数化）、`components/EditorTopBar.tsx`、`components/nodes/VideoEditNode.tsx`、api 端 `video-project.dto.ts`、`generated-media.service.ts` |
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
// 渲染真实 <VideoEditorShell /> 并 waitFor upsertProject 已调用——既有用例同款流程）。
// ⚠ R17 补记（巧合保护，勿"修复"）：该夹具 @/api/videoProjectApi 的 vi.mock 工厂（:11-16）无
// exportPrecheck 导出——Vitest 对 mock 缺失导出会抛 No "exportPrecheck" export…。现状不炸是巧合：
// jsdom 下 detectExportCapabilities()（capabilities.ts:28）首行短路 {video:false,audio:false} →
// runPrecheck 产 encoder 错误 → ExportModal.tsx:73 早退、exportPrecheck 永不被访问。日后若该用例
// mock capabilities，会以 No export 形式炸在与断言无关处——先补工厂导出再动。
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

- [ ] **Step 3: 改造 VideoEditorShell——加 ConfigProvider + AntdApp + shellRef，Shell 内 2 处静态 message 经 bridge 子组件取壳内上下文实例（R11-A4）**

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
  // ⚠ R11-A4 必改：Shell **函数体顶层不能 useApp()**——React context 按组件树祖先解析，读到的是根
  // App.tsx:15 的 AntdApp（不是下方 return 的内层 <AntdApp>）：holder 挂 document.body、亮色主题、
  // z=12010 < 壳 z-[100000]——:53 onConflict 与 :76 排空失败两条 warning 依旧被盖且批 2"toast 同暗色"
  // 对它们不成立。改 bridge：内层 <AntdApp> 下挂子组件取 useApp 存 ref，Shell 顶层经 ref 调用：
  const toastApiRef = useRef<{ warning: (m: string) => void } | null>(null); // :53/:76 的 message.warning(...) 改 toastApiRef.current?.warning(...)（onConflict/handleClose 只在 open=true 时可达，此时 bridge 必挂载，无 null 窗口）
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
            ref 未挂载首帧兜底 body（getPopupContainer 不得返回 null；即便返回 null，
            @rc-component/portal 亦以 useDom 自建默认 div 兜底而非 body——等价无害，R16 措辞登记）。
            R16 机制补强（@rc-component/portal@1.1.2 源码一手证实；Modal 经 rc-dialog DialogWrap.js:3
            消费它而非 rc-util Portal）：容器解析 = 渲染期惰性 useState 一次 + **无依赖 effect 每次渲染后
            重解析**（Portal.js:53-64）——effect 后于 ref 附加执行 ⇒ shellRef.current 已挂载，
            createPortal 直挂壳 div（:99，无中间 wrapper）＝ Task 1 归属断言的成立机理；且卸载只移除
            portal 进去的自身节点、不 removeChild 容器（该行为属老 rc-util Portal，DialogWrap.js:7-11
            issue #10656 注释）——"关闭弹层把壳从 DOM 摘掉"这一批 1 修法的最后理论隐患消除。
            ⚠ R6-B1 必改：<AntdApp> 默认渲染 <div class="ant-app">（antd es/app/index.js:22 component='div'），
            block + 高度 auto 会打断壳的 flex flex-col——flex-1/min-h-0 对非 flex 子项失效，整页布局塌陷
            （jsdom 不测布局，测试全绿但浏览器整页错乱）。必须 component={false} 渲染 Fragment（零 DOM，
            5.22.5 支持；仅 cssVar+component=false 组合有 dev 警告，本项目未启用 cssVar 无碍）。
            旁证（评审核验采纳）：BaseFullscreenModal.tsx:70 backdrop-blur-sm 会为 fixed 后代建立包含块
            与层叠上下文，但与壳同为 inset-0——实测等价，无副作用。 */}
        <ConfigProvider getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp component={false}>
            {/* R11-A4 bridge：挂在内层 <AntdApp> 之下才能取到壳作用域实例（返回 null 零 DOM）——
                组件定义放本文件模块级：function ShellToastBridge({ apiRef }: { apiRef: React.MutableRefObject<{ warning: (m: string) => void } | null> }) { apiRef.current = AntdApp.useApp().message; return null; }
                R12 注：渲染期写 ref 在 StrictMode（main.tsx:19）双渲染下幂等无害；规范写法可改
                useEffect(() => { apiRef.current = AntdApp.useApp().message; }, [])——可选，两者行为等价 */}
            <ShellToastBridge apiRef={toastApiRef} />
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
- Modify: `apps/web/src/pages/canvas/video-editor/components/AssetPanel.tsx:45,46,58,59`、`ExportModal.tsx:89,108`、`PreviewPlayer.tsx:45(Modal.confirm),55`、`hooks/shadowJob.ts:44,47`（**R11 登记2**：模块级函数非组件、useApp 不可用——加可选参 `notify?: { success(m: string): void; error(m: string): void }`，:44/:47 改 `notify?.success(...)` 形态调用；调用方 PreviewPlayer 组件内 `useApp()` 取实例传入——生成完成/失败 toast 落壳内。PreviewPlayer.ai.test:13 已整体 mock watchShadowJob，改签名不破测试；shadowJob.test.ts 四用例（:36/:51/:62/:71）均不传 notify 且不断言 message，保持绿 ✓。**R12 约束注明（有意不兜底）**：不传 notify = 静默无 toast 是显式设计——勿写成 `(notify?.success ?? message.success)(...)` 兜底，那要求保留模块级静态 message import，恰好重新打开"壳外亮色 toast"这条本批要消灭的路径；**约束**：`notify` 仅由壳内唯一生产调用方 PreviewPlayer 传入，新调用方必须自备实例）
- Test: **R11-A3 必改——"跑通为准"不成立，三个既有测试文件整批崩**：antd `es/app/context.js` 默认值是 `{ message: {}, notification: {}, modal: {} }`（无 static 回退），这些文件全部裸渲染无 `<App>` 提供者——组件改 useApp() 后：①`AssetPanel.test.tsx`（:52/58/67/77/135/155/166 裸渲染 + :22-25 mock 静态 message + :143/:159/:171 spy 断言）调用点抛 `message.error is not a function` 且 spy 永不命中；②`ExportModal.test.tsx` :79 点击走到成功分支 message.success 同抛错；③`PreviewPlayer.ai.test.tsx`（Task 2 原文件表漏列）:9-12 mock 静态 `Modal.confirm` + :94 点「片段重拍」→ 不被拦截且 `modal.confirm` 不存在 TypeError（普通 PreviewPlayer.test.tsx 不触发这两个调用，可存活）。**修法（统一 mock 上下文实例，spy 断言全保留）**：各文件的 `vi.mock('antd', ...)` 工厂补 `App: { ...orig.App, useApp: () => ({ message: { success: messageSuccess, error: messageError, **warning: messageWarning, info: messageInfo**（R14① 补——Task 19 骨架有 message.info('已取消导出…')/onDegraded message.info/`message.warning('已回退内存缓冲…')` 三处非 success/error 通道，只 stub 两键则 canceled/降级/回退用例先撞 is not a function 掩盖真断言） }, modal: { confirm: confirmMock } }) }`（ExportModal.test 原无 antd mock，新增同款工厂——组件用的 Modal/Radio/Progress/Button 经 `...orig` 保真）；无需 `<AntdApp>` provider 包装（useApp 已被覆写）。**R12 注**：对象展开会丢 App 函数的 [[Call]]（变成普通对象）——三文件均不渲染 `<App>` 故现状可跑（`{ ...orig.App }` 能拷到 useApp 自有可枚举属性 ✓ 覆盖思路成立）；若后续测试需渲染 `<App>` 本体，改 `Object.assign(function App() {}, orig.App, { useApp })` 保可调用性

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

- [x] **Step 1: 确认 dev 服务运行（preview_start api/web），打开 http://localhost:5173/canvas 建画布，添加「多轨道剪辑」节点，进全屏编辑，添加任一素材到轨道，点「导出」按钮**

✅ 2026-09-12 验收通过（preview 工具实测）：`.ant-modal-wrap` 存在且 `closest('[data-testid="video-editor-shell"]')` 非 null（containerInShell=true）、弹层 464×215 完整可见（清晰度/时长/体积/按钮全渲染）——z-index 诊断**未被证伪**，后续批次放行。

预期：**导出弹层完整可见**（在编辑器之上）。若仍不可见 → **先查容器归属再判 z-index（R11-B13 前置断言）**：`document.querySelector('.ant-modal-wrap').closest('[data-testid="video-editor-shell"]')` 是否非 null——（R16 修正：**Modal 走 @rc-component/portal，每渲染后重解析容器、自愈——initRef 一次性解析闩锁不适用于 Modal**，弹层在壳首次 commit 时已是打开态也会在下一次渲染后自愈归壳，本步前置断言比原记述更安全；闩锁只存在于 rc-trigger 系弹层（Popover/Dropdown/Select/Tooltip）——批 6 Popover 化后的浏览器验收保留此防：验收夹具若初始即开，容器可能恒落 body 造成夹具假象）；容器确在壳内仍不可见才是 z-index 诊断被证伪 → 立即停止后续批次，回报诊断修正（检查方向：BaseFullscreenModal 的 portal 层、antd Modal wrap 的实际 z-index computed style）。

- [x] **Step 2: 验证片段重拍 confirm 与 toast 可见（选中带源视频片段点「片段重拍」→ confirm 弹层可见；上传一个素材 → 成功 toast 可见且为白底之外的正常样式）**

✅ 2026-09-12 验收：**toast 实测通过**——上传 accept-test.png 后「上传完成」toast 可见（visible=true）且挂载壳内（inShell=true，走 Task 2 改造后的 useApp 上下文实例通道）。**confirm 以机制等价论证**：测试画布无 AI 产物节点（团队素材/上传素材均无 sourceNodeId，canRetake 恒 false），业务前置不可达；modal.confirm 与已实测的 Modal 共用 getPopupContainer 链、与已实测的 toast 共用 AntdApp holder 机制（两条实测链路的交集不可能单独失效），调用行为另有 PreviewPlayer.ai.test.tsx jsdom 单测锁定。遗留：总验收（批 6 后）若画布已有产物节点，顺手补一次真实 confirm 可见性目检。

> **toast 也依赖批 1（R7 第三节核实补记；R11-B8 z-index 数字口径修正）**：修复前 message 同样不可见——antd message 经 `useMessage` 的 `getContainer: () => staticGetContainer?.() || getPopupContainer?.() || document.body`（message/useMessage.js:90，getPopupContainer 取自 ConfigContext），z-index = `zIndexPopupBase + CONTAINER_MAX_OFFSET + 10`（message/style/index.js prepareComponentToken，亲验）——**上下文实例路径**（根 ConfigProvider zIndexPopupBase:11000）= 12010；**静态 message 路径**自建 ConfigProvider 的 theme 取 `global.getTheme()`（本仓无全局静态配置恒 undefined）→ 默认 base 1000 = 2010。两值均 < 壳 z-[100000]，"被壳覆盖"结论不变（devtools 排查时静态路径找 2010，勿只找 12010）。批 1 的 getPopupContainer 一落地 toast 容器即归壳内 → 可见，且处于暗色 ConfigProvider 内 → 批 2"toast 同暗色"前提成立。本步是批 1 的**第二红点**（证伪 z-index 诊断的双通道验证）。

- [x] **Step 3: 验收记录写回本文件勾选 +Commit（空提交或勾选提交）**

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
- `bg-[#F7F8FA]`（Shell:87、PreviewPlayer.tsx:62——**R12 补第二处括注**：同类名两处，原只列 Shell 靠规则隐式覆盖 PreviewPlayer，逐文件核对易漏）→ `bg-[var(--ve-bg)]`
- `border-[#E5E7EB]` → `border-[var(--ve-border)]`
- **R12 补两条规则（原映射仍漏 6 处——恰好是最显眼的一类）**：`border-[#F2F3F5]`（分隔线：AssetPanel:32、TimelinePanel:218、TrackRow:31——暗底上近白细线横贯面板头/工具行/每条轨道行）→ `border-[var(--ve-border)]`；`hover:bg-[#F7F8FA]`（AssetPanel:79/:105/:137 行悬停——鼠标扫过即闪白）→ `hover:bg-[var(--canvas-controls-hover)]`（**复用 index.css:20 既有 token，勿新增**）
- `text-[#1F2329]` → `text-[var(--ve-text)]`
- `text-[#4E5969]` → `text-[var(--ve-text)]`（次要文字同主文字——勿用斜杠透明度写法，淡化场景一律 --ve-text-dim）
- `text-[#86909C]` → `text-[var(--ve-text-dim)]`（专用 token——**禁用 `text-[var(--ve-text)]/60` 斜杠写法**，Tailwind3 对 var() 无法解析透明度通道）
- `bg-[#1F2329]`（导出按钮）→ `bg-[var(--ve-accent)]`
- **R11 补三条色值规则（原映射漏列——不补则"无亮色残留"验收自相矛盾）**：`bg-[#FAFBFC]`（轨头/角位底：TimelinePanel:231、TrackRow:33）→ `bg-[var(--ve-panel)]`；`bg-[#F2F3F5]`（AssetPanel :80/:106/:138 缩略图占位底）→ `bg-[var(--ve-border)]`；`text-[#C9CDD4]`（占位/禁用文字：AssetPanel:91/:117、PreviewPlayer:85、PropertiesPanel:23/:75——亮色下比 86909C 更淡的一档，暗色归并同 token）→ `text-[var(--ve-text-dim)]`；`bg-[#C9CDD4]`（TimelineRuler:47 刻度线）→ `bg-[var(--ve-border)]`
- **R17-F8 补一条**：`text-[#722ED1]`（AssetPanel.tsx:35「+ 新建」链接——R12 曾归"语义色不动"，但 rgb(38,38,38) 底上对比度 ≈2.4:1 明显暗于其余强调色，同族统一零风险）→ `text-[var(--ve-accent)]`。登记：轨头 bg-[#FAFBFC] 与轨体 bg-white 同映射 --ve-panel 后同色（仅 1px 右边框区分）——可接受（亮色下亦只 1 级灰差），不另设档
- 涉及文件：`EditorTopBar.tsx`、`PreviewPlayer.tsx`（含控制条 :75）、`PropertiesPanel.tsx`、`AssetPanel.tsx`、`TimelinePanel.tsx`、`TimelineRuler.tsx`、`TrackRow.tsx`、**`ExportModal.tsx`（:132/:135/:156——类名 text-[#1F2329]/text-[#86909C] 已被上列规则覆盖，但原文件清单漏列该文件，R11 补）**、**`timeline/ClipBlock.tsx`（:69 text-[#4E5969]、:82 bg-white——同前，规则已覆盖、清单漏列，R11 补）**

- [ ] **Step 3.5: 非类名通道——color-scheme（R12 必改，jsdom 抓不到、只在浏览器验收"无亮色残留"暴露，现在补成本≈0）**

全仓无 `color-scheme` 声明（src grep 0 命中；antd 5.22.5 暗色算法只改 token 不写 color-scheme；preflight 关闭无 base 层兜底）——两处后果：
1. **PropertiesPanel.tsx:136-138 原生 `<textarea>`（字幕文本）**：className 只有 `w-full text-[12px] border …` 无 bg/文字色——UA 样式表对表单控件给 `background-color: field; color: fieldtext`（**不继承**父级），亮色 scheme 下暗面板中央一个纯白输入框（Switch/Slider/InputNumber 走 antd darkAlgorithm 无碍，AssetPanel 搜索框是 antd Input ✓，只此一个原生控件中招）。
2. **滚动条**：AssetPanel:64 / TimelinePanel:228 / PropertiesPanel:81 的 `overflow-*-auto` 在亮色 scheme 下渲染浅色滚动条。

修法（一行 + 双保险）：壳根 div（Shell:87 那次替换的同一行）className 追加 **`[color-scheme:dark]`**（Tailwind 任意属性，可继承、作用域天然收在壳内——**勿写 :root**，会外溢全站与文件表"index.css 仅加编辑器段"自相矛盾）；PropertiesPanel textarea 补 `bg-[var(--ve-panel)] text-[var(--ve-text)]` 作双保险。

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
// onDragging（R8-N9：只挂两个则垂直方向拖动永不落盘，"刷新后尺寸保持"验收漏一半；R9-7：prop 必须写进
// 下方 JSX 三行——注释对代码错是 R7-N2 同款形态，实现者照抄代码块即漏）。键盘 resize 是否触发 onDragging
// 未经证实——实现期键盘调宽后若刷新丢尺寸，在 Panel 的 onResize 兜底 flush（登记待实测，非阻断；**R13 补**：PanelGroup 另有 `keyboardResizeBy` prop——v2 发布包 PanelGroup.d.ts 亲证，键盘不落盘时优先查它而非直接加兜底）。

<div className="flex flex-1 min-h-0">
  <PanelGroup direction="vertical" id="ve-vertical" onLayout={saveLayout('ve-vertical')}>
    {/* ⚠ v2 的尺寸 prop 属于 Panel，PanelGroup 无 defaultSize（R3 必改⑤）——
        恢复布局 = 把保存的尺寸数组按序映射回各 Panel 的 defaultSize。
        ⚠ R4：横向三档默认和必须 =100（20+48+22=90 会右侧留缝）——定 22/56/22 */}
    <Panel defaultSize={saved?.panels['ve-vertical']?.[0] ?? 70} minSize={30}>
      <PanelGroup direction="horizontal" id="ve-horizontal" onLayout={saveLayout('ve-horizontal')}>
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[0] ?? 22} minSize={15} maxSize={40}><AssetPanel /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[1] ?? 56} minSize={30}><PreviewPlayer /></Panel>
        <PanelResizeHandle className="w-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-col-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
        <Panel defaultSize={saved?.panels['ve-horizontal']?.[2] ?? 22} minSize={15} maxSize={40}><PropertiesPanel /></Panel>
      </PanelGroup>
    </Panel>
    <PanelResizeHandle className="h-1 bg-[var(--ve-border)] hover:bg-[var(--ve-accent)] transition-colors cursor-row-resize" onDragging={(isDragging) => { if (!isDragging) flushLayout(); }} />
    <Panel defaultSize={saved?.panels['ve-vertical']?.[1] ?? 30} minSize={15} maxSize={70}><TimelinePanel /></Panel>
  </PanelGroup>
</div>
```

说明：R7-S4 后 onLayout 只写 ref 不落盘（避免拖拽逐帧同步 localStorage 卡顿），落盘集中在 onDragging(false)（拖拽结束）——首次挂载若触发 onLayout 也只进 ref，拖拽未发生则 flushLayout 空写防护（pendingSizes 空 Map 早退），"首次回调覆盖 saved"问题随之消解；onLayout 首次挂载是否触发仍留装包实测登记（无害化——最多多 flush 一次等值数据）。

同步改动：
- `TimelinePanel.tsx` 的 `h-[280px]` 固定高删除——**R11-A8：共三处**（:216 ready 分支、:209 loading 分支、:204 error 分支，原清单只列 :216，漏两处则对应态高度仍钉死）（Panel 提供高度，内部 `flex flex-col min-h-0` 自适应）
- **R11-A8 高度链防御（jsdom 测不出布局，浏览器实测收口）**：react-resizable-panels v2 的 Panel 自身是面板组的 flex item（flexBasis/flexGrow/overflow:hidden），**不是 flex 容器**——直接子节点上的 `flex-1 min-h-0` 无 flex 上下文，TimelinePanel/PreviewPlayer 内容会缩到内容高、批 2 验收"时间轴满屏"失败。各 Panel 的内容根（TimelinePanel.tsx:216 该 div、PreviewPlayer 根、AssetPanel/PropertiesPanel 根）一律加 `h-full`（对 Panel 显式 `style={{ display: 'flex', flexDirection: 'column' }}` 为备选——装包后浏览器实测二选一，h-full 无害先行）
- `AssetPanel.tsx:31` 的 `w-[260px] shrink-0`、`PropertiesPanel.tsx:74/81` 的 `w-[280px] shrink-0` 删除（Panel 控宽）
- TimelinePanel 视口测量：**已有 ResizeObserver 维护 viewportW state（:38-44 effect，G9 注释——R13 勘误：原写 :34-38）——无需改动**；`:232 widthPx={viewportW - 140}` 契约保留（140 提常量见批 3 Task 11）

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
- Test: `PreviewPlayer.test.tsx`（断言图标按钮）+ 既有断言同步：`components/timeline/TimelinePanel.render.test.tsx:59-62`、`components/timeline/TimelinePanel.interact.test.tsx:101,110`、**`PreviewPlayer.test.tsx:105`（`getByText('删除')`——R11-B2 补，原"10 处"漏计）**（R6-B4 + R11-B2：**11 处** getByText 改 getByRole——getByText 不读 aria-label，图标化后文字节点消失必红；执行时对'撤销'/'重做'/'分割'/'删除'四词全量 grep 兜底）

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

三个文件 11 处（R11-B2 修正：原 10 处漏 PreviewPlayer.test.tsx:105）`getByText('撤销'/'重做'/'分割'/'删除')` → `getByRole('button', { name: '撤销' })` 等（aria-label 承接可查性）：
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
> ① `PropertiesPanel.test.tsx:15-28`（tracks[2] :21-22 / tracks[1] :27-28）② `TimelinePanel.render.test.tsx:11-18`（tracks[1] :12 / tracks[2] :14,:18）③ `store/editorStore.test.ts:64,184` ④ `store/editorStore.keyframe.test.ts:52,63,91` ⑤ `components/AssetPanel.test.tsx:117,:126`（**R11-A5 补 :117**——`querySelector('[data-track-type="subtitle"]')!` 单轨化后为 null，:122 `fireEvent.drop(null)` 直接 TypeError，**在 plan 原列的 :126 之前先炸**，只改 :126 到不了断言；:117/:126 本用例两处都要按单轨夹具改写）⑥ `components/timeline/TimelinePanel.interact.test.tsx:119`。
> 不受影响（已核）：`renderer/render-frame.test.ts:22-28` 自建 tracks 字面量、`scene/interpolate.test.ts:193` 自行覆写 tracks[0]；api 侧 `video-project.dto.spec.ts:10` 自带 tracks:[] 不受影响。**R18 补（审核侧 114 命中逐条复核追加）**：`store/keyframe-ui.test.tsx`、`components/PreviewPlayer.test.tsx`、`components/VideoEditorShell.test.tsx` 只用 tracks[0]（视频轨单轨化后仍存在）安全；`PreviewPlayer.ai.test.tsx:70` 自带 `filter(t => t.type !== 'subtitle')` 自归一化（单轨后成空操作仍绿）——免实现者重复排查。
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
    const r = placeAssetInTrack(d, { mimeType: 'video/mp4' });
    expect(r.trackId).toBe(d.tracks[0].id);
    expect(r.start).toBe(0);
    expect(r.createNewTrack).toBe(false);
  });
  it('无音频轨时放音频 → 标记建轨；轨尾口径 = 该轨 max(start+duration) 而非全局时长', () => {
    const d = createDefaultProjectData();
    // 视频轨已有 0-10s 片段（全局时长 10）
    d.clips.c1 = { id: 'c1', trackId: d.tracks[0].id, type: 'video', start: 0, duration: 10, sourceStart: 0, mediaId: 'm', playbackSpeed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: [] } as never;
    d.tracks[0].clips.push('c1');
    const r = placeAssetInTrack(d, { mimeType: 'audio/mp3' });
    expect(r.createNewTrack).toBe(true);   // 无音频轨 → 建
    expect(r.start).toBe(0);               // 新轨从 0
    // 显式补建音频轨 + 一条 0-3s 片段（不依赖 addTrack——纯函数测试直接构造数据）：
    const d2: ProjectData = { ...d, tracks: [...d.tracks, { id: 'ta', type: 'audio', name: '音频1', muted: false, hidden: false, clips: ['a1'] }], clips: { ...d.clips, a1: audioClip('a1', 0, 3, 'ta') } };
    const r2 = placeAssetInTrack(d2, { mimeType: 'audio/mp3' });
    expect(r2.createNewTrack).toBe(false);
    expect(r2.trackId).toBe('ta');
    expect(r2.start).toBe(3);              // 该轨轨尾 3，而非全局 10（轨尾口径用例）
  });
  it('mimeType 三分类：video/* 与 image/* → video 轨，audio/* → audio 轨', () => {
    const d = createDefaultProjectData();
    expect(placeAssetInTrack(d, { mimeType: 'image/png' }).trackId).toBe(d.tracks[0].id);
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
export function placeAssetInTrack(data: ProjectData, asset: { mimeType: string }): PlacementResult { // R13：删 durationSec 死参——实现体只按 mimeType 选轨 + 轨尾 max 算起点，从不读时长；且原必填签名与 drop 调用（payload.durationSec?: number，TimelinePanel:178）TS2345
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
  const placement = placeAssetInTrack(es.data, { mimeType: norm.mimeType }); // R13：durationSec 死参已删
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
  const p = placeAssetInTrack(es.data!, { mimeType: payload.mimeType }); // R13：原传 payload.durationSec（?: number）给必填参必 TS2345；死参已删
  dropIntoTrack(p.createNewTrack ? es.addTrack(p.newTrackType!) : p.trackId, e);
  return; // ← 关键：不兼容轨绝不继续走原（被悬停轨）trackId 分支
}
dropIntoTrack(trackEl.dataset.trackId!, e); // 兼容路径不变
```

- [ ] **Step 3: 跑绿 + 既有交互用例全绿 + Commit**

> **R13 登记（已知行为，非阻断）**：一次点击入轨 = addTrack + addClip 两次 commit → 撤销需按两次 Ctrl+Z——登记接受（合并单次入栈需动 history API，收益不成比例；审核已确认非阻断）。

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
  // ⚠ R17-F1（jsdom 25 实测）：CSSOM 序列化 url 值带双引号（读回 'url("http://x/t.jpg")'）——
  // backgroundImage 只断 toContain('url(')，勿写完整无引号 URL；backgroundRepeat/backgroundSize
  // 逐字保留可精确断言（实测）
});
it('轨道色表：subtitle #5DBAA0 / audio #8F5DBA / video 兜底 var(--ve-track-video)（opencut 色表，勘误②；R11-B12；R17-F1 断言口径修正）', () => {
  // R11-B12：video 兜底实现走 index.css token（--ve-track-video: #1f1f1f）——jsdom 不解析 CSS 变量，
  // style.backgroundColor 即字符串 'var(--ve-track-video)'，**断言 #1f1f1f 必红**。
  // ⚠ R17-F1（jsdom 25 实测）：CSSOM 会把 hex 归一成 rgb()——el.style.backgroundColor 写 '#5DBAA0'
  // 读回 'rgb(93, 186, 160)'、'#8F5DBA' 读回 'rgb(143, 93, 186)'，**直接断言 hex 字面量必红**
  // （R11-B12 只修对了 var() 半边；var(--ve-track-video) 原样保留实测确认）。写法：优先
  // toHaveStyle({ backgroundColor: '#5DBAA0' })（jest-dom 两侧过 CSSOM 归一，hex 可用——
  // test-setup.ts:1 已注册 matcher）；或直接断 'rgb(93, 186, 160)'/'rgb(143, 93, 186)'。
  // video 断言 'var(--ve-track-video)'（原样字符串，精确比较可用）
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
//       // ⚠ R11-A2：MediaInfo 的 name/durationSec 是必填（editorStore.ts:17）——只传 { thumbnailUrl } 必 TS2345；
//       // 且 setMediaInfo 的 ...info 展开（:172-177）只兜底 url/mimeType/durationSec 三字段不兜 name，
//       // 若为图省事把 name 改可选会把已有记录的 name 擦成 undefined。写回带全原字段（与 drop 路径
//       // TimelinePanel.tsx:189-193 的 setMediaInfo 同构——R12 勘误：原注引"plan :526"是本文件行号，随修订漂移且指向空行）：
//       if (poster) useEditorStore.getState().setMediaInfo(norm.mediaId, {
//         name: norm.name, durationSec: norm.durationSec, url: norm.url, mimeType: norm.mimeType, thumbnailUrl: poster,
//       });
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
- Modify: `components/timeline/TimelinePanel.tsx:157-168`（wheel handler）、`timeline/view-scale.ts`（zoomFactor 常量）、`components/timeline/TimelineRuler.tsx:19-23`（窗口化）、`components/timeline/PlayheadLine.tsx:10`（TRACK_HEADER_W 全仓 **4 处硬编码**之一——TimelinePanel:231/:232、PlayheadLine.tsx:10、TrackRow.tsx:33 `w-[140px]` 轨头列类名，见 Step 3 统一口径段；R18-G7 简化原「R6 修正 3 处、R11-B1 更正 4 处」绕表述）
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

**坐标口径红线（评审第 3 条）**：监听容器是 `scrollRef`（TimelinePanel.tsx:32，**不是 containerRef——该名在 TimelinePanel 内不存在**（R11-B7：containerRef 全仓另有 11 文件在用，勿全局替换/误删），且该滚动区首行含 140px 轨头角位（:231）——`e.clientX - rect.left` 含 140px 偏移，必须扣除，否则锚点必偏 140/pxPerSec 秒（对照：drop 路径用轨道体自身 rect 无此问题，两处口径不同勿照抄）。140 同步提常量（**R11-B1：全仓硬编码实为 4 处**——原"三处"漏 TrackRow.tsx:33 的 `w-[140px]` 轨头列类名，不补则 TRACK_HEADER_W 非单点、轨头/角位/标尺/播放头四者错位）：

```tsx
// R7-S3：TRACK_HEADER_W 声明在 timeline/view-scale.ts（非 TimelinePanel.tsx 顶部）——
// 消费方 TimelineRuler/PlayheadLine 都是 TimelinePanel 的子组件，从 TimelinePanel 导入常量会循环导入
// （可运行但脆弱）；view-scale.ts 是纯常量+纯函数模块（PlayheadLine.tsx:2 已 import timeToPx 自它），天然无环。
// view-scale.ts：export const TRACK_HEADER_W = 140; // 轨道头列宽——全仓 4 处硬编码统一替换（R11-B1）：TimelinePanel:231 w-[140px] 类名、:232 widthPx={viewportW-140}、PlayheadLine.tsx:10 left:140+…（R6：第三处原漏）、TrackRow.tsx:33 w-[140px] 类名（R11：第四处原漏）
const el = scrollRef.current!; // 既有监听容器（:32）
const onWheel = (e: WheelEvent) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  // ⚠ R14④：TimelinePanel 的 view-scale import 需追加 zoomByDelta、anchorZoomScroll、TRACK_HEADER_W
  //   （现有导入仅 pxToTime/quantizeTime 等——下文三处消费不追加 import 必 TS2304）
  e.preventDefault(); // 阻浏览器缩放（capture + passive:false，监听注册保持既有方式）
  const es = useEditorStore.getState();
  const old = es.pxPerSec;
  const next = Math.min(500, Math.max(10, zoomByDelta(e.deltaY, old))); // 上限 500 暂留——标尺窗口化后评估放宽（spec 3.4）
  const rect = el.getBoundingClientRect();
  const cursorOffsetPx = e.clientX - rect.left - TRACK_HEADER_W; // 扣轨头（滚动区含 140px 角位列）
  const anchorTime = es.playhead > 0 && (Math.abs(cursorOffsetPx / rect.width) > 0.15)
    ? pxToTime(cursorOffsetPx + el.scrollLeft, old)  // 鼠标锚定（视口偏 15% 内锚播放头，opencut 阈值）
    : es.playhead;
  const { scrollLeft: nextScrollLeft } = anchorZoomScroll({ scrollLeft: el.scrollLeft, anchorTime, oldPxPerSec: old, newPxPerSec: next, viewportW: rect.width - TRACK_HEADER_W }); // R18-G5：解构改名 nextScrollLeft——防遮蔽 Step 4 新增的组件级 scrollLeft state（合法但极易误用）；viewportW 是既有签名死参（view-scale.ts:62-63 实现未消费——R17-F6 登记）：传参无害，勿在注释/验收里赋予它语义
  if (next === old) return; // R19③：clamp 端（10/500）zoomByDelta 回弹同值——zustand 同值不通知 → layout effect 不跑 → pending 残留；此后 pxPerSec 经非滚轮路径变化（loadProject/reset 重置 80，editorStore.ts:134/:154）时旧 scrollLeft 被套用一次。⚠ guard 必须在 pendingScrollLeftRef 赋值**之前**——return 后 ref 不留值
  pendingScrollLeftRef.current = nextScrollLeft; // R17-F3：**不在此处同步写 el.scrollLeft**——此刻 React 未重渲、内容宽仍是旧 pxPerSec 布局，放大时目标 scrollLeft 被浏览器 clamp 到旧 scrollWidth-clientWidth → 靠右端放大锚点漂移（jsdom scrollLeft 恒 0 测不出；批 3 浏览器验收「光标处锚定缩放」覆盖此路径）
  es.setPxPerSec(next);
};
// ⚠ R18-G2：TimelinePanel.tsx:1 的 React import 追加 useLayoutEffect（现只有 useCallback/useEffect/
//   useMemo/useRef/useState——照抄下方代码块不补 import 必 TS2304/Vitest ReferenceError，R14④ 漏 import 同型）。
// 组件体：const pendingScrollLeftRef = useRef<number | null>(null);
// ⚠ R19③：setScrollLeft/scrollLeft state 的声明在 Step 4 注释块——与 Step 3 同批落地（逐步执行先落
//   Step 3 引用未声明 state 会 TS2304，勿误判为"R18-G1 改错了"）。
// 提交后落（useLayoutEffect——DOM 已按新 pxPerSec 布局，写入不被 clamp；接线既有死代码 anchorZoomScroll，spec 3.4）：
//   useLayoutEffect(() => {
//     if (pendingScrollLeftRef.current != null && scrollRef.current) {
//       scrollRef.current.scrollLeft = pendingScrollLeftRef.current;
//       setScrollLeft(pendingScrollLeftRef.current); // R18-G1：同一 effect 内同步刷标尺窗口化 state——否则缩放那一帧用「新 pxPerSec+旧 scrollLeft」算窗口错一帧（靠浏览器异步 scroll 事件自愈不可靠）；ref 置空后原生 scroll 事件回写同值被 React bailout 吞，无回环
//       pendingScrollLeftRef.current = null;
//     }
//   }, [pxPerSec]);
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
// R18-G1 改述（原「wheel handler 直接写 DOM 后 rAF/dispatchEvent 同步刷」段已过期——Step 3 改
// pendingScrollLeftRef + useLayoutEffect 后不存在该路径）：scrollLeft state 的刷新在 Step 3 的
// layout effect 内同步 setScrollLeft(pending) 完成；此后程序化写 scrollLeft 引发的原生 scroll 事件
// 会再走既有 onScroll（rAF single-flight）——回写同值被 bailout 吞、无额外渲染。jsdom 不派发滚动
// 事件，窗口化用例直接给定 scrollLeft prop 断言，勿依赖 fireEvent.scroll 自动重算。
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
// R14③：守卫必须用 ref 镜像——onWindowPointerMove 注册于 useEffect(..., [])（:143-153）是首渲闭包，
// 函数体内读 state snapGuideTime 恒为首值 null ⇒ "if (nextGuide !== snapGuideTime) set" 恒真、守卫无效
// （实际靠 React 对同值 setState 的 bailout 兜住不重渲——但归因不能写错）。ref 镜像存上一次值：
const snapGuideRef = useRef<number | null>(null);
// onWindowPointerMove 的 move 分支内、es.moveClip(...)（:124）之前（既有 snapTime 调用处，无新逻辑）：
//   R14③：真实绑定名是 snapped（:110 `const snapped = snapTime(...)`）——勿写 snappedPoint（照抄 TS2304）
//   const nextGuide = snapped.snapped != null ? snapped.time : null;  // SnapResult{time, snapped} 非 nullable（view-scale.ts:34）
//   if (nextGuide !== snapGuideRef.current) { snapGuideRef.current = nextGuide; setSnapGuideTime(nextGuide); }
// pointerup / pointercancel（既有清理处）：snapGuideRef.current = null; setSnapGuideTime(null);
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

> **R17-F2 类型门（本批全部 Task 的"跑绿"步骤追加）**：`cd D:/flowweb && pnpm --filter @flowweb/web build`（tsc -b 的 include:["src"] 含测试文件）——vitest 不做类型检查，本批改名（CANVAS_W/H→BASE_*）与签名变化（estimateSizeBytes 3 参/targetSize 必填/ExportJobParams）最密集，不加则出现「测试全绿 + build/CI 红」窗口（R10-2/R11-A6 两次咬到的形态正式关门）。**R18-G3：已升格为执行纪律段全局条目（批 6/7 同适用，逐任务轻量 tsc -b + 批次收尾完整 build）；本批 Task 17 为 api 侧，web 门对其空转（api 测试脚本自带类型门）。**

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
it('删内联样式后画布点击 seek 绑定仍在（R19② 守护——重写防 onClick 静默丢失）', () => {
  // vi.spyOn(playback 模块, 'seekPlayback')——组件经命名空间取用，spy 可拦截
  // fireEvent.click(screen.getByTestId('preview-canvas'), { clientX: 10 }) → expect(seekSpy).toHaveBeenCalled()
  // ⚠ 勿断言 playhead 具体值：jsdom 无布局，getBoundingClientRect() 全 0 → rect.width=0 → 结果 NaN/Infinity
});
```

- [ ] **Step 2: 跑红 → 修复（spec 4.1：一行）+ applyCanvasSize 单点**

PreviewPlayer :67：

```tsx
{/* 删除内联 style（原为 aspectRatio '16 / 9' + width '100%'）——一行修复本体。
    ⚠ R18-必改①（R19② 定性修正）：属性位花括号星号形式的子节点注释照抄 = TS1005 parse error ✓；
    但 onClick 纯注释占位是**合法**的（onClick={} 亦合法）——非 parse error 而是**静默丢绑定**：
    parse 与 tsc 均拦不住，且现有测试无画布点击 seek 断言（preview-canvas 全仓仅存在性断言）——
    故 Step 1 补守护用例先行。onClick 的既有 seek 绑定（现网 :68-71）原样保留（本示意省略其展示，
    勿因省略而删） */}
<canvas ref={canvasRef} data-testid="preview-canvas" width={1920} height={1080}
  className="bg-black max-w-full max-h-full" /* onClick 既有 seek 绑定原样保留 */ />
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

editorStore 加 action——**必须走既有统一入栈路径 `commit()`**（editorStore.ts:104，内部含 stopCapturing 断画布合并窗；手写 set + begin/endTransient 漏 stopCapturing 且绕过 ensureAutoEdges，评审第 11 条）。**R6 补：EditorState 接口声明一并加**（仓内惯例每个 action 都有接口声明，如 :54/:55 setPlayhead/setPxPerSec 先例——R11-B6 勘误：原引 :68/:78 有误，该两行实为 addClip/addTrack）：

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
  // R13：原骨架此处有 getPopupContainer={(trigger) => trigger.parentElement!}——已删：批 1 壳级 ConfigProvider 后属冗余双保险，且 parentElement 是 static 定位（antd 建议容器需定位）——直接吃壳级容器
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
const LAST_ASPECT_KEY = 've-last-canvas-preset'; // ⚠ R18-G4：此常量由 timeline/canvas-size.ts 导出（R17-F5②），本行为 Shell 内**引用示意**——实现禁在 Shell 内重复声明（注释对代码错，R7-N2 同型）
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
- Modify: `renderer/canvas-renderer.ts:4-5,42-51,60-63,65`（**R11-A1 补 :60-63**：ctx.font 预设置段——layout 字号派生后时序要改，见 Step 2 骨架注）、`renderer/render-frame.ts:14,37`（**R9-3 必改**：FrameRenderDeps.renderer.draw 类型 2→3 参同步——3 参函数不可赋给 2 参签名必编译红；renderFrameAt 本就持有 data，:37 调用改 `deps.renderer.draw(visual, subs, canvasSizeOf(data))`）、`export/worker.ts:12,46`（**R9-4 必改**：:12 `import { CanvasRenderer, CANVAS_W, CANVAS_H }` 改名 BASE_CANVAS_W/BASE_CANVAS_H 同值同步、:46 使用点跟随改名——否则 Task 15 与 Task 16 之间留编译红中间态，Task 15 跑绿必败；targetSize 语义改造仍留 Task 16；**R11-B11 注**：现状导入是 CANVAS_W/CANVAS_H，BASE_* 是本 Task 改名后的中间态、Task 16 收尾再删）、`hooks/usePreviewPlayback.ts:6`（**R17-F2 补**：`import { CANVAS_W, CANVAS_H }` 在调用点改 applyCanvasSize(canvas, size…) 后成孤立导入——删除，否则改名后 TS2305）、`scene/subtitle-layout.ts:4-41`、`apps/web/src/pages/canvas/components/nodes/VideoEditNode.tsx:119,188-189`（R6-B10 行号修正：:119 迷你画布 backing store `canvas.width = CANVAS_W`（改）；:150 是卡片宽 316（**不改**）；aspectRatio '16 / 9' 真正落点 :188-189 node-mini-canvas；**R17-F2 补**：:16 的 `import { CANVAS_W, CANVAS_H }` 在 :119 改 canvasSizeOf 后成孤立——删除）
- Test: `render-frame.test.ts`（**R9-3**：:48-51 与 :69 的 `toHaveBeenCalledWith` 是精确 2 参匹配，draw 加第三参后必红——同步为 3 参（夹具 data 无 canvasSize，断言第三参 `{ width: 1920, height: 1080 }` 兜底值）；:60 解构 `mock.calls[0]` 只取前两参不受影响）、subtitle-layout 既有测试

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
  // lineHeight 同步高比例派生——⚠ R9-5：实现是 Math.round（subtitle-layout.ts:40 既有口径）→ 119，
  // toBeCloseTo 默认精度 2 对 119.4667 必红，必须 toBe(Math.round(...))：
  expect(r.lineHeight).toBe(Math.round(48 * 1.4 * 1920 / 1080));
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
//    renderFrameAt 本身拿得到 data ⇒ draw 加第三参，无状态可陈旧、不改 makeFrameDeps 签名。
//    ⚠ R9-8：形参是 `size: CanvasSize` 而非 `canvasSizeOf(data)`（形参位置写调用表达式非法，且
//    CanvasRenderer 不 import store——依赖方向由 playback/render-frame 层承担，render-frame.ts:18 注释明示）；
//    canvasSizeOf(data) 由调用方 render-frame.ts:37 求值传入：
draw(visual, subtitles, size: CanvasSize): void {   // CanvasRenderer.draw 签名扩展——size 逐层下传 drawVisual/drawSubtitle
  // ⚠ R11-A1：contain **不在 draw() 里**——现网在私有方法 drawVisual（:42 `const contain = Math.min(CANVAS_W / srcW, CANVAS_H / srcH)`），
  // draw() 内无 srcW/srcH 可引用（骨架在 draw 内写 contain 必 TS2304）。签名改 drawVisual(l: VisualLayer, size: CanvasSize)：
  //   private drawVisual({ source, srcW, srcH, state }: VisualLayer, size: CanvasSize) {
  //     const contain = Math.min(size.width / srcW, size.height / srcH);  // :42——新增用例「源素材 contain 居中」唯一要改的行
  //     const scale = contain * transform.scale;                          // :43（:44-45 的 w/h 随 contain 自动跟随）
  //   }
  // ⚠ R11-A1 :65 实物口径：现网是内联表达式 `const firstLineCenterY = CANVAS_H - 96 - blockH + layout.lineHeight / 2;`
  //   （裸 96 字面量，**无 bottomMargin/y 变量**——原骨架的替换公式对不上实物）。实际改写：
  //   const bottomMargin = SUBTITLE_SPEC.bottomMargin * (size.height / BASE_CANVAS_H);
  //   const firstLineCenterY = size.height - bottomMargin - blockH + layout.lineHeight / 2;
  // ⚠ R11-A1 ctx.font 时序：现网 :60-61 在调用 layoutSubtitleLines（:63）**之前**用 style.fontSize（未缩放值）设
  //   ctx.font——第四参派生后 layout.fontSize 才是缩放值；measure 回调虽会重设 ctx.font=f，但**只在换行判定时被调**，
  //   单字/短字幕不触发 measure → fillText 按未缩放字号绘制。改法：layout 之后、fillText 之前重设
  //   ctx.font = `${layout.fontSize}px ${SUBTITLE_FONT}`（:60-61 的预设置保留——measure 首调前兜底）
}
// ⚠ R7-S5（R11-A1 补全为五处）：CANVAS_W/CANVAS_H 在 canvas-renderer 内的消费点全列（机械改名会编译报错提示，
// 但机械替换成 BASE_* 就能编译通过且 9:16 下画错——黑边不满/中心偏移/字幕错位；必须改用运行时 size）：
//   :24 黑底 fillRect(0, 0, size.width, size.height)
//   :34 overlay fillRect(0, 0, size.width, size.height)（toBlack/toWhite 全屏）
//   :42-45 drawVisual 的 contain 基准（R11-A1 补——新增用例唯一观测点，漏改该用例必红且其余全绿假通过）
//   :49 中心 translate(size.width / 2 + transform.x, size.height / 2 + transform.y)
//   :70 字幕水平中心 fillText(line, size.width / 2, ...)（:65 y 同段已在上方注释）
// CANVAS_W/CANVAS_H 仓内其余消费点：VideoEditNode 迷你预览/usePreviewPlayback 守卫改 canvasSizeOf(data)
//   （两文件 VideoEditNode.tsx:16/usePreviewPlayback.ts:6 的旧 import 随调用改造成孤立——删除，R17-F2）；
// export/worker.ts:12/:46 改 BASE_CANVAS_W/H 同值导入（R9-4——Task 16 targetSize 改造前的中间态保编译绿）
// ⚠ R17-F2 防呆（改名限定 4 文件，禁全仓替换）：apps/web/src/hooks/useThumbnails.ts:17 有同名但无关的
//   模块级 const CANVAS_H = 60（:94/:106/:107 消费）——全仓 sed CANVAS_H→BASE_CANVAS_H 会静默把
//   缩略图高度从 60 改成 1080。改名只允许落在 canvas-renderer/worker/usePreviewPlayback/VideoEditNode。
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

usePreviewPlayback/PreviewPlayer：`applyCanvasSize(canvas, size.width, size.height)`——`size` 订阅 `useEditorStore((s) => canvasSizeOf(s.data))`。**R11 登记1：playing effect 的 deps 是 `[playing, canvasRef]`（usePreviewPlayback.ts:93，不含 data/size）**——"data 变触发重设+重绘一帧"只对暂停/未播态成立，播放中切比例该 effect 不重跑、backing store 停旧尺寸。改法：重设逻辑放**独立 `useEffect([size])`**（订阅值变化即触发，播放/暂停两态均收口——播放中重设 backing store 清画面后由 rAF 循环下一帧重绘，可接受），勿塞进 playing effect 改 deps。**R12 补事实（消除空转疑虑）**：`canvasSizeOf` 有 canvasSize 时返回 `data.canvasSize` 同一引用、缺省返回模块级常量——selector 与 effect deps 均引用稳定，**不会**随无关重渲每渲重跑。

VideoEditNode：`:119` 迷你播放循环的 `canvas.width = CANVAS_W; canvas.height = CANVAS_H` 改 `canvasSizeOf(projectData)`（backing store 随工程比例）；`:188-189` node-mini-canvas 的 `style={{ aspectRatio: '16 / 9' }}` 改 `aspectRatio: ${w}/${h}`（CSS 比例）+ `max-height` 约束 letterbox（卡片宽 316 固定不动、节点高度不剧变，spec 5.4）。

- [ ] **Step 3: 跑绿 + 既有渲染用例（render-frame/editorStore）+ Commit**

```bash
git add -A apps/web/src/pages/canvas
git commit -m "feat(video-editor): 批5-2 canvasSize 消费方——renderer contain/字幕 1080 基准派生/节点卡片 letterbox"
```

### Task 16: computeExportSize 取偶单点 + 码率像素量

**Files:**
- Modify: `export/precheck.ts`（码率表/estimateSizeBytes 改签名/**R13：`ExportResolution` 上移 @flowweb/shared 定义 + EXPORT_BITRATES 加 satisfies 约束 + 新增 exportPixelRatio 公共函数（编码与估算同源）**）、`export/worker.ts:21,43,117`（R13 注：:21 是 WorkerRunParams 的 resolution **类型联合行**、:43 是 0.5:1 三元——非两处三元，勿误读；R15 补 :117：video 码率改乘 exportPixelRatio，见调用点同步段决策⑦）、`export/client.ts:4`、`export/upload.ts:5`、`api/videoProjectApi.ts:51`（**R6-B11：四处 `'720p' | '1080p'` 字面量联合全部改从 **shared 的** `ExportResolution` 派生（R13：原写"从 precheck 导入"是 api 层反向依赖 pages——见调用点同步段）**）、`packages/shared/src/types/video-project.ts`（R13：+ `export type ExportResolution = '480p' | '720p' | '1080p';`）、`components/ExportModal.tsx:133`（Radio options 加 480p）、`capabilities.ts:30`（**R6-B11 补漏：canEncodeVideo 探测硬编码 1920×1080——加可选 probeSize 参数，ExportModal 调用时传 `computeExportSize(canvasSizeOf(data), '1080p')`，9:16/21:9 工程探测尺寸不失真**）
- Test: `precheck.test.ts` 追加 18 组合 + **既有 2 参调用点补首参（R11-B5）**——:21 `estimateSizeBytes('720p', 60)` 与 :24 `estimateSizeBytes('1080p', 900)` 签名改 3 参后 TS 需补 `canvasSize` 首参（`{ width: 1920, height: 1080 }`）；**数值断言不变**：新公式 16:9 下 outPx/tierPx=1，46_152_000 逐位重现、900s@1080p 仍 >1.5GiB（已验算）——但只补参不改断言会 TS 红（vitest 不查类型、tsc -b build 暴露）；`export/client.test.ts` **4 处补 `targetSize`（R11-A6 修正：R10 计 3 处仍漏 :23）**——:23（长字面量 `{ data: { version: 1, fps: 30, tracks: [], clips: {} } as never, … }`）/ :40 / :51 / :67，`WorkerRunParams.targetSize` 必填后 tsc -b（build 脚本）报 TS2345；vitest 不做类型检查故测试仍绿、**只在 build/CI 暴露**（最易漏网）。四处补 `targetSize: { width: 1280, height: 720 }`（**选必填补字段、不选可选+worker 兜底**——worker 内 canvasSizeOf+档位兜底等于第二求值点，违背本 Task "computeExportSize 单点"初衷）

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
import type { ExportResolution } from '@flowweb/shared'; // R14④：类型已上移 shared（R13）——precheck 自身 satisfies 消费必须引入，precheck.ts:9 本地导出删除
export const EXPORT_BITRATES = {
  '480p': { video: 2_500_000, audio: 96_000 },
  '720p': { video: 5_000_000, audio: 128_000 },
  '1080p': { video: 12_000_000, audio: 128_000 },
} as const satisfies Record<ExportResolution, { video: number; audio: number }>; // R13：shared 联合漏改表键即编译红（加档同步守护）。R15①：as const 必须在前——satisfies 在前时 const 断言的操作数是 SatisfiesExpression 节点，不在编译器白名单 → TS1355（仓内 tsc 5.6.3 临时文件实测编译定性：satisfies…as const 报 1355、as const satisfies 零错）
export function computeExportSize(canvasSize: { width: number; height: number }, tier: ExportResolution) { // R16 nit：形参统一 shared 联合（同文件已 import）——加档同步守护彻底单点
  const targetShort = parseInt(tier, 10); // 480/720/1080
  const scale = targetShort / Math.min(canvasSize.width, canvasSize.height); // 档位=目标短边（spec 5.3）
  return { width: Math.round(canvasSize.width * scale / 2) * 2, height: Math.round(canvasSize.height * scale / 2) * 2 };
}
// R14②：ratio 单点——clamp（Math.max(1, …)）收进函数内部，估算/编码两端同调此函数（R13 版两端不同公式：
// 估算 clamp、编码裸 ratio，1:1@1080p=0.5625/3:4@1080p=0.75 两档背离"同源"叙述）。窄画布不降码率（质量取向）。
// 上界勘误（R14②）：6 档最大 21:9 → ratio = 4/3 ≈ 1.33（480p 取偶后 1.3336）——R13 写 1.47 有误。
// R17-F7 登记：「16:9 ratio=1」仅 720p/1080p 精确成立（=1.0）；480p 因取偶 854×480=409,920 vs tierPx
// 409,600 → ≈1.00078。既有断言（precheck.test 用 720p/1080p）不受影响——勿顺手写 480p 的 toBe(1) 用例。
export function exportPixelRatio(canvasSize: { width: number; height: number }, resolution: ExportResolution): number {
  const out = computeExportSize(canvasSize, resolution);
  const tierPx = parseInt(resolution, 10) ** 2 * (1920 / 1080); // 档位参考像素（16:9 基准——16:9 各档 ratio=1 与旧口径一致）
  return Math.max(1, (out.width * out.height) / tierPx);
}
export function estimateSizeBytes(canvasSize: { width: number; height: number }, resolution: ExportResolution, durationSec: number): number {
  const { video, audio } = EXPORT_BITRATES[resolution];
  // 21:9 的 480p 输出 1138×480 勿按 2560×1080 画布像素高估（评审第 9 条）——ratio 经 exportPixelRatio（含 clamp）
  return Math.round(((video * exportPixelRatio(canvasSize, resolution) + audio) / 8) * durationSec * 1.2);
}
```

调用点同步：**R13 决策⑤ 执行顺序注——本 Task 的 UI 480P 选项 commit 与 Task 17 绑定：Task 17 的 DTO @IsIn 放开先 commit（或同 commit）**，DTO 未放开前浏览器手测选 480P 必 400（组件测试 mock api 不发真请求不受影响）。ExportModal 的 `estimateSizeBytes(resolution, durationSec)` → `estimateSizeBytes(canvasSizeOf(data), resolution, durationSec)`，**且 sizeBytes 的 useMemo deps 补 data**（现 :54 为 `[resolution, durationSec]`——不含 data 则 Popover 开着切比例后配额预检仍用旧尺寸，R8-N10 附）；worker :43 的 `resolution === '720p' ? 0.5 : 1` 删除，改消费主线程传入的 `targetSize`（**R17-F4：targetSize 必须落在 `ExportJobParams`（client.ts:4，Files 已列）**——client.ts:54 `worker.postMessage({ type:'run', params:{...params, saveFileHandle} })` 是无类型透传，只加 WorkerRunParams 会编译过而运行时 worker 拿 undefined；加在 ExportJobParams 后 postMessage 的 `...params` 展开自动携带，worker 侧 WorkerRunParams 类型同步收窄）。**⚠ worker 侧两处必须同源（R6-B11 修正：原"三处"之一不成立——worker 无显式 VideoEncoder 尺寸配置，编码尺寸由 mediabunny CanvasSource 从 OffscreenCanvas 隐式决定，全文件已核）**：① **OffscreenCanvas 创建尺寸 = targetSize**（:46，否则导出仍是画布分辨率、metadata 报的目标值与实际不符） ② `ctx.scale(targetSize.width / size.width, targetSize.height / size.height)`（:48——逻辑坐标仍按 canvasSize 绘制，物理像素缩到 targetSize；**R11-A6：② 前必须先 `const size = canvasSizeOf(data);`**——原骨架直接引用 `size` 未定义必 TS2304；canvasSizeOf 是纯读取逻辑画布尺寸、非档位推导，不违 computeExportSize 单点。**R12 补：worker.ts import 段需加 `import { canvasSizeOf } from '../timeline/canvas-size';`**——:42 解构 `const { data, … } = params` 已得 data，作用域成立，只缺 import）。**收尾删 worker.ts:12 的 `BASE_CANVAS_W/BASE_CANVAS_H` 导入**（:46 改 targetSize 后未使用——R9-4 的中间态改名导入在此完成使命；`CanvasRenderer` :170 仍用须保留。tsconfig.base.json 未开 noUnusedLocals 不阻塞编译，属 lint/整洁项，R10-5）。另 **`ExportResolution` 已在 precheck.ts:9 存在（`keyof typeof EXPORT_BITRATES`）且被 export/controller.ts:5、ExportModal.tsx:8 引用（R11-B4：本 Task 只扩 EXPORT_BITRATES 加 '480p' 条目、联合自动扩展——勿重复声明，duplicate export 编译错。**R13 勘误：`api/videoProjectApi.ts:51` 从 pages/…/export/precheck 引类型是 api 层反向依赖 pages 层——`ExportResolution` 改上移 `@flowweb/shared` 定义**（`'480p' | '720p' | '1080p'` 字面量联合），precheck 的 EXPORT_BITRATES 加 `satisfies Record<ExportResolution, { video: number; audio: number }>` 约束保加档同步（改 shared 联合漏改表键即编译红）、precheck.ts:9 本地导出删除，controller.ts:5/ExportModal.tsx:8 既有引用与四处 resolution 字段一并改引 shared）**；ExportModal Radio options（:133）加 `{ label: '480p', value: '480p' }`（R13：小写与现网 '720p'/'1080p' 一致，大写统一留给批 6 Select 按 spec 6.3 文案落地）；capabilities 探测参数化（R7 小项②：**第二参** probeSize——现签名 `detectExportCapabilities(deps?)` 只有一参（capabilities.ts:24），ExportModal.tsx:69 现无参调用；加 `probeSize = { width: 1920, height: 1080 }` 第二参，:30 的 canEncodeVideo config 用 probeSize——默认值保既有单测不变（capabilities.test.ts:37/50/61 三处首参传 deps 不受影响），ExportModal :69 调用点改 **`detectExportCapabilities(undefined, computeExportSize(canvasSizeOf(data), '1080p'))`**（R9-9：首参 deps 传 undefined 走默认值——probeSize 是第二参，误当第一参传入则形状错且探测尺寸仍失真）最坏档探测）；upload 的 register 入参带 `width/height`（Task 18 后端接收）。**R13 决策⑦（R14② 修正：clamp 收进函数内 + 上界更正）：编码码率同步按像素量缩放——spec 5.3 动机原文即"固定码率画质偏低"，只落估算只解决一半**：precheck.ts 提公共函数 `exportPixelRatio(canvasSize, resolution)`（**内部含 `Math.max(1, …)` clamp**——估算与编码两端只调它，勿在调用侧再 clamp 或漏 clamp；窄画布 1:1/3:4 档 ratio<1 不降码率，质量取向），worker :117 的 `bitrate: EXPORT_BITRATES[resolution].video` 改 `Math.round(EXPORT_BITRATES[resolution].video * exportPixelRatio(canvasSizeOf(data), resolution))`（**R14④：worker.ts import 段同步加 `import { exportPixelRatio } from './precheck';`**——R12 只加了 canvasSizeOf；6 档最大 21:9 → ratio 上界 **4/3 ≈ 1.33**（480p 取偶后 1.3336）——R13 写 1.47 有误；audio 码率与像素无关不动）；估算与编码同公式——16:9 ratio=1，precheck.test 数值断言不受影响。

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
it('metadata 落库含 width/height（R14：用例必须显式传 width: 854, height: 480——DTO 是 @IsOptional，不传则 metadata 无该键、断言必红）', async () => {
  await service.register({ ..., resolution: '480p', durationSec: 10, width: 854, height: 480 });
  // 断言 prisma.media.create 被以 metadata 含 width:854, height:480 调用
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

generated-media.service register 的 metadata（:44）加 `width: input.width, height: input.height`；前端 upload.ts 的 registerGeneratedMedia 入参同步（width/height 来自 computeExportSize——批 6 ExportModal 重构时一并接，本任务后端先行不破前端：DTO 新增必填字段会影响现有前端调用！**部署顺序注意**：DTO 加必填 width/height 后老前端 400——故本任务与批 6 Task 20 的前端调用同 PR 合入，或字段暂设 `@IsOptional()`，批 6 落地后收紧。**取 @IsOptional() 方案**（单次发版，前端随后补传）。**R11-B9 登记**：video-project 无全局 ValidationPipe——controller.ts:7 类级 `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))`、无 forbidNonWhitelisted ⇒ **未在 DTO 声明的字段被 whitelist 静默剥离（不是 400）**；后续任何新 DTO 字段（如 Task 20 幂等键等）必须显式声明，否则 service 拿 undefined 静默失效。

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
    // ⚠ R9-2：扁平参 { getOpfsRoot }——与实现签名 deps: Pick<SaveTargetDeps,'getOpfsRoot'> 一致。
    // 勿仿 pickSaveTarget 的 { deps: {...} } 两层包装（那是有 suggestedName 首参的 opts 形状）——
    // R8 版用例写成两层包装致 deps.getOpfsRoot undefined → 落 navigator.storage → jsdom TypeError。
    const r = await openOpfsTarget({ getOpfsRoot: () => Promise.resolve(root as never) });
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

Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor/export && pnpm --filter @flowweb/web exec tsc -b`（R18-G3 补显式 Run——原独此两 Task 无 Run 行）

```bash
git add apps/web/src/pages/canvas/video-editor/export
git commit -m "feat(video-editor): 批6-1 SaveTarget 三态（canceled 中止/OPFS 中转）+ fastStart diskTarget 判据（P0-B/P1-E）"
```

### Task 19: ExportModal 重构为 Popover（目的地分流 + 受控 + 进度）

**Files:**
- Modify: `components/ExportModal.tsx`（大改，重命名组件语义为导出 Popover 但文件名不变——精准修改）、`export/upload.ts`、`store/editorStore.ts`（补建节点 store）
- Test: `ExportModal.test.tsx` 全面改写（**R6 必改子步骤 0：先重写 mock 工厂**——现 :13-17 mock 只导出 `{ runExportJob, pickSaveFile, ExportJobError }`，改用 pickSaveTarget 后 7 个用例整批 TypeError；mock 改为导出 `pickSaveTarget`（可按用例 mockResolvedValue 三态）+ `openOpfsTarget`（R7-N3 画布路径）+ `cleanupOpfsTarget`/`sessionOpfsKeys` 空实现 + `cleanupStaleOpfsExports` 空实现；jsdom 既无 showSaveFilePicker 也无 navigator.storage，组件测试一律走 mock 不触真实现——纯函数侧已由 Task 18 deps 注入用例覆盖）；**`export/upload.test.ts`（R13 必改①——原清单漏列，批 6 双红不可见）**：UploadProductInput 加必填 `width/height`（**required，与 targetSize 同理**——避免第二求值点）后——:26 是**精确** `toHaveBeenCalledWith({workflowId, videoProjectId, resolution, durationSec, actualSize})`，register 入参多 width/height 必红；:25/:31/:36/:40 四处字面量构造 TS2345（tsc -b build 暴露、vitest 不查）。四处补 `width: 1280, height: 720` + :26 断言同步加两字段

- [ ] **Step 0: 重写 ExportModal.test.tsx mock 工厂（上注）——先跑既有 7 用例确认 mock 缺口（红），再改写为 pickSaveTarget 三态 mock（组件用例按 destination/canceled/fsa 分支各配 mockResolvedValue）+ antd 工厂 stub 四键齐全（R14①：success/error/warning/info——本 Task 的 canceled 提示、onDegraded 降级提示、R13 的 r.fsa=false 回退警告三处走 info/warning，只 stub success/error 必 TypeError）**

- [ ] **Step 1: 写失败测试（核心行为）**

```tsx
// 新用例（既有用例迁移保留语义）：
// ⚠ R10-1 渲染约定（新旧用例同构）：一律 render(<ExportPopover />) + fireEvent.click(await
// screen.findByTestId('export-trigger')) 打开——Popover 自管 open 初始关，渲染后直接断言 config 内容必超时：
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
  // R15②：同用例顺带断言 warning 通道（r.fsa=false 事件级明示——spec 附录 A⑩ 决策的测试钉，
  // 否则该行生产代码无失败测试先行；messageWarning 变量名与 mock 工厂 stub 一致）：
  // expect(messageWarning).toHaveBeenCalledWith(expect.stringContaining('内存'));
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
const [fileName, setFileName] = useState(''); // R10-4：初值空——挂载时求值一次（title 异步到达晚于组件首渲）会永远停在「导出.mp4」；既有 useEffect([open]) 内 open=true 时重种 setFileName(`${currentEditorProjectTitle() || '导出'}.mp4`)（与现网 :93 点击时求值语义最接近，不加"仅首次/touched"跟踪）。**R17-F5①：该 effect 的其余语句（setPhase('config')/setFail(null)/setQuotaError(null)/setProgress/setEtaSec(null) 复位 + detectExportCapabilities——现网 ExportModal.tsx:65-70）原样保留**——成功路径走 setOpen(false) 不复位 phase，重开全靠此 effect；重构时丢了它，成功导出一次后 Popover 永远停在进度态
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
    void cleanupStaleOpfsExports(target.kind === 'opfs' ? target.handle.name : undefined); // R9-1：keepName 排除本次在用的中转 key（不排除=自杀式清理——openOpfsTarget/pickSaveTarget 刚 add 的 key 会被①步无门槛 removeEntry，见结构落位段）；fsa/canceled 时集合内只有历史残留，全清无碍。fire-and-forget，try/catch 全包（Firefox 无痕 getDirectory 拒绝时静默跳过）
    setJob(j); setPhase('exporting'); armBeforeunload(); // ⚠ setJob(j) 必须保留（R4 必改③——现网 :101 同款；丢了则取消按钮 job?.cancel() 空转、进度区拿不到 job）
    try {
      // ⚠ R8-N5：恢复 r.fsa 择源（R7 版误删）。worker 的 createWritable() 失败（OPFS 配额耗尽/IO 错——浏览器
      // 真实可触发）会回退 BufferTarget：数据只在 blob、句柄文件仍是 {create:true} 的 0 字节。不择源则：
      // 画布/本地读 handle.getFile() 拿 0 字节静默上传/下载；本地 FSA 分支更是 blob 被丢弃、用户分文未得却见
      // "导出完成"（静默数据丢失）。既有契约：现网 ExportModal.tsx:105 `r.fsa && handle ? getFile() : r.blob`
      // （注释明示"防 0 字节静默上传"）+ client.test.ts:63 契约缝合点用例——属"既有验收资产不得回退"纪律范围。
      const r = await j.promise; // ExportJobResult { blob, fsa }——fsa 即 Task 18 diskWritable（OPFS 句柄亦真）
      // R13 决策⑥（spec 6.1 :116"内存警告前置到 UI 明示——非仅 precheck 一行"）：worker createWritable 失败
      // 回退 BufferTarget（数据全程驻内存）时在此明示——config 态 precheck 的 memoryEstimateBytes 行覆盖不到
      // 运行中回退这一事件，spec 要求的就是这个事件级明示：
      if (!r.fsa) void message.warning('已回退内存缓冲（磁盘直写不可用），本次导出占用内存较高');
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
  trigger="click" placement="bottomRight" title="导出设置"  // R13 决策⑥：spec 6.3 :124 明确要求 Popover 标题「导出设置」——原骨架漏
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
  {/* children = EditorTopBar 既有导出按钮（trigger）整体搬入组件内部（EditorTopBar 改渲染 <ExportPopover />，组件自包含）——R3 建议⑧归属定案；R10-1：该按钮必须带 data-testid="export-trigger"（既有 7 用例改"渲染 <ExportPopover /> + 点击 trigger 打开"的定位点，与 export-start 同风格） */}
</Popover>
```

结构落位（评审第 6 条定案，不留实现期决策）：**ExportPopover 归 EditorTopBar**——`ExportModal.tsx` 导出 `ExportPopover`，内部 Popover 的 children = EditorTopBar 的导出按钮（trigger）；**删除 Shell 的 `exportOpen` state 与 EditorTopBar 的 `onExport` prop**（Popover 自管 open），Shell 不再渲染 `<ExportModal>`；`VideoEditorShell.test.tsx` 中 exportOpen/`.ant-modal-wrap` 相关断言同批改写（**R11-B3：EditorTopBar.test.tsx 不存在**——全仓无此文件，原表述"两文件同批改写"中前者为空集），**批 1 的 Shell 级归属断言同批把 `.ant-modal-wrap` 选择器改为 `.ant-popover`**（容器归属断言逻辑不变——否则批 6 落地留红灯）。OPFS 残留回收 `cleanupStaleOpfsExports(keepName?: string)`（模块级：**① 先清 `sessionOpfsKeys` 全部 key 但跳过 keepName（R6-B12 无年龄门槛的成立前提是"集合里只有上次本地导出的残留 key"——R7-N3 引入画布路径 openOpfsTarget 后集合首次出现**本次正在使用**的 key，而清理调用在 job 启动后（R3 必改②手势约束所致），无 keepName 排除即**自杀式清理**（R9-1）：worker `createWritable()` 撞上并发 removeEntry → NotFoundError → `.catch(() => null)` 回退 BufferTarget → r.fsa=false → **P0-B 磁盘中转静默失效**（fastStart diskWritable 判据恒假、非 Chromium 验收项变成 blob 空转且不可见）；或已开 writable 后文件被 unlink → `handle.getFile()` 抛 NotFoundError → 导出间歇性失败（取决于 worker 启动竞态）。本地 OPFS 路径同中招——blob 兜底让用户看不出，但 P0-B 同样失效。② 再迭代根目录匹配 `export-*.mp4` 且 lastModified > 24h 的陌生 key → removeEntry（24h 门槛防误删其他标签页在飞文件）**；**整体 try/catch 静默**——Firefox 无痕模式 getDirectory 拒绝，不得影响导出主流程。不把清理挪到 target 获取之前（local 路受 D4 手势链约束，排除法最省）。迭代器 TS 形态直接用兜底写法：`for await (const name of (root as unknown as { keys(): AsyncIterableIterator<string> }).keys())`——TS DOM lib 的 keys() 类型如可直接用则去强转）——在 startExport 的 job 启动后 fire-and-forget（见上方 R3 必改②），替代本地路径的即时清理，兼收上次崩溃残留。**收起编辑器语义登记**：Popover 随壳卸载、导出继续、完成建节点（R2-N12 后台完成语义保持——beforeunload 模块级守卫已在批外保留）。**R7-S6 已知行为登记**：收起后 `message.success('导出完成，已添加到画布')` 的 holder 随 AntdApp/壳卸载而不存在——完成 toast 静默丢失（产物节点照建、验收项照绿），一期接受不加兜底（改静态 message 会脱离壳作用域暗色，为一条 toast 不值得双通道）。

editorStore 补 + **publishProduct 模块级 helper**（R3 必改③：成功路径漏 clear 会让 pendingProduct 常驻 → 重试按钮常在 → 再点建重复节点。收拢一个入口，成功与重试共用）：

```ts
// editorStore（R7 小项④：state 字段与两个 action 均进 EditorState 接口声明——同 setCanvasSize 惯例）：
pendingProduct: null as { mediaId: string; title: string } | null,
setPendingProduct: (p) => set({ pendingProduct: p }),
clearPendingProduct: () => set({ pendingProduct: null }),
// ⚠ R11-A7：reset()（editorStore.ts:151-157）与 loadProject()（:143-149）都是**显式字段清单**且 reset 带
// "R1（P0-6）：编辑器重开清理点——漏加会跨工程残留"既有注释——两处均须补 `pendingProduct: null`。
// 不补的后果：工程 A 建节点失败后重开工程 B，重试按钮仍在，点下去把 A 的 mediaId 建成 B 源节点的产物节点（错挂）。

// ExportModal.tsx 模块级（createProductNode 抛错时 pendingProduct 留存供重试；成功即 clear）：
const publishProduct = async (mediaId: string, title: string) => {
  const es = useEditorStore.getState();
  es.setPendingProduct({ mediaId, title });        // 先落 store——create 中途抛错/弹层被收起均可重试
  createProductNode(currentEditorSourceNodeId(), currentEditorProjectId(), mediaId, title); // 同步（product-node.ts:9 返回 nodeId）——抛错自然向上传（R4 小项：删空壳 try/catch）
  useEditorStore.getState().clearPendingProduct();
};
```

- [ ] **Step 3: 跑绿 + 既有 ExportModal 用例语义迁移（R10 三件套 + R13 第四项，全部落位才可能绿）+ Commit**

  - **① 渲染方式（R10-1 阻断，7 用例全改）**：现网 7 个用例全部 `render(<ExportModal open onClose={vi.fn()} />)`（:55/:64/:72/:78/:89/:101/:117）——批 6 后 `ExportModal` 导出名消失（改 `ExportPopover`）、`open`/`onClose` props 不存在（Popover 自管 open、初始 `useState(false)` 关）。**双重红**：运行时 Popover 不打开 → `findByText(/720p/)` 起全超时；类型 `tsc -b`（build 脚本，`tsconfig.json` include:["src"] 含测试文件）报 TS2322/TS2305。改法：`:24` import 改 `import { ExportPopover } from './ExportModal';`，每个用例开头改 `render(<ExportPopover />);` + `fireEvent.click(await screen.findByTestId('export-trigger'));`（走真实触发链 trigger→onOpenChange→open——**不加 defaultOpen 测试 seam**，为测试加产品 props 违背简洁优先）；:101 用例的 `unmount()` 语义不受影响（卸载整个 Popover，beforeunload 模块级守卫照验）。
  - **② 按钮查询（R9-6）**：`ExportModal.test.tsx` 共 7 处代码断言 `getByRole('button', { name: /开始导出/ })`（:59/:67/:74/:79/:90/:102/:119）+ 2 处测试名含"开始导出"（:62/:77）——Popover 骨架主按钮文案改「确认」后 getByRole 全红。统一改 `getByTestId('export-start')` / `findByTestId('export-start')`（骨架已保留 data-testid="export-start"）；测试名文案顺带改「确认导出」（可选，不影响绿红）。
  - **③ 提示行（R9-6+R10 4 态分派）**：:57 `getByText(/预计体积/)` 依赖现网 `ExportModal.tsx:135-137` 提示行（`时长 …s · 预计体积 …` + 尾段）——该行**保留进 Popover config 态**（:57 断言不动），但尾段不再按 `'showSaveFilePicker' in window` 全局二态，改**按 destination 分派 4 态（R10-3）**：画布 → `' · 应用内中转'`（画布路径永走 OPFS，Chromium 下若沿用 FSA 判定会显示"直写本地文件"——正是批 6 要消灭的失真文案）；本地 → `('showSaveFilePicker' in window) ? ' · 直写所选位置' : ' · 应用内中转后下载'`（FSA 直写 / OPFS 中转后 a.click 下载）。
  - **④ 分辨率文案正则（R13 必改②）**：:56 `expect(await screen.findByText(/720p/))` 大小写敏感——批 6 骨架 Select label 按 **spec 6.3 大写文案**（'480P'/'720P'/'1080P'，spec §6.3 :124 明确）→ :56 必超时。改 `findByText(/720P/)`；批 5 中间态 Radio 加的 480p 条目保持**小写**与现网 '720p'/'1080p' 一致（一个 commit 的短命中间态，批 6 Select 统一大写）。

  Run: `cd D:/flowweb && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor && pnpm --filter @flowweb/web exec tsc -b`（R18-G3 补显式 Run——width/height 必填字段的字面量漏补只在 tsc -b 暴露，vitest 照绿）

```bash
git add -A apps/web/src/pages/canvas/video-editor
git commit -m "feat(video-editor): 批6-2 导出 Popover 化——目的地分流（画布 getFile/本地延迟 revoke）/受控不可关/取消三态提示/补建节点 store 化"
```

---

## 批 7｜后端导出链加固（P1-D）

### Task 20: confirm 终判 + clientRequestId 幂等 + TTL 回收

**Files:**
- Modify: `apps/api/src/modules/video-project/generated-media.service.ts`、`video-project.dto.ts`、`temp-cleanup.processor.ts`、`temp-cleanup.module.ts`（providers 注册调度服务——**R6-B13 必改：调度注册，现状 processor 是零入队者死代码**，全仓 grep 仅 constants/module/processor 三处引用、无 producer 无 repeat 注册，不补调度则"24h TTL 回收"只是纸面功能）、`generated-media.service.spec.ts`（:28 quota mock 只有 assertCanUpload——confirm 终判接入后补 assertOnConfirm mock）、`temp-cleanup.processor.spec.ts`（:41-49 断言 `{ type:'temp', expiresAt }` where——OR 扩展后同步；R13 勘误：原写 :41-45，断言块实跨 :41-49）
- Create: `apps/api/src/modules/temp-cleanup/temp-cleanup.scheduler.service.ts`（+spec——R7-S1：镜像 subscription-scheduler.service.ts 先例的独立 @Injectable() 调度服务，remove-then-add + tz:'UTC'）
- Test: api 侧 service/processor/scheduler 测试；**前端 `apps/web/.../export/upload.test.ts`（R13 必改①第二窗口——原"只跑 api 测试"看不见）**：upload.ts register 入参加 `clientRequestId`（必填）后同批四字面量 + :26 精断言再次红——同批补 `clientRequestId: 'req-1'` 类字面量与断言字段；**`components/ExportModal.test.tsx` 追加 clientRequestId 生命周期用例（R16②——落点 Task 20 而非 Task 19：批 6 阶段组件无该字段，用例在 Task 19 必红且本任务内无法绿，跨任务悬挂违单任务 TDD 节奏；与接线同批红→绿闭合）**：`it('clientRequestId 每次导出尝试独立：跨尝试换新、同尝试内复用（R4 必改① 回归）')`——第一次导出走完取 `uploadExportedProduct.mock.calls[0][0].clientRequestId`，第二次导出（再次点确认走完）的值与之**不同**（防"组件级长期复用"复活：第二次命中幂等拿旧 key → 覆盖首产物 + content-length-range 钉死 → MinIO 400）；变体**必写**（R19①：register 加一次重试后该路径可达——mock registerGeneratedMedia 首调 reject、次调 resolve，断言两次调用的 clientRequestId 同值，即"同尝试内复用"的失败测试先行）

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
  // （temp-cleanup.processor.spec.ts :41-49 既有 where 断言同步为 OR 扩展形态——R6-B13(3)；R13 勘误：原写 :41-45，断言块实跨 :41-49；文件在 modules/temp-cleanup/ 下）
  // ⚠ R18-③ 必改：where 断言必须写**精确 OR 形态**——findMany 是 mock、返回由夹具决定，只把现状
  // objectContaining 里的 type:'temp' 删掉会"回绿但 OR 分支零覆盖"。断言写成：
  //   where: { expiresAt: expect.any(Object), OR: [{ type: 'temp' }, { type: 'generated', status: 'pending' }] }
  // （OR 数组逐项深比较——这是 24h TTL where 扩展唯一的失败测试先行点）
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
// register() 幂等分支——**查询必须带 status: 'pending' 约束（R4 必改①）+ userId 作用域（R18-必改②a）**
// ——不按发起人作用域化则持他人 clientRequestId 者可枚举命中他人 pending 行，返回的 presigned POST
// 指向他人对象键 ⇒ 覆盖对方在飞产物（confirm 的 userId 校验拦不住"上传覆盖"这一步）；input.userId
// 现成（register input 形状 :28），多一字段零成本：
if (input.clientRequestId) {
  const existing = await this.prisma.media.findFirst({
    where: {
      userId: input.userId,
      metadata: { path: ['clientRequestId'], equals: input.clientRequestId },
      status: 'pending',  // 已 completed 的同 id 命中即语义错误（复用旧产物——第二次导出会静默覆盖第一次的 key 并让两节点指向同一 media）
    },
  });
  if (existing) {
    const upload = await this.minio.generatePresignedPost(existing.key, 'video/mp4', existing.size);
    return { mediaId: existing.id, upload };  // 幂等重入——同 id 同 Media 同 key（spec 批7）
  }
}
// ⚠ R18-必改②b 插入点定死（R19④ 收窄：**紧随 :29 assertEditor 之后、project 查询（:30-35）与
// assertCanUpload（:36）之前**）——插在 assertEditor 之前则幂等分支绕过编辑器权限校验（探测他人
// clientRequestId 存在性）；插在 assertCanUpload 之后则重试命中对着已存在行仍会被"期间被占用的
// 配额"二次拦截报 400（首次 register 已判过配额，重试不该再判）；插在 media.create 之后则先建
// 新行再返回旧行 ⇒ 每次重试留孤儿 pending 行（与 assertOnConfirm 定死 :55→:58 先例同款纪律，
// 实现者勿顺手挪位）。
// metadata 加 clientRequestId 存档
// **前端 id 生命周期（R5 必改①修正声明位置）**：clientRequestId = "一次导出尝试"——
// ref 与 startingRef 并列声明在**组件体**（:50 旁；startExport 是事件处理器，渲染期外调
// useRef 直接抛 Invalid hook call）：
//   组件体：const exportReqIdRef = useRef<string | null>(null);
//   startExport 内（R15 可选①：取局部常量再传——??= 后的属性窄化预计可编译，但不依赖 TS 该不健全行为，
//   局部常量把"一次导出尝试内复用"语义直接写在类型上）：
//   const reqId = (exportReqIdRef.current ??= crypto.randomUUID());  // 首次进入生成；同一次尝试内 register 重试复用
//   上传时传 clientRequestId: reqId；外层 finally（startingRef.current = false 处）exportReqIdRef.current = null;
// ⚠ 禁止组件级长期隐式复用——同会话第二次导出会命中幂等拿到第一次的 key/size：
// 上传覆盖第一次产物 + content-length-range 按首帧字节 ±1024 钉死 → 第二次重编码必超范围 → MinIO 400。
// 已知接受项（同段登记）：① findFirst+create 无唯一约束，同 id 并发双建——startingRef 前端串行化 +
// 每次导出独立 id 下实际不可达 ② metadata.path JSON 过滤走全表扫+逐行取值（无索引）——量级可控
// （单团队导出频次低），若未来成热路径需 raw SQL 表达式索引或改独立列。
// register() 写 expiresAt = now + 24h（R6 更正后理由：复用 expiresAt——getUsage 只统计 completed/deletedAt:null，
// pending 不计额；in-flight 行因 expiresAt 在未来天然不被收走；@@index([expiresAt]) :330 现成索引）：
//   prisma.media.create({ data: { ..., expiresAt: new Date(Date.now() + 24 * 3600_000) } })
// confirm() 接终判（spec 批7——导出链曾是唯一无终判通道）：
// ⚠ R13 必改④ 插入点定死：**statSize（:55）之后、thumbnailQueue.add（:58）之前**——assertOnConfirm 超限时
// 内部已删对象+删 Media 行（storage-quota.service.ts:46，在 modules/team/ 不在 video-project/）：插在
// thumbnailQueue.add 之后则缩略图任务指向已删行；插在 media.update（:60）之后则在已删行上 update 抛 P2025。
// 实现者勿顺手加在 confirm() 末尾。
await this.quota.assertOnConfirm(media.id, actualSize, media.key, media.bucket); // 超限内部已删对象+记录并抛
// temp-cleanup.processor.ts 的过期过滤扩为 OR（不新增第二段查询——与 temp 同语义同字段）；
// spec 断言同步（R18-③）：where 从 objectContaining({ type:'temp', … }) 改**精确对象**
//   { expiresAt: expect.any(Object), OR: [{ type: 'temp' }, { type: 'generated', status: 'pending' }] }
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

前端 upload.ts 的 registerGeneratedMedia 入参带 `clientRequestId`（id 生命周期见上方 R4 必改①定案：一次导出尝试内复用、结束即清空）。**R19①：register 调用加一次重试**（catch 后以同 clientRequestId 原参再调一次）——现状 upload.ts:9-23 是单次链路（register→FormData POST→confirm）且全目录 0 命中 axios-retry/interceptors（穷举核实），幂等分支纯防御不可达、R16②"同尝试复用"变体写不出来；加重试后网络抖动场景命中服务端幂等分支（复用同 key 重发上传，零重编码成本），分支与变体用例双双可达。**正面耦合（批 7 验收登记）**：失败重试=新 id ⇒ 每次失败留一条孤儿 pending 行（对象未上传）——正是 24h TTL 收走的**可达路径**，③ 的精确 OR 断言守护的不是纸面功能。**R14⑤：前端文件入 Files 清单（R15 补第三文件）**——`apps/web/.../export/upload.ts`（register 入参透传）、`apps/web/src/api/videoProjectApi.ts`（RegisterGeneratedInput 类型加 `clientRequestId: string`——不加则 service 侧字段永远 undefined，whitelist 静默剥离面）、`components/ExportModal.tsx`（接线落点：exportReqIdRef 声明与 uploadExportedProduct 传参都在该文件——必填字段的类型兜底不会静默漏，但 Files/git add 原范围均不含 components/，实现者接线后当轮 commit 漏文件、下一轮 build 才暴露）。

- [ ] **Step 3: 跑绿（api 全量 + web 目录级——R16①：R15 已把 components/ExportModal.tsx 纳入改动面，只跑 upload.test.ts 覆盖不到 ExportModal.test.tsx，批 7 接线碰坏批 6 用例时当轮报红而非留到 CI）+ Commit**

```bash
cd D:/flowweb && pnpm --filter @flowweb/api test && pnpm --filter @flowweb/web test -- --run src/pages/canvas/video-editor
git add apps/api/src/modules/video-project apps/api/src/modules/temp-cleanup apps/web/src/pages/canvas/video-editor/export apps/web/src/pages/canvas/video-editor/components apps/web/src/api/videoProjectApi.ts
git commit -m "feat(video-api): 批7-1 导出链终判 assertOnConfirm + clientRequestId 幂等 + generated pending 24h TTL 回收 + temp-cleanup 调度注册（P1-D）"
```

---

## 总验收清单（浏览器，全部通过后收尾）

- [ ] 点导出 → Popover 可见且选项联动（文件名/位置/分辨率/格式 disabled）
- [ ] 目的地=画布：**不弹保存对话框**（R7-N3）→ 导出→上传→画布产物节点出现；目的地=本地：Chromium 弹保存框 → **所选位置文件完整可播且下载目录无第二份**（R7-N3：FSA 直写不 a.click）；非 Chromium → 浏览器下载完整 MP4（>1min 无截断）；**OPFS 残留验收口径 = "下次导出后无 OPFS 残留"**（R6-B12：sessionOpfsKeys 登记本会话 key、下次导出开头扫描即清；24h 阈值只管陌生 key）
- [ ] FSA picker 取消 → 提示且零编码；非 Chromium（Firefox）→ OPFS 中转导出成功
- [ ] **R8-N5 回退场景**：模拟 `createWritable()` 失败（OPFS 配额临界——大文件压一次）→ 画布上传/本地下载必须是真实非空文件，**不得产出 0 字节产物或静默数据丢失**（r.fsa 择源兜底读 blob）
- [ ] **R9-1 中转真实性**：非 Chromium（或 FSA 不可用）画布路径导出 **r.fsa===true**（OPFS StreamTarget 真被用到、fastStart=false 生效）而非全程 blob 兜底——自杀式清理回归项（keepName 缺失会把 diskWritable 打回 Buffer 且不可见）；本地 OPFS 路径同理抽查一次
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
- **R9 修订（2026-09-12 plan 评审九轮·R8 修订版审核：3 阻断+3 小项+3 细节，全部采纳，断言逐条对仓内源码一手复核属实）**：
  - **R9-1（阻断）批 6 自杀式清理**：`cleanupStaleOpfsExports` 改 `keepName?: string` 签名——①步清 sessionOpfsKeys 时跳过 keepName；Task 19 调用处传 `target.kind === 'opfs' ? target.handle.name : undefined`。根因：R6-B12"无门槛清本会话 key"的成立前提是集合里只有**上次**本地导出残留；R7-N3 引入 openOpfsTarget（画布路径）+ R3② 把清理调用挪到 job 启动后，集合首次出现**本次在用** key——不排除则 worker createWritable 撞并发 removeEntry → NotFoundError → `.catch(()=>null)` 回退 Buffer → P0-B 磁盘中转静默失效（fastStart diskWritable 恒假），或已开 writable 后 unlink → getFile() 抛错间歇性失败。验收清单补"R9-1 中转真实性"项（r.fsa===true 抽查）。
  - **R9-2（阻断）openOpfsTarget 参数形状错配**：R8 版用例写 `openOpfsTarget({ deps: { getOpfsRoot } })` 两层包装，实现签名是扁平 `deps: Pick<SaveTargetDeps,'getOpfsRoot'>`——deps.getOpfsRoot undefined → 落 navigator.storage → jsdom TypeError（且 TS 报未知属性）。用例统一扁平参 `{ getOpfsRoot }`；与 pickSaveTarget 的 `{ deps: {...} }` 差异（后者有 suggestedName 首参的 opts 形状）已注记防混。
  - **R9-3（阻断）Task 15 漏列 renderer/render-frame.ts**：FrameRenderDeps.renderer.draw 类型（render-frame.ts:14）与 :37 调用点必须随 draw 扩第三参同步（3 参函数不可赋 2 参签名必编译红；renderFrameAt 持有 data，:37 传 canvasSizeOf(data)）。连带 render-frame.test.ts:48-51/:69 的 toHaveBeenCalledWith 精确 2 参匹配同步为 3 参（夹具无 canvasSize → 断言 {width:1920,height:1080} 兜底值）；:60 解构取前两参不受影响。Files 行与批 4+5 总览表均已补。
  - **R9-4（小）Task 15↔16 中间态编译红**：export/worker.ts:12 `import { CANVAS_W, CANVAS_H }` 会被 Task 15 的 BASE_* 改名打断（worker 的 targetSize 改造在 Task 16）——Task 15 清单补 :12/:46 同值改名同步（行为不变，仅保编译绿）。
  - **R9-5（小）lineHeight 断言口径**：实现是 `Math.round(fontSize * 1.4)`（subtitle-layout.ts:40 既有口径）=119，`toBeCloseTo(48*1.4*1920/1080)`（119.4667，默认精度 2）必红——改 `toBe(Math.round(...))`。
  - **R9-6（小）Task 19 既有断言迁移具体化**：7 处 `getByRole('button', { name: /开始导出/ })`（:59/:67/:74/:79/:90/:102/:119）+ 2 处测试名（:62/:77）统一改 `getByTestId('export-start')`（骨架已留 testid）；:57 `getByText(/预计体积/)` 提示行保留但 :136 尾段"内存缓冲"→"应用内中转"（批 6 后非 Chromium 走 OPFS 磁盘中转，原文案失真误导）。**（⚠ 尾段二态表述已被 R10-3 取代为 destination×FSA 4 态分派——"FSA 分支不变"在画布目的地失真，以 Step 3 ③ 为准）**
  - **R9-7（细节）Task 5 三行 PanelResizeHandle 直接带 onDragging prop**——注释对代码错是 R7-N2 同款形态，实现者照抄代码块即漏。
  - **R9-8（细节）Task 15 draw 形参**：`size: CanvasSize`（非形参位置写 canvasSizeOf(data) 调用表达式——非法；且 CanvasRenderer 不 import store，render-frame.ts:18 依赖方向注释明示）——canvasSizeOf(data) 由调用方 :37 求值传入。
  - **R9-9（细节）capabilities 调用形态明写**：`detectExportCapabilities(undefined, computeExportSize(canvasSizeOf(data), '1080p'))`——首参 deps 传 undefined 走默认值，防实现者把 probeSize 误当第一参。
  - **R8 采纳项确认**：评审逐条独立证实 N5-N10+理由更正+Step 0 mock 工厂全部准确（N5 择源表达式与现网 ExportModal.tsx:105 逐字同构、N6 先例行号形状逐行对上）。
- **R10 修订（2026-09-12 plan 评审十轮·R9 修订版审核：1 阻断+1 小+3 细节全采纳，其中 1 项计数勘误；断言逐条对仓内源码一手复核属实，R9 九项采纳确认无误）**：
  - **R10-1（阻断）Task 19 既有测试迁移漏第三项——渲染方式**：R9-6 只改了查询方式，7 个用例的 `render(<ExportModal open onClose={vi.fn()} />)`（:55/:64/:72/:78/:89/:101/:117）在批 6 后**双重红**——运行时（`ExportPopover` 自管 open 初始 `useState(false)` → `findByText(/720p/)` 起全超时）+ 类型（`tsc -b`，apps/web tsconfig include:["src"] 含测试文件，TS2305/TS2322）。Step 3 与 R9-6 合并为"测试迁移三件套"：①渲染方式（`:24` import 改 `ExportPopover` + 每用例"渲染 `<ExportPopover />` → `fireEvent.click(await screen.findByTestId('export-trigger'))` 打开"——走真实触发链，**不加 defaultOpen 测试 seam**：为测试加产品 props 违背简洁优先；骨架 children 段补 `data-testid="export-trigger"`）②按钮查询（R9-6 原文）③提示行（并入 R10-3 4 态分派）。:101 用例 unmount() 语义不受影响。
  - **R10-2（小）Task 16 漏列 client.test.ts**：targetSize 必填后 **:40/:51/:67 三处**短字面量 TS2345（⚠ 审核报告计 2 处漏 :40——"error 消息 reject"用例 :40 同为 `{ data: {} as never, resolution: '720p', mediaUrls: {} }`，本轮回勘误补上）；vitest 不做类型检查故测试仍绿、仅 build/CI 暴露（最易漏网形态）。Test 段已列三处补 `targetSize: { width: 1280, height: 720 }`；**不选"可选+worker 兜底"**——worker 内 canvasSizeOf+档位兜底等于第二求值点，违背本 Task "computeExportSize 单点"初衷。
  - **R10-3（细节）提示行 4 态分派**：R9-6 保留的"FSA 分支文案不变"在 Chromium 下选「导出到画布」会显示"直写本地文件"（画布路径永走 OPFS）——正是批 6 要消灭的失真文案。尾段改按 destination 分派：画布 → `' · 应用内中转'`；本地 → FSA 有 `' · 直写所选位置'` / 无 `' · 应用内中转后下载'`。
  - **R10-4（细节）fileName 求值时机回退**：骨架 `useState(\`${title || '导出'}.mp4\`)` 是挂载时求值一次——title 异步到达晚于组件首渲则默认名永远停在「导出.mp4」（现网 :93 是点击导出那一刻求值）。改 `useState('')` + 既有 `useEffect([open])` 内**每次打开重种**（与现网点击时求值语义最接近，不加 touched/"仅首次"跟踪）。
  - **R10-5（顺手）Task 16 收尾删 worker.ts:12 的 BASE_CANVAS_W/H 导入**——:46 改 targetSize 后未使用（R9-4 的中间态改名导入完成使命；`CanvasRenderer` :170 仍用须保留）。tsconfig.base.json 未开 noUnusedLocals 不阻塞编译，属 lint/整洁项。
  - **R9 采纳项确认**：评审逐条独立证实 R9-1~R9-9 全部准确落地（render-frame.ts:14/:37 行号、worker.ts:12/:46、lineHeight 119 两侧同值、7 处按钮查询计数、三行 handle onDragging 等逐一对上）。另**正面核实（勘误登记）**：Task 14 无 api 侧风险——video-project.dto.ts:8 `@IsOptional() @IsObject() data?: object` 整体透传，ProjectData 加 canvasSize 字段不会被 ValidationPipe whitelist 剥离（whitelist 只作用于 DTO 自身顶层属性，data 非白名单对象字段）。
- **R11 修订（2026-09-12 plan 评审十一轮·R10 修订版审核：A 段 8 阻断 + B 段 13 勘误 + 2 登记项；A1-A8 全采纳、B 勘误 9 项采纳、B9 大部分已消解、B10/B11 登记级；另修正审核报告自身 2 处口径。断言逐条对仓内源码与 node_modules 一手复核属实）**：
  - **A1（阻断）Task 15 renderer 骨架编译不过 + 漏关键消费点**：contain 在私有方法 `drawVisual`（canvas-renderer.ts:42）**不在 draw()**（draw 内无 srcW/srcH 可引用——骨架原样必 TS2304）；签名改 `drawVisual(l: VisualLayer, size: CanvasSize)`，R7-S5 消费点清单四处补 **:42-45 为五处**（:42 是新增用例「源素材 contain 居中」唯一观测点，漏改该用例必红且其余全绿假通过）；:65 实物是内联 `CANVAS_H - 96 - blockH + lineHeight / 2` 裸 96（**无 bottomMargin/y 变量**，原骨架替换公式对不上实物）；ctx.font :60-61 先于 layout（:63）用未缩放 style.fontSize 设置——单字/短字幕 measure 回调不触发、fillText 按未缩放字号绘制，改 layout 之后用 `layout.fontSize` 重设 ctx.font。Files 行 canvas-renderer 行号补 :60-63。
  - **A2（阻断）Task 10 poster 写回 TS2345**：MediaInfo 的 name/durationSec 必填（editorStore.ts:17），`{ thumbnailUrl }` 字面量缺字段 tsc -b 红；且 setMediaInfo 的 `...info`（:172-177）只兜 url/mimeType/durationSec **不兜 name**——为图省事改字段可选会把已有记录 name 擦成 undefined。写回带全原字段（与 drop 路径 :526 同构 + thumbnailUrl）。
  - **A3（阻断）Task 2"跑通为准"不成立，三既有测试文件整批崩**：antd es/app/context.js 默认值 `{ message: {}, notification: {}, modal: {} }` 无 static 回退（node_modules 亲验）——① AssetPanel.test.tsx（7 处裸渲染 + :143/:159/:171 静态 message spy 断言）抛 `message.error is not a function` 且 spy 永不命中；② ExportModal.test.tsx :79 成功链 message.success 同抛错；③ PreviewPlayer.ai.test.tsx :94（Task 2 原文件表漏列此文件）mock 静态 Modal.confirm 不再被拦 + modal 为空对象 TypeError（普通 PreviewPlayer.test 不触发两调用可存活）。修法：各文件 `vi.mock('antd')` 工厂补 `App: { ...orig.App, useApp: () => ({ message: { success/error: stub }, modal: { confirm: stub } }) }`（spy 断言全保留、无需 provider 包装；ExportModal.test 原无 antd mock 新增同款工厂）。
  - **A4（阻断）Task 1 Shell 顶层 useApp() 读到根 AntdApp**：App.tsx:15 已有根 `<AntdApp>`（React context 按组件树**祖先**解析，与 Shell return 的内层 AntdApp 无关）——实例 holder 挂 document.body、亮色主题、z=12010 < 壳 z-[100000]：:53 onConflict 与 :76 排空失败两条 warning 依旧被盖，批 2"toast 同暗色"对它们不成立。改 **bridge**：内层 `<AntdApp>` 下挂 `ShellToastBridge`（useApp 取 message 存 toastApiRef，返回 null 零 DOM），Shell 顶层经 ref 调用（两调用点只在 open=true 可达、bridge 必挂载，无 null 窗口）。
  - **A5（阻断）Task 7 夹具漏 AssetPanel.test.tsx:117**：`querySelector('[data-track-type="subtitle"]')!` 单轨化后为 null，:122 `fireEvent.drop(null)` 直接 TypeError——**在原列的 :126 之前先炸**，只改 :126 到不了断言；⑤ 改 `:117,:126` 两处同批改写。
  - **A6（阻断，含对 R10 的纠错）Task 16 worker size 未定义 + client.test.ts 4 处**：骨架 `ctx.scale(targetSize.width / size.width, …)` 的 size 在 worker 内无定义必 TS2304——② 前补 `const size = canvasSizeOf(data);`（canvasSizeOf 是纯读取逻辑画布尺寸、非档位推导，不违 computeExportSize 单点）；client.test.ts 缺 targetSize 实为 **4 处**——R10 补 :40/:51/:67 三处后**仍漏 :23 长字面量**（`{ data: { version: 1, fps: 30, tracks: [], clips: {} } as never, … }` 同样无 targetSize）。
  - **A7（阻断）pendingProduct 未进 reset()/loadProject()**：两处均为显式字段清单（:151-157 / :143-149），reset 段带既有"R1（P0-6）：编辑器重开清理点——漏加会跨工程残留"注释——不补则工程 A 建节点失败后重开工程 B，重试按钮仍在，把 A 的 mediaId 建成 B 源节点的产物节点。两处补 `pendingProduct: null`。
  - **A8（阻断，浏览器实测收口）Task 5 高度链**：`h-[280px]` 实为三处（:204 error / :209 loading / :216 ready——原清单只列 :216）；react-resizable-panels v2 的 Panel 是面板组 flex item（flexBasis/flexGrow/overflow:hidden）**非 flex 容器**——子节点 `flex-1 min-h-0` 无 flex 上下文，TimelinePanel/PreviewPlayer 会缩到内容高、批 2"时间轴满屏"验收失败（该包未安装无法本地验证，按防御处理）：各 Panel 内容根一律 `h-full`（备选 Panel 显式 `display:flex`），jsdom 测不出布局、浏览器实测二选一收口。
  - **B 勘误（9 项采纳）**：B1 140 硬编码实为 **4 处**（补 TrackRow.tsx:33 `w-[140px]`——不补则 TRACK_HEADER_W 非单点）；B2 getByText 实为 **11 处**（补 PreviewPlayer.test.tsx:105 `getByText('删除')`）；B3 **EditorTopBar.test.tsx 不存在**（批 6 结构落位改单文件表述）；B4 `ExportResolution` 已在 precheck.ts:9 存在且被 export/controller.ts:5、ExportModal.tsx:8 引用——只扩 EXPORT_BITRATES 加 '480p'，**勿重复声明**（duplicate export）；B5 precheck.test.ts:21/:24 补 canvasSize 首参（**数值断言不变**——16:9 下 outPx/tierPx=1、46_152_000 逐位重现、900s@1080p 仍 >1.5GiB，已验算）；B6 setPlayhead/setPxPerSec 实在 :54/:55（:68/:78 是 addClip/addTrack）；B7 containerRef 表述限定"TimelinePanel 内不存在"（全仓 11 文件另有，勿全局误删）；B8 z-index 双路径口径——上下文实例 12010（根 base 11000）/静态 message **2010**（自建 ConfigProvider 取 global.getTheme() 本仓恒 undefined → base 1000；"被壳覆盖"结论不变，devtools 排查勿只找 12010）；B12 Task 10 色表 video 兜底断言改 `'var(--ve-track-video)'`（jsdom 不解析 CSS 变量，断言 #1f1f1f 必红）；B13 Task 3 证伪闸门前置断言——先查 `.ant-modal-wrap` 的 closest(壳) 归属再判 z-index（rc-util Portal initRef 闩锁：容器渲染期一次性解析，夹具初始开态会造成容器恒落 body 的假象误杀诊断）。
  - **B9 大部分已消解**：Max import R7 已补（Task 17 import 行）、width/height 已 `@IsOptional() @Min(1)` 声明不会被 whitelist 剥离——剩登记价值（controller.ts:7 类级 ValidationPipe whitelist 无 forbidNonWhitelisted ⇒ **未来新 DTO 字段必须显式声明否则静默剥离非 400**）已写入 Task 17。B10（mediabunny d.ts 打包单文件/dist 分文件双视图行号——新引用注明哪种视图，沿 R8-N6 口径）、B11（worker 现状导入 CANVAS_W/H、BASE_* 是 Task 15 改名中间态 Task 16 收尾删——顺序正确，Files 行已加澄清）登记级。
  - **登记 2 条（均采纳落位）**：① usePreviewPlayback playing effect deps 是 `[playing, canvasRef]`（:93）不含 data——原"data 变触发重设+重绘"只对暂停/未播态成立，播放中切比例 effect 不重跑、backing store 停旧尺寸；改**独立 `useEffect([size])`**（两态均收口，播放中重设清画面由 rAF 下一帧重绘）。② shadowJob.ts:44/47 静态 message（模块级函数非组件、useApp 不可用）——Task 2 加可选 `notify` 参数由调用方 PreviewPlayer 组件内 useApp 取实例注入（生成完成/失败 toast 落壳内；ai.test:13 已整体 mock watchShadowJob 改签名不破）。
  - **对审核报告自身的 2 处修正**：(1) D 段批 2"ExportModal :132/:135/:156、ClipBlock :69/:82 缺映射"口径不准——这 5 处类名（#1F2329/#86909C/#4E5969/bg-white）**已在映射规则覆盖内**，真正缺的是 Task 4 文件清单漏列 ExportModal.tsx 与 ClipBlock.tsx（已补）；`bg-[#FAFBFC]`/`bg-[#F2F3F5]`/`text-[#C9CDD4]`/`bg-[#C9CDD4]` 才是规则与清单双缺（已补 3 条规则：FAFBFC→--ve-panel、F2F3F5/C9CDD4 底→--ve-border、C9CDD4 文字→--ve-text-dim）。(2) B9 大部分已消解（如上）。
- **R12 修订（2026-09-12 plan 评审十二轮·R11 修订版审核：确认 R11 全部正确落地；新发现 1 实质缺口（批 2 亮色残留两类通道）+ 5 小修 + 1 补充事实，全部采纳，断言逐条对仓内源码/node_modules 一手复核属实）**：
  - **实质缺口(1) 类名映射仍漏 6 处（补 2 条规则）**：`border-[#F2F3F5]` ×3（AssetPanel:32、TimelinePanel:218、TrackRow:31——暗底上近白分隔线横贯面板头/工具行/每条轨道行）→ `--ve-border`；`hover:bg-[#F7F8FA]` ×3（AssetPanel:79/:105/:137——悬停闪白）→ `hover:bg-[var(--canvas-controls-hover)]`（**复用 index.css:20 既有 token 勿新增**）；另 `bg-[#F7F8FA]` 规则括注补第二处 PreviewPlayer.tsx:62（原只列 Shell:87，靠规则隐式覆盖、逐文件核对易漏）。全目录其余颜色命中复核：或落入现有规则、或属语义色（#F53F3F/#FF7D00/#00B42A/#6C5CE7/#722ED1 暗底可读不动——其中 #722ED1 已被 R17-F8 反转覆盖：统一 text-[var(--ve-accent)]）、ClipBlock pastel 归 Task 10、#F0F0F0 编辑器目录 0 处。
  - **实质缺口(2) 非类名通道——全仓无 color-scheme，原生控件与滚动条亮色（Task 4 新增 Step 3.5）**：src grep `color-scheme` 0 命中；antd 5.22.5 暗色算法只改 token 不写 color-scheme；preflight 关闭无 base 层兜底。两处后果：① PropertiesPanel.tsx:136-138 原生 `<textarea>`（字幕文本）无 bg/文字色——UA 表单控件 `background-color: field` **不继承**父级，暗面板中央纯白输入框（Switch/Slider/InputNumber 走 darkAlgorithm 无碍、AssetPanel 搜索框是 antd Input ✓，唯一中招）；② AssetPanel:64/TimelinePanel:228/PropertiesPanel:81 滚动条亮色。修法：壳根（Shell:87 同一行）追加 `[color-scheme:dark]`（Tailwind 任意属性、可继承、作用域收壳内——**勿写 :root** 外溢全站）；textarea 补 `bg-[var(--ve-panel)] text-[var(--ve-text)]` 双保险。**jsdom 抓不到 UA 样式与滚动条——此条只在总验收"无亮色残留"（七批全完后）才暴露，现在补成本≈0**。
  - **小修 5 项**：① R11-A2 注释"与 drop 路径 :526 同构"引用错误（:526 是 plan 自身行号随修订漂移成空行——R12 勘误：改引**源码位置 TimelinePanel.tsx:189-193**；教训：plan 内引用一律指源码行号不指 plan 行号）；② R11-A6 修法漏 import——worker.ts import 段补 `import { canvasSizeOf } from '../timeline/canvas-size';`（:42 已解构 data 作用域成立，只缺 import）；③ shadowJob `notify` 可选参**有意不兜底**（`(notify?.success ?? message.success)` 会保留静态 message import、重新打开壳外亮色 toast 路径）——注明约束"仅壳内唯一生产调用方 PreviewPlayer 传入"；shadowJob.test 四用例（:36/:51/:62/:71）不传 notify 不断言 message 保持绿 ✓；④ mock 工厂 `App: { ...orig.App, useApp }` 丢函数 [[Call]]——三文件不渲染 `<App>` 现状可跑（useApp 是自有可枚举属性、展开能拷到 ✓），备选 `Object.assign(function App() {}, orig.App, { useApp })` 已注；⑤ ShellToastBridge 渲染期写 ref——StrictMode（main.tsx:19）双渲染幂等无害，useEffect 规范写法已注（可选）。
  - **补充事实（写入 Task 15）**：`canvasSizeOf` 有 canvasSize 返回 `data.canvasSize` 同一引用、缺省返回模块级常量——独立 `useEffect([size])` 与 selector 均引用稳定，不随无关重渲空转。
  - **R11 复核确认**：A1-A8/B 勘误/登记 2 条全部正确落地无错改；react-resizable-panels v2.1.9 发布包 constants.d.ts/PanelResizeHandle.d.ts 再证 data-panel-group-id/data-panel-id/onDragging/defaultSize 成立。
- **R13 修订（2026-09-12 plan 评审十三轮·R12 修订版审核：证伪闸门机制一手证实 + 必改 4 + 决策 3 + 勘误 6 + 登记项，全采纳；spec 附录 A 同步补勘误⑧⑨⑩）**：
  - **必改① upload.test.ts 双窗口漏列**：批 6 Task 19 加必填 width/height + 批 7 Task 20 加 clientRequestId 都会打红它（:26 **精确** toHaveBeenCalledWith 多字段必红 + :25/:31/:36/:40 四字面量 TS2345），而 Task 19 Test 只列 ExportModal.test、Task 20 "只跑 api"——两破口均不可见。两 Task Test 段已补；UploadProductInput 新字段定 **required**（与 targetSize 同理防第二求值点）。
  - **必改② :56 分辨率正则**：批 6 Select label 按 **spec 6.3 大写**（'480P'/'720P'/'1080P'）→ `findByText(/720p/)` 大小写敏感必超时——Step 3 增第四项迁移（改 `/720P/`）；批 5 中间态 Radio 加 '480p' 小写与现网一致。
  - **必改③ placeAssetInTrack 死参**：签名 `durationSec: number` vs drop 调用 `payload.durationSec?: number`（TimelinePanel:178）TS2345；实现体只读 mimeType（start=轨尾 max）从不读时长——**删字段**（签名 + 4 测试调用 + 2 调用点共 7 处同步）。
  - **必改④ Task 20 终判插入点定死**：**statSize（:55）之后、thumbnailQueue.add（:58）之前**——assertOnConfirm 超限内部已删行（team/storage-quota.service.ts:46）：插 queue.add 后则缩略图任务指向死行、插 media.update 后则 P2025。storage-quota 在 modules/team/ 不在 video-project/（路径注）。
  - **决策⑤ 执行顺序**：Task 16 UI 480P commit 与 Task 17 绑定（17 的 DTO 放开先 commit 或同 commit）——DTO 未放开前浏览器手测 480P 必 400（组件测试 mock api 不受影响）。
  - **决策⑥ spec↔plan 四偏离收口**：Popover 补 `title="导出设置"`（spec 6.3 :124 原文要求，骨架漏）；r.fsa=false 时 message.warning 内存事件级明示（spec 6.1 :116"非仅 precheck 一行"——落 Task 19 择源段前）；OPFS removeEntry 延迟清理/Tooltip→原生 title/内存警告形态三条**spec 附录 A 补勘误⑧⑨⑩（7 处→10 处）**。
  - **决策⑦ 编码码率按像素量缩放**：spec 5.3 动机即"固定码率画质偏低"，只落估算只解决一半——precheck 提 `exportPixelRatio()` 公共函数（估算/编码同源单点），worker :117 video 码率乘 ratio（21:9 有界 ≈1.47 不设上限；audio 不动）；16:9 ratio=1 数值断言不变。
  - **勘误 6 项**：snapTime 在 view-scale.ts:34 返回 SnapResult 非 nullable（判定用 .snapped 标志）；ResizeObserver effect 实际 :38-44（原 :34-38）；temp-cleanup.processor.spec where 断言实跨 :41-49（原 :41-45）；**ExportResolution 上移 @flowweb/shared**（api/videoProjectApi.ts:51 从 pages 引类型是反向依赖——shared 定义 + EXPORT_BITRATES satisfies Record 约束保加档同步 + Files 行补 shared 文件）；Task 14 Dropdown getPopupContainer 删（批 1 后冗余 + parentElement 无定位）；worker Files 行 :21 注（类型联合行非三元）。
  - **登记**：Task 9 一次入轨两次 commit（undo 两次）接受不改；Task 5 keyboardResizeBy（PanelGroup prop，键盘不落盘优先查它）；审核对 v2.1.9 发布包再证 PanelGroup.onLayout/Panel.onResize/tagName 存在——"唯一无法离线证实项"撤销，属性选择器断言成立；剩余实测仅 onLayout 首挂/键盘 onDragging 两条行为层（已登记装包收口）。
  - **正面确认**：批 1 证伪闸门机制三件套（Modal getContainer 链/AntdApp component={false}/useApp 无 static 回退）经 antd 源码一手证实；批 2 色值映射 22 字面量穷举无残留；Popover 内嵌套 Select 经 @rc-component/trigger subPopupElements 证实不会误关弹层（无需处置）。
- **R14 修订（2026-09-12 plan 评审十四轮·R13 修订版审核：R13 逐条复核为真；新发现 R13 自身引入的 3 必改 + 3 清单遗漏，全采纳；spec 附录 A 状态澄清）**：
  - **①（必改，R13-决策⑥ 连带缺口）mock 工厂只 stub success/error**：Task 19 骨架有三处非 success/error 通道——`message.info('已取消导出，未开始编码')`（P1-E）、onDegraded `message.info(…)`、R13 新加 `message.warning('已回退内存缓冲…')`——R11-A3 工厂只 stub 两键则 canceled/降级/回退三批新用例先撞 `is not a function` 掩盖真断言。R11-A3 工厂与 Task 19 Step 0 均补 `warning/info` 四键齐全。
  - **②（必改）exportPixelRatio 非单点 + 上界数字错**：R13 版估算保留 `Math.max(1, …)` clamp 而编码裸 ratio——1:1@1080p（0.5625）/3:4@1080p（0.75）两档两端不同公式，"同源"叙述不成立；"21:9 ≈1.47"有误（实为 **4/3 ≈1.33**，480p 取偶 1.3336）。修法：**clamp 收进 `exportPixelRatio` 内部**、两端只调它（窄画布不降码率，质量取向；既有数值断言全保）；骨架重构一并落 satisfies Record 约束与 `import type { ExportResolution } from '@flowweb/shared'`。
  - **③（必改）Task 12 守卫恒失效 + 变量名**：onWindowPointerMove 注册于 `useEffect(..., [])`（TimelinePanel:143-153）是首渲闭包——`if (nextGuide !== snapGuideTime)` 读 state 恒首值 null 恒真、守卫无效（实际靠 setState 同值 bailout，归因不能写错）；真实绑定名是 `snapped`（:110）非 snappedPoint（照抄 TS2304）。改 **snapGuideRef 镜像比较** + 真实变量名 + 插入位置（move 分支 :124 之前）。
  - **④（清单）三处 import**：Task 11 TimelinePanel 的 view-scale import 追加 zoomByDelta/anchorZoomScroll/TRACK_HEADER_W（现有仅 pxToTime/quantizeTime 等）；worker.ts 补 `import { exportPixelRatio } from './precheck'`（R13 加消费未加 import）；precheck.ts 补 `import type { ExportResolution } from '@flowweb/shared'`（satisfies 与被删本地导出之间不断链）——三处均已落位。
  - **⑤（清单）Task 20 前端两文件**：upload.ts（register 透传）+ videoProjectApi.ts（RegisterGeneratedInput 加 `clientRequestId: string`，否则 service 侧永远 undefined）入 Files；Step 3 补 web 侧 upload.test 命令（"只跑 api"看不见）。
  - **⑥（澄清非步骤）spec 附录 A ⑧⑨⑩ 已随 R13 直接修订落盘**（7→10 处，上轮 Edit 完成）——审核为只读核对未察觉；**执行时无需再编辑 spec**，防执行者重复改动。
  - **残余采纳**：Task 17 metadata 用例显式传 `width: 854, height: 480`（DTO @IsOptional 下不传则断言必红非假绿）。
  - **登记（浏览器确认）**：Task 12 跨轨拖动吸附线位置与标尺一致性——elementFromPoint 命中他轨路径是 140 坐标系三处消费中唯一无 jsdom 覆盖的路径，落地后浏览器顺手确认。
  - **R13 复核确认**：审核逐条证实必改③④①②/决策⑥四件/satisfies 合法（TS 5.6.3）/四勘误/两登记全部正确落地；keyboardResizeBy?: number | null 经 v2.1.9 PanelGroup.d.ts 再证。
- **R15 修订（2026-09-12 plan 评审十五轮·R14 版复核：R13/R14 全项确认落地无错改；新发现 1 编译错 + 1 TDD 缺口 + 1 残句，全采纳。新增核实手段：仓内 tsc 5.6.3 临时文件实际编译 + TS 编译器 isValidConstAssertionArgument 白名单）**：
  - **①（必改，实测定性）Task 16 `satisfies Record<…> as const` 顺序反了——TS1355**：const 断言操作数白名单（各字面量/括号/一元 ±/枚举成员访问）不含 SatisfiesExpression，`X satisfies T as const` 按同级左结合解析为 `(X satisfies T) as const` 必报错。仓内 tsc 5.6.3 临时文件实测编译精确复现（satisfies 在前 = TS1355 命中、as const 在前 = 零错）。换序 `} as const satisfies Record<…>;`——satisfies 加档守卫效果不变；as const 现无字面量依赖（全仓仅 EXPORT_BITRATES[resolution] 两处索引访问），保留维持现状。
  - **②（必改，TDD 缺口）R13 决策⑥ 的 message.warning('已回退内存缓冲…') 无测试守护**：Step 1 八用例无一断言该行，属"无失败测试先行的生产代码"且承载 spec 附录 A⑩ 决策——挂到 R8-N5 回退用例顺带断言 `expect(messageWarning).toHaveBeenCalledWith(expect.stringContaining('内存'))`。
  - **③（残句）Task 11 Files 行"140 全仓共 3 处"未随 R11-B1 正文更正**——改 4 处（含 TrackRow.tsx:33），防只读文件清单者停在第 3 处漏第四处（TRACK_HEADER_W 单点关键项）。
  - **可选项采纳×2**：clientRequestId 取局部常量 `const reqId = (exportReqIdRef.current ??= crypto.randomUUID())` 再传（属性窄化预计可编译但不依赖 TS 不健全行为，语义显式）；Task 16 Files 行 worker 补 :117（码率改乘 exportPixelRatio 处）。
  - **补充缺口（R15-④"登记即可"升格为实修）**：Task 20 Files/git add 均不含 components/ExportModal.tsx，而 exportReqIdRef 声明与 upload 传参落点全在该文件——必填字段类型兜底不漏（不传即 tsc 红），但当轮 commit 漏文件下一轮 build 才暴露；Files 补该文件、git add 补 components 路径。
  - **复核为真（审核侧一手确认，无需改 plan）**：R13①upload.test 双窗口/④终判插入点/决策⑥ spec :124+:116 原文、R14②③④⑥/残余/登记、ExportResolution 上移（shared 内 0 同名；worker.ts:13 已 import EXPORT_BITRATES，exportPixelRatio 可并入同行）、TimelinePanel.tsx:6 现导入五项（quantizeTime 在 :7 来自 clip-math——R14④ 括注小误不影响动作）、R12 遗留全在位；批 1 无未决项可直接开工；两条行为层实测登记（onLayout 首挂/键盘 onDragging，优先查 keyboardResizeBy）维持。
- **R16 修订（2026-09-12 plan 评审十六轮·R15 版审核：R15 四项+可选项+升格项确认落地；新发现 2 处 R15 改动带出的缺口 + 批 1 机制最后一块拼图 + 1 一致性 nit，全采纳；②落点修正为 Task 20）**：
  - **机制补强（Modal 弹层容器链闭环）**：rc-dialog@9.6.0 DialogWrap.js:3 用 @rc-component/portal@1.1.2（**非 rc-util Portal**）——容器 = 渲染期惰性 useState 一次 + **无依赖 effect 每次渲染后重解析**（Portal.js:53-64），effect 后于 ref 附加 ⇒ shellRef 已挂、createPortal 直挂壳 div（:99 无中间 wrapper）⇒ Task 1 归属断言成立机理落实；卸载不 removeChild 容器（属老 rc-util Portal 行为，issue #10656 注释）⇒"关闭弹层摘掉壳"最后理论隐患消除。**initRef 一次性闩锁限定 rc-trigger 系**（Popover/Dropdown/Select/Tooltip）——Task 3 的 R11-B13 前置断言注解对 Modal 不适用（每渲染重解析自愈），批 6 Popover 验收仍适用。"兜底 body"措辞登记：null 时实际由 useDom 自建默认 div 兜底（等价无害；本 plan 代码 `?? document.body` 永不返回 null）。
  - **①（必改）Task 20 Step 3 web 命令仍只跑 upload.test.ts**——R15 补入的 components/ExportModal.tsx 无测试验收（R14⑤"只跑 api 看不见"同形态再深一层）：改目录级 `--run src/pages/canvas/video-editor`（与批 1-6 跑法一致；批 7 接线碰坏批 6 用例当轮报红而非留到 CI）。
  - **②（必改，落点修正）clientRequestId 生命周期无单测守护**——仅类型兜底（只保证不漏传、不保证值正确）+ 浏览器验收项，违 TDD 铁律（R15② 同类缺口）。审核建议挂 Task 19，修正为 **Task 20**：批 6 阶段组件无该字段，用例在 Task 19 必红且本任务内无法绿（跨任务悬挂违单任务 TDD 节奏）——与接线同批红→绿闭合。用例：两次导出 clientRequestId 不同（防组件级长期复用复活：命中幂等拿旧 key → 覆盖首产物 + content-length-range 钉死 → MinIO 400）+ 同尝试内复用变体。
  - **nit 采纳**：computeExportSize 形参 `tier: '480p'|'720p'|'1080p'` → `tier: ExportResolution`（同文件已 import shared 联合——"单点"名副其实）。
  - **R15 修订确认**：①换序/②warning 断言/③Files 行 4 处/可选项×2/升格项（ExportModal.tsx 入 Files + git add）全部落地，与审核依据一致（编译器源码白名单 + 临时文件实测双重确认）。
- **R17 修订（2026-09-12 plan 评审十七轮·R16 版审核：批 1-7 核验通过清单全对（批 1 闸门三件套源码级/批 2-7 行号全命中）；新发现 2 必改 + 6 建议，全采纳。新增核实手段：node + 仓内 jsdom@25 + react-dom 真实渲染实测 CSSOM 序列化）**：
  - **F1（阻断）Task 10 色表断言口径错**——R11-B12 只修对 var() 半边：jsdom CSSOM 把 hex 归一成 rgb()（'#5DBAA0'→'rgb(93, 186, 160)'、'#8F5DBA'→'rgb(143, 93, 186)'、var() 原样、repeat/size 逐字——仓内 node 实测逐项复现审核表格），**直接断言 hex 必红**；backgroundImage 序列化带双引号（'url("http://…")'）。改法：subtitle/audio 用 toHaveStyle({ backgroundColor: '#5DBAA0' })（jest-dom 两侧过 CSSOM 归一，test-setup.ts:1 已注册 matcher）或 rgb() 字面量；video 断 'var(--ve-track-video)'；tile 用例 backgroundImage 只断 toContain('url(')。
  - **F2（必改）Task 15 改名连带 2 处 import 未列**：usePreviewPlayback.ts:6 / VideoEditNode.tsx:16 的 `import { CANVAS_W, CANVAS_H }` 在调用改造后成孤立——删除（不删则 TS2305）；**批 4+5 全部 Task 验收追加 `pnpm --filter @flowweb/web build` 类型门**（vitest 不查类型、tsc -b include:["src"] 含测试文件——「测试全绿+build 红」窗口经 R10-2/R11-A6 两次咬过后正式关门）；**防呆：改名限定 4 文件**——useThumbnails.ts:17 同名 const CANVAS_H=60（:94/:106/:107 消费），全仓 sed 会静默把缩略图高度 60 改 1080。
  - **F3（采纳）Task 11 scrollLeft 写入时机**：setPxPerSec 后同步写 el.scrollLeft 时 DOM 仍是旧 pxPerSec 布局，放大时目标值被浏览器 clamp 到旧 scrollWidth-clientWidth → 靠右端锚点漂移（jsdom scrollLeft 恒 0 测不出；批 3 验收「光标处锚定缩放」正踩此路径）——改 pendingScrollLeftRef + useLayoutEffect([pxPerSec]) 提交后落。
  - **F4（采纳）Task 16 targetSize 落点**：client.ts:54 postMessage 无类型透传——targetSize 必须落 ExportJobParams（client.ts:4），只加 WorkerRunParams 编译过而运行时 worker 拿 undefined；正文点明（Test 段 client.test 4 处 TS2345 已蕴含，明示防漂移）。
  - **F5（采纳×2）**：Task 19 既有 useEffect([open])（ExportModal.tsx:65-70）的 phase/fail/quota/progress/eta 复位语句**原样保留**——成功路径 setOpen(false) 不复位 phase、重开全靠此 effect，丢了则成功一次后 Popover 永停进度态；Task 14 LAST_ASPECT_KEY 常量与读写落 timeline/canvas-size.ts 导出（Shell/EditorTopBar 双方消费）。
  - **F6/F7（登记）**：anchorZoomScroll 的 viewportW 是既有签名死参（view-scale.ts:62-63 实现未消费）——传参无害、勿赋语义；「16:9 ratio=1」仅 720p/1080p 精确（480p 取偶后 ≈1.00078）——勿写 480p toBe(1) 用例（既有断言 720p/1080p 不受影响）。
  - **F8（采纳半）**：text-[#722ED1]（AssetPanel:35「+ 新建」）→ text-[var(--ve-accent)]（rgb(38,38,38) 上对比度 ≈2.4:1，同族统一零风险）；轨头/轨体同映射 --ve-panel 同色登记可接受（亮色下亦只 1 级灰差）。
  - **Task 1 补记（巧合保护）**：夹具 @/api/videoProjectApi mock 工厂无 exportPrecheck 导出——现状不炸靠「jsdom 下 caps 恒 false 短路（capabilities.ts:28）→ runPrecheck 产 encoder 错 → ExportModal.tsx:73 早退」的巧合；日后 mock capabilities 会以 Vitest No "X" export 形式炸在无关处，先补工厂导出再动。
  - **正面确认（审核侧）**：批 1 闸门三件套（Modal.js:49/:128 getContainer 链、app/index.js:22/:49 component=false、app/context.js 默认空实例）+ BaseFullscreenModal :70/:75-77 全部源码级成立；VideoEditNode :127 new CanvasRenderer(ctx)/:135 renderFrameAt 无需改——「canvasSize 走每帧参数不进构造器」（R3-建议⑦）设计的直接验证；VideoEditorShell.test.tsx:42 遮罩断言不受 Task 1-2 DOM 变化影响（component={false} 零 DOM）。
- **R18 修订（2026-09-12 plan 评审十八轮·R17 版审核（三份独立报告互证）：R17 八项全部落位无错改（F1 经 jest-dom 6.9.1 源码级双证、F2 经 tsc 基线 exit 0 二次证实）；新发现 3 必改 + 3 范围/清单 + 4 小项，全采纳）**：
  - **G1（必改）Task 11 Step 4 残句 + 漏刷标尺 state**：F3 改 pendingScrollLeftRef+useLayoutEffect 后 Step 4 末段仍留旧口径（wheel 直接写 DOM 后 rAF/dispatchEvent 同步刷）——R7-N2/R9-7「注释对代码错」同型；且 layout effect 只写 DOM 不 setState → 缩放那一帧标尺用「新 pxPerSec+旧 scrollLeft」算窗口错一帧（靠浏览器异步 scroll 事件自愈不可靠，jsdom 测不出）。修法：layout effect 内同刷 setScrollLeft(pending)（一次 setState、ref 置空无回环——原生 scroll 回写同值被 bailout 吞）；旧段整删改述。
  - **G2（必改）useLayoutEffect 未进 React import**：TimelinePanel.tsx:1 现无此项（R14④ 三处漏 import 同型）——Step 3 注明追加。
  - **类型门升格（G3，两报告共提）**：R17-F2 门只批 4+5，漏批 6/7 必填字段密集区（width/height/clientRequestId——R13① 认定的「vitest 绿+tsc 红」形态）；Task 18 Step 4/Task 19 Step 3 原独无 Run 行。升格执行纪律段全局条目（逐任务 `exec tsc -b` 轻量等价——dist/.tsbuildinfo 已 gitignore :2/:10，批次收尾完整 build）；**api 端不适用**——test 脚本自带 `tsc -p tsconfig.spec.json --noEmit`（package.json:8 亲核）；Task 17（纯 api 侧）web 门空转注明；两 Task 补显式 Run 行。
  - **必改①（Task 13 JSX 注释位）**：原骨架把 JSX 子节点注释写在属性位 + onClick 纯注释占位——照抄均 TS1005 parse error（仓内 tsc parser 实测三变体定性：属性位仅普通块注释合法）；类型门会拦但以 parse error 形式易误读成断言/类型问题。代码块重写（注释移标签上方 + onClick 保留说明）。
  - **必改②（Task 20 幂等分支两约束）**：(a) where 补 `userId: input.userId` 作用域化——否则持他人 clientRequestId 者可枚举命中他人 pending 行、presigned POST 指向他人对象键覆盖对方在飞产物（confirm 的 userId 校验拦不住上传覆盖步）；input.userId 现成（:28 亲核）零成本。(b) 插入点定死 **assertEditor（:29）之后、buildKey/media.create（:37-46）之前**（两位置亲核属实）——绕权限校验/每次重试留孤儿 pending 行两风险（与 assertOnConfirm 定死 :55→:58 先例同款纪律）。
  - **③（必改）temp-cleanup where 断言精确 OR 形态**：findMany 是 mock、返回由夹具决定——只删 objectContaining 里 type:'temp' 会"回绿但 OR 分支零覆盖"。断言写精确对象 `{ expiresAt: expect.any(Object), OR: [{type:'temp'},{type:'generated',status:'pending'}] }`——TTL where 扩展唯一失败测试先行点。
  - **G4-G7（小项）**：Task 14 代码块 LAST_ASPECT_KEY 标注"由 canvas-size.ts 导出、Shell 内引用示意"（注释对代码错同型）；wheel 解构改名 nextScrollLeft（防遮蔽组件 scrollLeft state）；R12 记录段 #722ED1 句补「已被 R17-F8 反转覆盖」；Task 11 Files 行简化为「TRACK_HEADER_W 全仓 4 处硬编码（含 TrackRow.tsx:33）」。
  - **Task 7 清单补 3 文件**（审核侧 114 命中逐条复核）：keyframe-ui.test/PreviewPlayer.test/VideoEditorShell.test 只用 tracks[0] 安全、PreviewPlayer.ai.test:70 filter 自归一化——入「不受影响（已核）」免重复排查。
  - **正面确认（审核侧新增 7 处）**：@ant-design/icons 四图标实存（package.json:14 直接依赖）；useEditorKeyboard.ts:13-14 INPUT/TEXTAREA/isContentEditable 早退守卫——'s' 不会在批 6 文件名 Input/字幕 textarea 打字时误触分割（本轮最担心的新交互缺陷，实测不存在）；preview-canvas testid :66 既有；schema provider=postgresql/size Int（幂等分支 metadata.path 过滤可编译）；TimelinePanel :25 已订阅 pxPerSec（useLayoutEffect([pxPerSec]) 依赖可得）；tsc --noEmit 基线 exit 0（门不会红在历史债）；storage-quota bucket 形参死参无害 + minio 单一 'flowai' 桶三写入者一致（TTL minio.delete(m.key) 无跨桶误删）、expiresAt DateTime? 可写 null。
  - **惯例固化**：凡涉及 CSSOM 序列化的断言（颜色/url），一律先 node 实跑或直接 toHaveStyle——hex 直断这类错误只能实跑发现（F1 三重证）。
- **R19 修订（2026-09-12 plan 评审十九轮·R18 版审核：R18 全项落位核实无误，含两项穷举加分——受单轨化影响夹具名单封闭（tracks[N]/find/data-track-type 114 命中逐条过，无第 7 文件）、轨道数量断言全相对量（无 toHaveLength(4)，R6-B6+R18 名单可视为封闭）；新发现 1 决策 + 1 定性修正 + 2 低项，全采纳）**：
  - **①（中）幂等分支当前不可达——决策加重试**：现状 upload.ts:9-23 单次链路（register→FormData POST→confirm）+ 全目录 0 命中 axios-retry/interceptors + startingRef 串行化 + finally 清 ref ⇒ 同尝试 register 只发一次、同 id 永不复用——服务端幂等分支（含 R18② userId 作用域与插入点）纯防御、R16②"同尝试复用"变体写不出来。采纳推荐：uploadExportedProduct 内 register 调用加**一次重试**（同 clientRequestId 原参）——网络抖动真实场景、零重编码成本，分支与变体用例双双可达。批 7 验收登记：失败重试=新 id ⇒ 孤儿 pending 行（对象未上传）= 24h TTL 收走的**可达路径**，③ 精确 OR 断言守护的不是纸面功能。
  - **②（定性修正）R18-必改① 第二处非 parse error**：onClick 纯注释占位合法（onClick={} 亦合法）——是**静默丢绑定**（onClick 可选），parse 与 tsc 均拦不住；现有测试也无画布点击 seek 守护（preview-canvas 全仓仅存在性断言）。Task 13 表述修正 + Step 1 补守护用例（spy seekPlayback + click；勿断言具体值——jsdom getBoundingClientRect 全 0 → NaN）。
  - **③（低）Task 11 两小补**：setScrollLeft 声明在 Step 4 注释块、Step 3 引用——注明同批落地（防逐步执行 TS2304 误判）；clamp 端 next===old 时 zustand 同值不通知 → effect 不跑 → pending 残留 → 非滚轮路径（loadProject/reset 重置 pxPerSec:80，editorStore.ts:134/:154）套用旧 scrollLeft 一次——`if (next === old) return;` 一行消除（⚠ guard 在 pending 赋值之前，return 后 ref 不留值）。
  - **④（登记收窄）幂等插入点去两读法**：原「assertEditor 之后、buildKey 之前」区间夹 project 查询（:30-35）与 assertCanUpload（:36）——定死**紧随 :29 之后**：幂等命中不被期间占用的配额二次拦截（首次已判过）+ 省一次查询；与①加重试后语义自洽。
  - **加分事实（审核侧）**：PreviewPlayer.tsx:31-32 生产码已有 `find(...)?.id ?? addTrack('subtitle')` 动态建轨、PreviewPlayer.ai.test.tsx:68-82 正是"无字幕轨先建轨"用例——单轨化后"加字幕"功能无回归（原疑虑排除）。
  - **工具提记**：PowerShell 下 node -e 传含双引号源码会被剥引号（本轮审核曾因此把 className="x" 变 className=x，得到"控制组也报错"的假阳性）——实测 TSX/TS 片段用反引号模板串 + JSX 单引号属性值，或先跑必然合法的 control 组自检。
- **R4 修订（2026-09-12 plan 评审三轮 3 必改+4 建议+9 小项全采纳）**：①clientRequestId 生命周期收紧"一次导出尝试"（组件级 useRef 跨导出复用会静默毁首产物——幂等命中旧 key+content-length-range 钉死必 400）+ 幂等查询加 status:'pending'②拖拽分支全形态（不兼容轨一律改道+必须早退+newTrackType 勿硬编码+dropIntoTrack TDZ 提升声明）③骨架补回 setJob(j)（取消按钮防空转）。建议：横向默认 22/56/22 和=100+saved 惰性初始化/rAF single-flight+标尺 memo/吸附线 +TRACK_HEADER_W 同源/worker 三处同源（scale+OffscreenCanvas+encoder config）。小项：ensurePoster 补 mock 单测（TDD 铁律）/stale 注释与受控注释清理/ExportResolution 随码率表自动扩展/本地路径验收口径"下次导出后无残留"/幂等并发缺口登记接受项/.ant-tick 类名勘误+jsdom 滚动限制/publishProduct 删空壳 try/catch/壳 chrome 暗色目检。**R4 已核实消解**：canvas-controls 变量名✓（index.css:17-19）、addTrack 返回 id✓（:413）、createProductNode 同步✓、open 复位五项✓（:65-70）、手势链无隐藏 await✓（:88-93）、VideoEditNode 路径=components/nodes/VideoEditNode.tsx（Task 15 git add 范围 pages/canvas 勿缩）。
- 已知实现期待核实点（R8 后剩 2 条，均无害化/非阻断）：① react-resizable-panels v2 onLayout 首次挂载是否即触发——S4 改 ref 缓存 + onDragging 落盘后，首次触发最多多 flush 一次等值数据（空写防护），不再有覆盖 saved 风险；装包后照实测登记即可。② v2 handle 键盘 resize 是否触发 onDragging（R8-N9 附注）——不触发则键盘调宽后刷新丢该次尺寸，Panel.onResize 兜底 flush 为备选修法，非阻断。DOM 属性名已由 R6/R7 两轮对 v2 发布包核实成立；mediabunny poster 接口 R7-N1 已按 d.ts 一手核实修正（frame.canvas + formats 必填），无待核实面。核实不符时以仓内实测为准并在 plan 勘误登记，不得硬套本 plan 代码。

