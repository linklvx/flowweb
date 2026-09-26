# Canvas 图片节点面板与交互改造 — 设计 spec

- 日期：2026-09-26
- 状态：设计经用户逐段确认（本会话），待用户审阅本文档后进入 writing-plans
- 范围：apps/web 前端为主；唯一持久化语义变更是标题回写（1 行 updateConfig）；不触后端
- 参考物料：用户提供的参考产品 DOM 代码（风格/参考按钮、运行按钮 SVG、数量按钮图标 SVG、HandleAddNodeMenu 菜单）

## 1. 需求清单与拍板记录

| # | 需求 | 拍板/澄清结论 |
|---|------|--------------|
| 1 | 输入区悬停鼠标应为 I 型光标 | 根因：Tiptap 编辑区无 `cursor:text`，空编辑区（仅 placeholder）浏览器给箭头 |
| 2 | 数量按钮点击弹出、**再次点击应关闭**；前加 SVG 图标；1x/2x/4x → 1张/2张/4张 | 关不上是 bug：触发按钮缺 `onMouseDown stopPropagation`（document mousedown 先关、click 再 toggle）；**去掉 8 档**（默认 options `[1,2,4,8]`→`[1,2,4]`）；count 维持纯 UI 不接 submitGeneration |
| 3 | placeholder 改「描述你想要生成的画面内容，@引用素材」 | 文案全文以此为准（已与用户逐字确认） |
| 4 | 参考按钮左边加「风格」按钮（56×56 竖排） | **仅外观无点击功能**（用户拍板，两次确认）；风格/参考/音频三图标用内联等价 SVG，不建 /images/canvas/ 文件资产 |
| 5 | 「参考」按钮改版 56×56 | 「参考」= 现有 +号上传按钮改 UI；点击打开文件选择的上传行为、file input、data-testid 全保留 |
| 6 | 上传后参考图显示在 +号（参考按钮）右边 | 仅对调渲染顺序（现状缩略图在 + 号左侧）；allImages 追加/插入位置语义不变（不插队首） |
| 7 | 标题字号+图标 12→13px；双击进编辑；编辑框宽=节点横向宽 | ProjectTitle 式 span↔input；**mediaName 唯一真源**（§3.2）；**编辑态保留图标与尺寸文本**，输入框宽=节点宽−图标/尺寸占位（用户拍板"保留占位减宽"）；仅图片节点，其余 4 种节点不动 |
| 8 | 运行按钮换新 SVG；底 rgb(145,145,145) 灰、箭头黑 | 新增 token 对承载（§4）；尺寸保持 28px（不猜放大）；RunButton 为 Image/ImageExt 两面板共享，组件级统一生效；**深档保参考值、浅档加深至 ≥3:1**（用户拍板；参考值浅档 2.78:1 不达标） |
| 9 | 分辨率选项 2K/4K → 1K/2K/4K | **仅前端加选项**（用户拍板）；仅 RatioResolutionPopover 一处（EraseBottomToolbar/VideoHDPanel/命令 quality 项范围外，§7）；后端 resolution→定价链路断裂为存量问题，登记独立任务（§7） |
| 10 | 按住节点右/左 +号（handle）拖动松开弹添加节点菜单，选择后建节点+自动连线 | 右=文本/图片/视频/音频 4 项、左=文本/图片 2 项（按用户两份参考代码，**有意区分**）；**范围=imageGen+imageExtGen 两类图片节点**（用户拍板）；落点=松手位置；**仅画布空白处松开弹菜单**（落在 handle/节点体不弹，§3.3） |

布局拍板：风格/参考按钮与缩略图同行（输入框上方），顺序 **[风格][参考(+号)] [缩略图...]**；ImageThumbnailBar 为 Image/ImageExt/Video 三面板共享，**统一生效不加隔离**（用户拍板，视频面板同步获得新工具行）。

## 2. 现状事实（已实证，路径相对 apps/web/src，行号为当前快照）

- 图片节点：`pages/canvas/components/nodes/ImageGenNode.tsx`；标题区 L1067-1115（节点上方 `-translate-y-full`，12×12 内联图标 + **常驻 input** + 幽灵宽度测量 span L1078-1109，fontSize/lineHeight 12/18px）；label/draft/saveTitle 状态机 L250-270；标题只存本地 useState，**mediaName 从不回写**。
- 面板：`nodes/ImageConfigPanel.tsx`（w-[650px]，底栏 L130-156 = 模型 | 比例·分辨率 ‖ 数量 | 积分 | 运行）；`ImageExtConfigPanel.tsx` 与其共享 RunButton/RatioResolutionPopover/GenerateCountSelector（两调用点均不传 options）；**ImageExtNode.tsx 是 9 行透传组件**（`return <ImageGenNode {...props}/>`）——§3.2 标题改造自动同时落两类图片节点（与需求 10/7 范围拍板自洽）；其余 4 种节点标题为独立重复实现（AudioGenNode:191 / MultiImageNode:270 / TextInputNode:138 / VideoGenNode:687），本次不动。
- 数量选择器：`config-panel/GenerateCountSelector.tsx`——触发按钮 L22-32 **无 onMouseDown stopPropagation**（对比 RatioResolutionPopover.tsx:45 有），document mousedown 关闭监听 L13-18；这就是"再次点击关不上"的根因（mousedown 先关 → click 再 toggle 打开）。
- 比例/分辨率：`config-panel/RatioResolutionPopover.tsx:63` `['2K','4K']`。
- 运行按钮：`config-panel/RunButton.tsx`——size-7（28px）、`bg-[var(--canvas-controls-bg)]`、12×12 箭头 `text-[#999]`、无 title。
- 输入：`prompt-input/PromptInput.tsx`（Tiptap，直接 return `<EditorContent/>` 无包装层；默认 placeholder L230「描述你想要的画面，输入 / 添加设置...」；渲染于 `PromptInput.css` L72-78）；`PromptInput.css` 的 cursor 声明仅 chip/命令项 pointer（L28），`.prompt-editor` 根无 cursor → 空编辑区鼠标为箭头。
- 缩略图行：`prompt-input/ImageThumbnailBar.tsx`——现状顺序 [缩略图(SortableContext L111-121)][+号(L123-134)]；`showUploadButton = !disabled && images.length < maxCount(9)` L96；dnd-kit 仅包缩略图。`config-panel/PromptEditor.tsx` L30-47 渲染顺序：ImageThumbnailBar 在 PromptInput 之上。
- handle：`nodes/NodeHandle.tsx`（target=左/source=右，圆+加号 SVG）；命中区 80×80 `cursor:crosshair`（NodeHandle.css L52-60）。
- 连线：`components/CanvasView.tsx`——onConnect L351（canvasStore.onConnect 建边、同源判重）；isValidConnection 仅禁自连 L242-246；**无 onConnectStart/onConnectEnd**；isLocked = activeEditNodeId !== null（L103）；screenToFlowPosition 项目惯例带容器 rect 偏移（onDrop L258-263、handlePresencePointerMove）。
- 类型（@xyflow/system 0.0.76 实证）：`OnConnectEnd = (event, connectionState: FinalConnectionState)`；FinalConnectionState 含 fromNode/fromHandle/toNode/toHandle/pointer/isValid；`OnConnectStart` 参数含 { nodeId, handleId, handleType }；click-to-connect 走独立 onClickConnectStart/End 事件对；connectOnClick 默认 true（不关闭）。
- store：`stores/canvasStore.ts`——addNode(type, position)（L182-217，**默认选中**）、addEdge(source,target,...,deterministicId)（L469-476，同 id 幂等 no-op）；`stores/autoEdgeIds.ts`——`autoEdgeId(editNodeId, sourceNodeId)`=`auto:${edit}:${src}`、`autoOutEdgeId(editNodeId, productNodeId)`=`auto-out:${edit}:${prod}`；**两类自动边均不入撤销栈**（canvasUndo.ts 刻意排除，外部审核"一入一不入"说法不成立）。【§2.1 补正：auto 前缀实为协作/撤销的通道路由，需求 10 不沿用、改用 handle: 前缀，见 §3.3】
- 菜单：`components/AddNodeMenu.tsx` 双模式（menuStore position=右键坐标+8px / triggerEl=贴按钮），边界钳制 L167-178；handleItemClick L195-197 建节点**一律落视口中心**（无 anchor 语义，外部审核该说法不成立——需求 10 不能复用其落点）；挂载于 `page.tsx:307`。menuStore（stores/menuStore.ts:3-25）现有 isOpen/position/triggerEl/lastMousePos。
- 新节点默认尺寸偏移惯例：AddNodeMenu 用 `{ x: centerX - 125, y: centerY - 30 }`（≈节点半宽/半高）。
- 既有测试断言（需同步更新）：ImageConfigPanel.test.tsx L269 `'1×'`、L278 tooltip「生成数量」（后者不变）、L201-203 `'1:1'`/`'2K'`（默认 resolution 不变，仍通过）；ImageExt 面板测试无数量断言（§2.1 核实，无需改）。VideoConfigPanel **不用** GenerateCountSelector（自带内联下拉 VideoConfigPanel.tsx:61-62，count 同样纯 UI），数量选择器改动**不受其影响**（但其渲染 ImageThumbnailBar，需求 4/5/6 会波及，§2.1/§3.1）。
- 后端（仅登记，不改）：resolution 全链路断裂——前端传 '2K' 标签 → `execution.service.ts:182`/`validation.service.ts:49` 拿它当 pricingRule.resolutionId 查库（库里是 seed-res-sdxl-1024 形态 id）→ 永远 miss →「无有效定价规则」挡掉整个 execute 且静默（不发 error 状态，节点卡 loading）；api-caller.service.ts:270/282 按 `'1024×1024'.split('×')` 解析、Number('2K')=NaN→1024 兜底。MODEL_CONFIG apiKey 明文（api-caller.service.ts:53-72）已在上线前必修项登记（#14），本 spec 不重复处理。

### 2.1 第二轮审核新增实证（均已逐条核实）

- **重连共用拖拽通道**：@xyflow/react 12.10.2 EdgeUpdateAnchors（dist index.mjs L2747-2793）——重连边端点的手势同样触发全局 onConnectStart/onConnectEnd，且重连 source 端传 `{nodeId: edge.target, type:'target'}`、target 端传 `{nodeId: edge.source, type:'source'}`（**对端**节点）；edgesReconnectable 默认 true 且 CanvasView 未传 onReconnectStart → 不加标志位则"拖边端点改连线"会被误判为 handle 拖拽而弹菜单。
- **screenToFlowPosition 内部已减容器 rect**（同 dist L556-565）——调用方应传**裸 clientX/clientY**；onDrop 现写法（clientX−bounds.left）属双重相减，仅因画布容器 rect 原点恰为 (0,0) 侥幸无害，不作为惯例效仿（本文 §2 首段"项目惯例减 rect"的表述作废）。
- **auto:/auto-out: 前缀是通道路由而非命名**：canvasCollabRuntime.ts L123/127 跳过 auto 前缀边的常规同步、L141-159 syncAutoEdgesToDoc 以 Origin.AutoEdge 写 doc；canvasUndo.ts L15-17 trackedOrigins 仅含 Origin.LocalUser（auto 边**不入撤销栈**）；addNode 等常规 store 变更走 syncStoreToDoc(Origin.LocalUser)（L217）。若 handle 拖拽建边沿用 auto 前缀：与 addNode 不同源 → Ctrl+Z 只撤节点、边留 doc；applyDocToStore 重建 edges 仅映射 id/source/target **无孤儿过滤**（L194）→ 孤儿边进持久化；且 video-editor/timeline/auto-edges.ts L22/28 planAutoEdgeOps 按 `target===editNodeId && startsWith('auto:')` **泛前缀**对账，target 指向 videoEdit 节点的此类边会被按 clip 集合误删。
- **FinalConnectionState.isValid: boolean | null**（@xyflow/system general.d.ts L230/L248/L275）；toHandle 表达"松手点落在 handle 上（含 connectionRadius 默认 20px）"与有效性无关——source→source 等类型不合法组合 isValid=false 但 toHandle!=null。
- **标题双数据源**：label 本地 useState 仅挂载时播种自 mediaName（ImageGenNode.tsx L251-252）、显示读本地（L270）→ 撤销/协作对端改名/重新生成写 mediaName 三类场景本地均不同步；mediaName 另有第二消费者——@引用素材 chip 名（L179 `name: nodeData?.mediaName || '参考图'`）。input 实宽=幽灵 span 的 max-content（内层 w-max），并非 nodeWidth；保留右侧尺寸文本时 input 不可能等于节点全宽。
- **共享面比预想大**：VideoConfigPanel.tsx L6/L237-254 也渲染 ImageThumbnailBar；ImageExtConfigPanel 的 count 为**持久化** extConfig.generateCount（L281-282，经 imageExtNodeApi.ts:41 上行）而非本地 state；imageExtNodeApi.test.ts L94 存在 `generateCount: 8` fixture；ImageExtConfigPanel.test.tsx **无任何数量断言**（§5 原"ImageExt 同理检查"不成立，删除）。
- **「N张」既有先例**：EraseBottomToolbar.tsx L296/L316 已用 `{n}张`（其 test L55 有 '1张' 断言）——本 spec 文案向既有编辑态工具条对齐；同文件 L30/31 还有第二处 RESOLUTION_OPTIONS ['2K','4K'] 与 COUNT_OPTIONS [1,2,3,4]，L115 是仓内**第 4 个**手写 document-mousedown popover。
- **测试基建**：ImageConfigPanel.test.tsx 数量断言为 5 个 it 共 10 行文本断言（L265-306 区间：L265/269/285-288/294-295/302/305-306），另有 L272-279 tooltip 用例（「生成数量」文案不变、无需改）；ImageGenNode.test.tsx L226-258 四条标题用例全走 fireEvent.focus 进编辑（无双击路径；L251 ghost 用例将随机制删除失效）；CanvasView.test.tsx L38-54 useCanvasStore mock **无 addEdge 键**（现状未暴露：onConnect 被 mock 为 vi.fn() 从不触达 addEdge）、ReactFlow 经 vi.importActual 真渲染（L21-24）拿不到 onConnectEnd prop；**fireEvent.click 不派发 mousedown**——纯 click 的"点按钮关闭"用例在 bug 存在时也绿（现存用例只测点 body 关闭，缺陷即藏于该覆盖缺口）。
- **门禁职责更正**：硬编码色拦截=lint-gate.mjs（no-color-hex+baseline 增量，baseline 冻结禁日常重建）；css-audit.mjs=五路 CSS 审计+斜杠门禁（颜色仅信息性统计）；contrast-table.mjs+e2e/audit/contrast-pairs.json=对比台账（新 token 需补配对）；新域 token 双值须登记 e2e/b0-token-blocks.spec.ts DOMAIN 表；浅值必须写入**既有唯一 .light 块**（e2e/b1-token-migration.spec.ts L331-332 守卫）；canvas-migration-registry.json L2363 已预登记 RunButton:14→var(--canvas-controls-bg) 裁定，本次改色属推翻预登记、需按 C8 惯例做变更登记。
- **杂项**：SortableImageItem 实际 50×50（PromptInput.css .thumbnail-item 64px 为死代码，不引用不删）；AddNodeMenu 关闭=背板遮罩（L279 `fixed inset-0 z-[calc(var(--z-panel)-1)]`）+Escape（L122-130），非 document mousedown；imageExt 节点 resolution 存于 data.extConfig.resolution（snapshot-filter.util.ts L35-36 白名单剥离根级）。

## 3. 设计

### 3.1 下拉面板（需求 1/2/3/4/5/6/8/9）

**A1 光标**：`PromptInput.css` 给 `.prompt-editor` 加 `cursor: text`（不加在外层容器）。作用域内三类既有元素不受影响的机制各异：image-chip 是**内联样式** cursor:default（优先级高于继承）；命令弹层 `.command-item`（渲染于 document.body，不在编辑区内）cursor:pointer 不受影响；编辑器内 `.command-chip`（命令徽章）现无 cursor 声明、**需补 `cursor: default`** 否则会继承 I 型（见 §5 P1a）。

**A2 数量选择器**（GenerateCountSelector.tsx）：
1. 触发按钮补 `onMouseDown={(e) => e.stopPropagation()}`（与 RatioResolutionPopover L45 同款，修"再次点击关不上"）。**固有取舍（登记 §7-1）**：补后触发按钮自身 mousedown 不再冒泡、不参与"外点关闭"，再次点击靠自身 toggle 关闭——正是需求行为，非缺陷。
2. 按钮文字前加用户提供的 16×16 文档图标 SVG（path 见附录 A），`fill="currentColor"` 随按钮文字色，不引入新硬编码色；
3. 显示 `{count}×`→`{count}张`；菜单项 `1×/2×/4×/8×`→`1张/2张/4张`；默认 options `[1,2,4,8]`→`[1,2,4]`；aria-label 由 `Generate ${count} variations` 中文化（全仓无测试依赖该英文 label，已核实）。
- ImageExt 面板 count 为持久化 extConfig.generateCount，随共享组件同样去 8 档。**已知显示不一致（登记 §7-7，不迁移数据）**：存量 extConfig.generateCount=8 时按钮仍显示「8张」而菜单已无 8 项。其 api 测试 fixture `generateCount: 8`（imageExtNodeApi.test.ts L94）是 **API 透传断言**（`expect(params.generateCount).toBe(8)`）、与选项集合无关——**保持不动**（既不锁选项集也不顺手归一化）。VideoConfigPanel 自带数量下拉，不涉及。

**A3 占位文案**：PromptInput.tsx L230 默认值改「描述你想要生成的画面内容，@引用素材」。两图片面板（Image/ImageExt）经 PromptEditor 默认透传一齐生效；CSS 渲染机制（data-placeholder attr）不动。

**A4/A5/A6 工具行**（ImageThumbnailBar.tsx 重构行内顺序）：
- 新顺序：**[风格 56×56] [参考 56×56] [缩略图...]**（缩略图 SortableContext 移到按钮之后，dnd-kit 逻辑零改动）。
- 「参考」按钮：原 +号上传按钮改 UI——`h-[56px] w-[56px] flex-col items-center justify-center gap-[2px] rounded-[8px]`，内联参考图标 20×20 + 「参考」12px 文字；保留 onClick=handleUploadClick、隐藏 file input、`data-testid="upload-button"`、满 9 张隐藏（showUploadButton）逻辑。
- 「风格」按钮：同款样式，内联滤镜/调色图标（等价设计，附录 B），无 onClick 功能；满 9 张时**仍显示**（与上传无关）；`aria-label="风格"`。
- 颜色（§4）：底 `var(--fw-surface-dim)`，文字/图标 `var(--fw-text-dim-2)`，hover `bg-overlay-2`。
- 共享波及（用户拍板统一生效）：VideoConfigPanel 同渲染此组件，视频面板同步获得 [风格][参考][缩略图] 新工具行，**不加隔离 prop**；缩略图实际 50×50（56 按钮与其同排高差 6px，人工验收确认视觉，登记 §7）。

**A8 运行按钮**（RunButton.tsx）：换用户提供的 20×20 箭头 SVG（附录 C，stroke=currentColor strokeWidth 1.667 round）；`title="生成"`；颜色走新 token 对（§4）`bg-[var(--canvas-run-btn-bg)]` + 图标 `text-[var(--canvas-run-btn-icon)]`；尺寸保持 size-7；loading ⏳ 保留；ImageExt 面板随共享组件统一。**对比度（用户拍板）**：深档保参考值 rgb(145,145,145)（深面板底 4.81:1 达标），浅档加深至 ≥3:1（浅面板底 #f0f1f2 上参考值仅 2.78:1；具体值实现时经 scripts/contrast-table.mjs 定稿并补 contrast-pairs.json 配对）；测试断言用 `var(--canvas-run-btn-*)` 字符串而非解析 rgb（防 token 改名脆断）。参考代码的 `aria-describedby="«r8b»"` 为其运行时 artifact，不照抄。

**A9 分辨率**：RatioResolutionPopover.tsx:63 `['2K','4K']`→`['1K','2K','4K']`；两面板共享自动同步；默认 resolution '2K' 不变。**范围裁定：仅此一处**——EraseBottomToolbar（同一图片节点编辑态，['2K','4K']+COUNT_OPTIONS [1,2,3,4]）、VideoHDPanel、prompt-input / 命令 quality 项均不动（登记 §7-5）。

### 3.2 标题（需求 7，ImageGenNode.tsx）

**数据口径：mediaName 唯一真源**（修双数据源分叉——撤销/协作对端改名/重新生成写 mediaName 时本地 label 均不跟随，§2.1）：
- 显示一律读 `nodeData?.mediaName ?? 'Image'`，**删除本地 label state**；draft 仅作编辑缓冲；
- saveTitle：trimmed 非空 → `updateConfig(id, { mediaName: trimmed })`；空串沿用还原分支不写。updateConfig 走 mergeNodeData 全量合并不丢键，mediaName 不在 CANVAS_BRIDGE_KEYS 白名单、不触发画布全量 setState（零性能代价，nodeStore.ts:231/512-547 已核）。
- **语义联动（登记 §7-7）**：mediaName 同时是 @引用素材 chip 名（L179），改名连带改 chip 名——加断言承保。

**视觉**：图标 12×12→13×13；静态/编辑态字号 13px（lineHeight 同步，如 13/20px）。

**交互（ProjectTitle 式双态）**：
- **静态态**：span 渲染标题文本，单行截断（truncate），`nodrag select-none cursor-default`，`onDoubleClick` 进入编辑（stopPropagation 防画布手势/节点拖拽）；
- **编辑态**：渲染 input（draft/onChange/onBlur=saveTitle/Enter 失焦/Esc 还原沿用），**保留左侧图标与右侧尺寸文本**（用户拍板"保留占位减宽"），内层容器由幽灵 w-max 改 flex-1 → input 宽=节点宽−图标−gap−尺寸占位；挂载自动 focus + select()；
- **幽灵测量 span 机制删除**（其唯一职能"input 随内容增宽"被减占位全宽编辑取代；ImageGenNode.test L251 ghost 用例随之删除/改写）。

### 3.3 handle 拖拽弹菜单（需求 10）

**守卫逻辑抽纯函数 `shouldOpenHandleMenu(args) → boolean`**（独立模块可单测；CanvasView.test 真渲染 ReactFlow 拿不到 onConnectEnd prop，守卫内联在组件里不可测，§2.1）。onConnectEnd 内按序短路：

0. `reconnectingRef.current` → 复位并返回（**边端点重连手势复用同一拖拽通道**且传对端节点 id，§2.1；新增 prop `onReconnectStart` 置位。事件序 onReconnectStart→onConnectStart→…→onConnectEnd，**复位只能在 onConnectEnd 开头、不可"简化"提前到 onConnectStart**——否则拖边端点到空白松开会绕过本守卫、以对端节点 id 弹菜单建节点；另在 `onReconnectEnd` 内**再复位一次**双保险：Esc 取消重连走 cancelConnection 不触发 onConnectEnd、标志留存会静默吞掉下一次真实拖拽，而正常重连结束时紧随 onConnectEnd 的重复复位无副作用）；
1. `state.isValid === true` → 返回（正常连线已由 onConnect 建边）；
2. `state.toHandle !== null || state.toNode !== null` → 返回（松手落在 handle 上，含"类型不合法 handle"组合——isValid=false 但 toHandle!=null 不算空白松手。**toNode 由 toHandle 派生、仅覆盖 handle 命中，节点体松手时两者皆 null**）；**节点体命中单独判定**：松手画布坐标经 screenToFlowPosition 换算后做点-矩形包含（对全部节点 positionAbsolute+measured bbox，纯函数接收 nodes+flowPoint，与守卫同模块单测）→ 命中任一节点即返回——"落在节点体上不弹"（§8-10）由该判定承保，只判 toNode 是空头承诺；
3. 起点节点 type ∉ {imageGen, imageExtGen} → 返回（两类图片节点，用户拍板）；
4. `isLocked` → 返回（不绕过锁定语义）；
5. 位移 < 5px → 返回（原地松开的假拖拽；纯点击下 onConnectStart/End 本就不触发，此为第二道防线）；
6. 通过 → `menuStore.openHandleMenu({ x, y, nodeId, side })`。

- **clientPoint 工具**：event 为 MouseEvent | TouchEvent，TouchEvent 无 clientX——`'clientX' in e ? e : e.changedTouches[0]` 统一取点（onConnectStart 记起点、onConnectEnd 取落点均用；缺此工具则 tsc 报错或触摸定位 NaN）。
- **实现注意**：onConnectStart 的起点坐标/handleType 经 ref 或函数式更新写入，确保 onConnectEnd 同 tick 读到最新值（闭包旧值会让位移判定失真）；flowPoint 在调用守卫前换算一次、建节点复用同值。
- click-to-connect 走独立 onClickConnectStart/End 事件对，不监听、不误弹。

**menuStore 扩展**：新增 `handleMenu?: { x; y; nodeId; side }` + openHandleMenu/closeHandleMenu；**双向互斥**——openHandleMenu 先 `set({ isOpen:false, position:undefined })`，既有 open() 开头清 handleMenu（否则右键画布与 handle 菜单会同屏渲染）。不进 nodeStore（避免全节点订阅抖动）。

**HandleAddNodeMenu 组件**（新文件，挂 page.tsx 与 AddNodeMenu 并列，统一 z-index 层）：fixed 定位松手坐标 +8/+8、边界钳制对齐 AddNodeMenu L167-178；**关闭机制照抄 AddNodeMenu：背板遮罩（`fixed inset-0 z-[calc(var(--z-panel)-1)]`）+ Escape**——不用 document mousedown（不把 A2 正在修的"mousedown 先于 click"缺陷再引入一遍）：
- `side==='source'`（右拖，产出向）：文本/图片/视频/音频 4 项；`side==='target'`（左拖，引用向）：文本/图片 2 项；
- 图标：文本/图片/视频用附录 D SVG，音频内联等价（20×20/viewBox 32 风格）；类型映射 textInput/imageGen/videoGen/audioGen（nodeTypeMap 别名可达）。

**建节点+连线**：
- `screenToFlowPosition({ x: p.x, y: p.y })` **传裸坐标**（函数内部已减容器 rect，§2.1；onDrop 的减 rect 写法系巧合无害，不效仿）；
- 新节点位置 = 松手点 − 半宽/半高（中心对齐；偏移沿用 −125/−30 惯例）；`addNode(type, pos)`（默认选中 → 图片新节点直接弹配置面板，符合直觉）；
- 连线：右拖 `addEdge(原, 新, undefined, undefined, handleEdgeId(原, 新))`；左拖 `addEdge(新, 原, undefined, undefined, handleEdgeId(新, 原))`——**新确定性 id 前缀 `handle:${source}:${target}`**（不用 auto:/auto-out:：那两条前缀是协作/撤销的**通道路由**——Origin.AutoEdge 不入撤销栈、被 syncAutoEdgesToDoc 独占同步、videoEdit planAutoEdgeOps 按泛前缀对账误删，§2.1。handle: 前缀走 LocalUser 常规通道：与 addNode 同 origin 同撤销步（Ctrl+Z 节点+边一起撤）、常规协作双向同步、addEdge 幂等兜底仍成立）；
- `closeHandleMenu()`。

## 4. 颜色 token 方案（css-audit 门禁合规）

| 用途 | 写法 | 深档值 | 浅档值 | 说明 |
|------|------|--------|--------|------|
| 风格/参考按钮底 | `var(--fw-surface-dim)` | #262626 | #f0f1f2 | 复用现有语义 token（"输入底/凹陷区"语义吻合；浅档≈参考值 #F2F2F2） |
| 风格/参考按钮文字/图标 | `var(--fw-text-dim-2)` | rgba(255,255,255,.45) | #6b7280 | **有意偏离**参考值 #9C9C9C（≈dim-1 #9ca3af）：B0 裁定 dim-1 刻意低于 AA 仅装饰层，按钮标签是功能文本 |
| 按钮 hover | `bg-overlay-2`（现有类） | — | — | 现有 overlay 阶梯 |
| 运行按钮底 | 新 `--canvas-run-btn-bg` | rgb(145,145,145) | rgb(135,135,135)（初值 ≈3.1:1，以 contrast-table 校验定稿；参考值 2.78:1 不达标，用户拍板加深） | 深档保参考值（深面板底 4.81:1 达标） |
| 运行按钮箭头 | 新 `--canvas-run-btn-icon` | #141414 | #141414 | 近黑两档同值（灰底上 ≈6:1 达标） |
| 数量按钮图标 | `currentColor` | — | — | 随按钮文字色，零新增色 |

新 token 对写入 index.css 既有深块与**唯一 .light 块内**（b1-token-migration.spec L331 守卫禁另起块，源序在后）；双值登记进 e2e/b0-token-blocks.spec.ts 的 DOMAIN_TOKENS/DOMAIN_DARK/DOMAIN_LIGHT 表；canvas-migration-registry.json L2363 已预登记 RunButton:14→var(--canvas-controls-bg) 裁定，本次改色属推翻预登记，按 C8 惯例做变更登记条目；contrast-pairs.json 补 run-btn 配对。

## 5. 测试计划（TDD，每步先红后绿）

| 步骤 | 测试（先写，跑红） | 实现 |
|------|---------------------|------|
| P0 数量选择器 | ① **mousedown+click 真实序列**：`fireEvent.mouseDown(btn); fireEvent.click(btn)` 开 → 同序列再点 → **关**（fireEvent.click 不派发 mousedown，纯 click 用例在 bug 存在时也绿——缺陷曾藏于该覆盖缺口；修复前此用例必红）② 点 body 关闭（回归）③ 按钮内含 svg ④ 触发器 `1张`；菜单 1张/2张/4张、`queryByText('8张')` 为 null。**作用域**：触发器断言 `within(getByTestId('canvas-node-image-count-select'))`；菜单断言 `within(getByTestId('canvas-node-image-count-menu'))`——A2 顺手给菜单容器加该 testid（菜单是触发器 relative 容器内的兄弟节点，within(触发器) 够不到菜单，「无 8」断言会空过假绿）。EraseBottomToolbar 与本面板互斥渲染（Resolver 仅 !fileId&&!referenceImage、Erase 仅 editMode=erase/redraw），同屏概率≈0——收窄属防御性实践非必然冲突 | A2 全部（含菜单 testid）+ aria-label 中文化；**同步改 ImageConfigPanel.test 10 行数量断言**（5 个 it，L265-306：×→张、删 8× 行；L272-279 tooltip 用例文案不变）；ImageExtConfigPanel.test 无数量断言（已核实）不动；imageExtNodeApi.test L94 fixture 为 API 透传断言**保持不动**（见 A2） |
| P1a 输入区 | ① placeholder 文案（编辑器 data-placeholder attr）② `.prompt-editor` 规则含 `cursor: text` ③ `.command-chip` 补 `cursor: default`（image-chip 内联 default 不受影响；command-chip 现无 cursor 声明、不补会变 I 型） | A1 + A3 |
| P1b 工具行 | ① DOM 顺序：upload-button 在首个缩略图之前 ② `getByRole('button', { name: '风格' })` 存在 ③ 参考按钮含「参考」文字且仍触发 file input 点击（mock） | A4/A5/A6；VideoConfigPanel 随共享组件统一生效（不单独断言） |
| P1c 运行按钮 | ① `title="生成"` ② 含 20×20 svg ③ class 指向 `var(--canvas-run-btn-*)`（字符串断言，不解析 rgb） | A8 |
| P1d 分辨率 | 弹层内 1K/2K/4K 三选项 | A9 |
| P2a 标题 | **观测口径（mediaName 唯一真源下，空壳 mock 会让"值正确"类断言假红/假绿）**：(a) 行为断言——blur 后 `expect(updateConfig).toHaveBeenCalledWith(id, { mediaName: '...' })`（空串还原分支不调；Esc 不调）；(b) 显示断言——测试内让 mock 的 updateConfig 真实回写 mockNodeData 并触发重渲（或直接改 mockNodeData.mediaName 后断言 span 文本）。用例：① 双击前无 input[aria-label="节点标题"]、span 静态显示 mock 的 mediaName ② 双击后 input 出现且 value 正确（fireEvent.doubleClick 在 jsdom 不真聚焦——显式 `input.focus()` 或仅断言编辑态存在，不断言 toHaveFocus）③ 宽度：jsdom 量不到布局——断言 input 挂 flex-1/w-full 类 + 外层容器 width: nodeWidth，**实宽=节点宽−占位属人工验收** ④ 字号/图标 13 断言 ⑤ 改名后 @引用 chip 名联动（L179） | 3.2；ImageGenNode.test L226-258 四条 focus 用例改双击驱动、L251 ghost 用例删除 |
| P2b handle 菜单 | 守卫走 **shouldOpenHandleMenu 纯函数单测**（ReactFlow 真渲染拿不到 onConnectEnd prop）：① isValid 非 true + 位移 30px + imageGen + 未锁 → true（source/target 两分支）② isValid===true → false ③ **toHandle/toNode 非 null（handle 命中）→ false** ③′ **flowPoint 落入节点 bbox（点-矩形包含）→ false** ④ **reconnecting → false** ⑤ 位移 3px → false ⑥ isLocked → false ⑦ 非 imageGen/imageExtGen → false。接线与建节点走 store 断言：选「文本」→ addNode + addEdge 以 `handle:` 确定性 id 调用（**CanvasView.test 的 useCanvasStore mock 现缺 addEdge 键——属覆盖缺口而非"必崩"**：现状 onConnect 被 mock 为 vi.fn() 从不触达它；P2b 补该键并让相关 mock 真实委派，才能观察调用） | 3.3 全部 |
| 收尾 | `pnpm vitest run` 全绿 + lint-gate 0 新增（no-color-hex baseline 冻结禁重建）+ css-audit exit 0 + contrast-table 自检（新 token 配对）+ b0/b1 token 守卫测试绿 | — |

## 6. 执行顺序（按可回滚性）

P0（数量选择器，独立零依赖）→ P1 纯展示批（a 输入区 → b 工具行 → c 运行按钮 → d 分辨率，相互独立）→ P2 交互批（a 标题 → b handle 菜单）→ 收尾门禁 + 浏览器人工验收（重点需求 1/7/8/10 的视觉与手势）。

## 7. 范围外登记项

1. **useDismissablePopover**：仓内"document mousedown 外点关闭"手写模式实测 **14 处**（grep 实证：RatioResolutionPopover/GenerateCountSelector/EraseBottomToolbar:115/AudioConfigPanel:43/ImageExtConfigPanel:83/TextConfigPanel:38/VideoConfigPanel:70,78,86/AiToolActionPopup:30/TextNodeToolbar:67/CommandMentionList:104/ImageMentionList:68/FolderContextMenu:79），共享"触发器漏 stopPropagation 即关不上"的系统性模式缺陷（现存测试只覆盖点 body 关闭、从未覆盖点触发器关闭——GenerateCountSelector bug 即藏于此缺口，P0 用例已补）。**触发条件早已满足；本次裁定：仍不抽（控制 diff），下一次触碰任一 popover 时必须抽 hook 统一**。本次 HandleAddNodeMenu 用背板方案规避同类缺陷。
2. **resolution→定价链路断裂（存量，非本次引入）**：前端 '2K' 标签 vs 定价库 resolutionId（seed-res-*-1024 形态）永远 miss → execute 被校验挡掉且静默卡 loading（execution.service.ts:182、validation.service.ts:49、api-caller.service.ts:270/282 三方语义错位：标签/主键 id/像素解析）。独立 spec 级任务：需裁定 resolutionId 语义（标签 vs id vs 像素）+ seed 数据对齐 + error 状态透传。已追加至上线前必修项登记（#19）。**补强（已核实）**：imageExt 节点 resolution 存于 data.extConfig.resolution（snapshot-filter.util.ts:35-36 白名单剥离根级）→ 对 imageExt 根级恒为 null；前端报价预览 /api/pricing/calculate 不传 resolutionId → creditCost 必然 miss 显示 0；storyboard 域 VALID_RESOLUTIONS=['2K','4K'] 与视频域 @IsIn 白名单**勿动**；validateAll 遍历全批，一条 miss 连带挡掉同批其它节点。
3. **apiKey 明文**（api-caller.service.ts:53-72）：已在登记项 #14，不重复处理。
4. **风格按钮功能与 style 字段断链**：ImageNodeData.style 存在、后端 execution.service 半透传，但前端 buildImageGenParams 不带、apiCaller 不发上游——留待风格功能正式设计（含样式列表数据源）时一并接通；本次仅外观（用户两次拍板），**按钮点击无反应是预期行为**（开发期无用户，不加 disabled/title 提示）。
5. **其余分辨率/数量入口不动（已知不一致，不统一）**：EraseBottomToolbar（同一图片节点编辑态，与配置面板互斥渲染）——其 RESOLUTION_OPTIONS ['2K','4K'] 无 1K、其 COUNT_OPTIONS [1,2,3,4] 含 3，与配置态 [1,2,4] 无 3 构成**已知两处档位不一致**，验收时属预期；另 VideoHDPanel、prompt-input / 命令 quality 项、VideoConfigPanel 自带数量下拉（:61-62 纯 UI）均不动。
6. **拖拽菜单其余节点类型**：本次范围 imageGen+imageExtGen；文本/视频/音频节点接入=shouldOpenHandleMenu 类型集合放宽一行。
7. **杂项**：存量 extConfig.generateCount=8 显示「8张」而菜单无 8 项（不迁移数据，A2）；VideoConfigPanel.tsx:430 与 GenerateCountSelector 同名英文 aria-label（`Generate N variations`）改中文后两处文案不一致，VideoConfigPanel 不在本次范围、留待其面板政版时对齐；缩略图实际 50×50 与 56 按钮同排高差 6px（人工验收确认视觉可接受）；PromptInput.css .thumbnail-item 64px 为死代码（不引用不删，仅指出）；mediaName 改名连带 @引用素材 chip 名（ImageGenNode.tsx:179，语义合理、加断言承保）；参考代码 aria-describedby="«r8b»" 为运行时 artifact 不照抄；**screenToFlowPosition 双重相减 2 处存量**（onDrop L258-263 / handlePresencePointerMove——函数内部已减容器 rect，现仅因画布容器 rect 原点恰为 (0,0) 而无害，改动画布布局前必须一并修，本次不动）。
8. **组内空白松手弹菜单（group 过滤裁定）**：absoluteRectsOf 将 group 类型节点排除在节点体命中判定外——组是容器非实体节点，往组内空白处松手仍弹添加节点菜单（与顶层空白一致）；组内实体节点体上松手不弹（绝对坐标解析承保）。

## 8. 验收清单（对应 10 项需求）

1. 悬停输入区（含空态）鼠标为 I 型；image-chip/command-chip 保持 default（命令项保持 pointer）✓自动+人工
2. 数量按钮：再点关闭 ✓；图标前缀 ✓；1张/2张/4张、无 8 ✓
3. 空输入区显示「描述你想要生成的画面内容，@引用素材」✓
4. 风格按钮在参考左侧、56×56、仅外观（点击无反应是预期）✓
5. 参考按钮 56×56、点击仍可上传 ✓；视频面板随共享组件同步新工具行 ✓
6. 上传后缩略图出现在参考按钮右侧 ✓
7. 标题/图标 13px；双击进编辑、框宽=节点宽−图标/尺寸占位；Enter/失焦保存、Esc 还原；改名后撤销（与建操作同栈回滚）/协作对端改名本地同步/刷新后保留（mediaName 唯一真源）✓逻辑自动+视效人工
8. 运行按钮 20px 新箭头、灰底黑箭头（浅档加深 ≥3:1）、title=生成 ✓
9. 分辨率弹层 1K/2K/4K 三选项（Image 与 ImageExt 两面板）✓
10. 右 handle 拖到**画布空白处**松开弹 4 项菜单/左 2 项（imageGen 与 imageExtGen 两类节点）；落在 handle/节点体上不弹（组内空白弹/组内节点体不弹——group 过滤裁定）（guard 2 点-矩形判定承保）；拖边端点重连不弹；Esc 取消重连后下一次真实拖拽仍能弹（双复位）；建节点中心对齐松手点并自动连线（Ctrl+Z 节点+边同栈撤销）；点 handle 不拖不弹；锁定态不弹 ✓jsdom 逻辑+人工手势（拖拽手势自动化不可行，浏览器验收）

## 附录 A：数量按钮图标（用户提供，fill 改 currentColor）

16×16 viewBox="0 0 16 16"，fill-rule="evenodd" clip-rule="evenodd"，path：
`M8.00016 1.33252C8.46405 1.33252 8.89912 1.33708 9.31592 1.34619C9.8305 1.3575 10.3352 1.52823 10.7489 1.84749C11.8025 2.6608 12.5088 3.3675 13.2795 4.35921C13.8428 5.08443 14.1295 5.97534 14.144 6.87614L14.1532 7.99984C14.1532 8.26775 14.1497 8.53448 14.1466 8.79997C14.1472 8.82905 14.1492 8.85832 14.1493 8.88786C14.1492 8.90698 14.1474 8.92593 14.1453 8.9445C14.1301 10.0648 14.0892 11.1624 14.0223 12.2297C13.9442 13.4716 12.9577 14.4593 11.7183 14.5448C10.5426 14.6256 9.40591 14.6678 8.00016 14.6678C6.59439 14.6678 5.45774 14.6256 4.28206 14.5448C3.04244 14.4595 2.05616 13.4717 1.97803 12.2297C1.89234 10.8641 1.84717 9.4489 1.84717 7.99984C1.84717 6.55087 1.89234 5.1361 1.97803 3.77067C2.0561 2.52857 3.04236 1.54082 4.28206 1.45557C5.45772 1.37474 6.59436 1.33252 8.00016 1.33252ZM8.00016 2.33252C6.61687 2.33252 5.50303 2.37436 4.35042 2.45361C3.60933 2.50461 3.0225 3.09414 2.97607 3.83382C2.89173 5.17804 2.84717 6.57158 2.84717 7.99984C2.84717 9.42819 2.89172 10.8222 2.97607 12.1665C3.02256 12.9061 3.60935 13.4957 4.35042 13.5467C5.503 13.626 6.61685 13.6678 8.00016 13.6678C9.38347 13.6678 10.4973 13.626 11.6499 13.5467C12.3909 13.4956 12.9778 12.906 13.0243 12.1665C13.0929 11.0725 13.1333 9.94559 13.1466 8.79411C13.1226 7.74073 12.6935 7.19336 12.1636 6.87549C11.5742 6.52209 10.8001 6.41763 10.1076 6.39762C9.292 6.37398 8.59521 5.73532 8.59521 4.87549V2.33512C8.4021 2.33329 8.20407 2.33252 8.00016 2.33252ZM9.59521 4.87549C9.59521 5.15103 9.81774 5.38838 10.1369 5.39762C10.8715 5.41887 11.8606 5.52796 12.6779 6.01807C12.8208 6.10379 12.9561 6.2013 13.0835 6.30908C12.9907 5.82096 12.7917 5.36183 12.4897 4.97314C11.7717 4.04921 11.1262 3.40183 10.1382 2.63916C9.97871 2.51607 9.7929 2.4304 9.59521 2.3846V4.87549Z`

## 附录 B：风格/参考/音频图标

内联等价 SVG（项目无文件资产惯例）：风格=滤镜/调色盘意象、参考=图片/回形针意象、音频=音波意象；20×20，stroke 或 fill 随 `currentColor`。实现时从 @ant-design/icons 或手写 path 取形，视觉贴近参考产品同名按钮。

## 附录 C：运行按钮 SVG（用户提供原样）

`<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4.16699 9.99996L10.0003 4.16663M10.0003 4.16663L15.8337 9.99996M10.0003 4.16663V15.8333" stroke="currentColor" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"/></svg>`

## 附录 D：菜单项 SVG（用户提供，文本/图片/视频；音频等价补齐）

- 文本：`<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="7" y="8" width="18" height="16" rx="3" stroke="currentColor" stroke-width="2.2"/><path d="M11 13H21M11 18H18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`
- 图片：`<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="7" y="7" width="18" height="18" rx="4" stroke="currentColor" stroke-width="2.2"/><path d="M10.5 21L14.2 16.7L17 19.5L19.2 16.8L22 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12.5" cy="12.5" r="1.5" fill="currentColor"/></svg>`
- 视频：`<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect x="7" y="8" width="18" height="16" rx="4" stroke="currentColor" stroke-width="2.2"/><path d="M14 13.2V18.8L19 16L14 13.2Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/></svg>`
- 音频：等价内联（音波/音符意象，同规格）。

