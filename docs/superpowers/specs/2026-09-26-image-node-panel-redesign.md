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
| 7 | 标题字号+图标 12→13px；双击进编辑；编辑框宽=节点横向宽 | ProjectTitle 式 span↔input；saveTitle 增加 `updateConfig(id, { mediaName: trimmed })` 回写（用户拍板纳入）；仅图片节点，其余 4 种节点不动 |
| 8 | 运行按钮换新 SVG；底 rgb(145,145,145) 灰、箭头黑 | 新增 token 对承载（§4）；尺寸保持 28px（不猜放大）；RunButton 为 Image/ImageExt 两面板共享，组件级统一生效 |
| 9 | 分辨率选项 2K/4K → 1K/2K/4K | **仅前端加选项**（用户拍板）；后端 resolution→定价链路断裂为存量问题，登记独立任务（§7） |
| 10 | 按住节点右/左 +号（handle）拖动松开弹添加节点菜单，选择后建节点+自动连线 | 右=文本/图片/视频/音频 4 项、左=文本/图片 2 项（按用户两份参考代码，**有意区分**）；**仅 imageGen 节点 handle 生效**；落点=松手位置 |

布局拍板：风格/参考按钮与缩略图同行（输入框上方），顺序 **[风格][参考(+号)] [缩略图...]**。

## 2. 现状事实（已实证，路径相对 apps/web/src，行号为当前快照）

- 图片节点：`pages/canvas/components/nodes/ImageGenNode.tsx`；标题区 L1067-1115（节点上方 `-translate-y-full`，12×12 内联图标 + **常驻 input** + 幽灵宽度测量 span L1078-1109，fontSize/lineHeight 12/18px）；label/draft/saveTitle 状态机 L250-270；标题只存本地 useState，**mediaName 从不回写**。
- 面板：`nodes/ImageConfigPanel.tsx`（w-[650px]，底栏 L130-156 = 模型 | 比例·分辨率 ‖ 数量 | 积分 | 运行）；`ImageExtConfigPanel.tsx` 与其共享 RunButton/RatioResolutionPopover/GenerateCountSelector（两调用点均不传 options）。
- 数量选择器：`config-panel/GenerateCountSelector.tsx`——触发按钮 L22-32 **无 onMouseDown stopPropagation**（对比 RatioResolutionPopover.tsx:45 有），document mousedown 关闭监听 L13-18；这就是"再次点击关不上"的根因（mousedown 先关 → click 再 toggle 打开）。
- 比例/分辨率：`config-panel/RatioResolutionPopover.tsx:63` `['2K','4K']`。
- 运行按钮：`config-panel/RunButton.tsx`——size-7（28px）、`bg-[var(--canvas-controls-bg)]`、12×12 箭头 `text-[#999]`、无 title。
- 输入：`prompt-input/PromptInput.tsx`（Tiptap，直接 return `<EditorContent/>` 无包装层；默认 placeholder L230「描述你想要的画面，输入 / 添加设置...」；渲染于 `PromptInput.css` L72-78）；`PromptInput.css` 的 cursor 声明仅 chip/命令项 pointer（L28），`.prompt-editor` 根无 cursor → 空编辑区鼠标为箭头。
- 缩略图行：`prompt-input/ImageThumbnailBar.tsx`——现状顺序 [缩略图(SortableContext L111-121)][+号(L123-134)]；`showUploadButton = !disabled && images.length < maxCount(9)` L96；dnd-kit 仅包缩略图。`config-panel/PromptEditor.tsx` L30-47 渲染顺序：ImageThumbnailBar 在 PromptInput 之上。
- handle：`nodes/NodeHandle.tsx`（target=左/source=右，圆+加号 SVG）；命中区 80×80 `cursor:crosshair`（NodeHandle.css L52-60）。
- 连线：`components/CanvasView.tsx`——onConnect L351（canvasStore.onConnect 建边、同源判重）；isValidConnection 仅禁自连 L242-246；**无 onConnectStart/onConnectEnd**；isLocked = activeEditNodeId !== null（L103）；screenToFlowPosition 项目惯例带容器 rect 偏移（onDrop L258-263、handlePresencePointerMove）。
- 类型（@xyflow/system 0.0.76 实证）：`OnConnectEnd = (event, connectionState: FinalConnectionState)`；FinalConnectionState 含 fromNode/fromHandle/toNode/toHandle/pointer/isValid；`OnConnectStart` 参数含 { nodeId, handleId, handleType }；click-to-connect 走独立 onClickConnectStart/End 事件对；connectOnClick 默认 true（不关闭）。
- store：`stores/canvasStore.ts`——addNode(type, position)（L182-217，**默认选中**）、addEdge(source,target,...,deterministicId)（L469-476，同 id 幂等 no-op）；`stores/autoEdgeIds.ts`——`autoEdgeId(editNodeId, sourceNodeId)`=`auto:${edit}:${src}`、`autoOutEdgeId(editNodeId, productNodeId)`=`auto-out:${edit}:${prod}`；**两类自动边均不入撤销栈**（canvasUndo.ts:6 刻意排除，外部审核"一入一不入"说法不成立，选前缀只按产出/引用语义）。
- 菜单：`components/AddNodeMenu.tsx` 双模式（menuStore position=右键坐标+8px / triggerEl=贴按钮），边界钳制 L167-178；handleItemClick L195-197 建节点**一律落视口中心**（无 anchor 语义，外部审核该说法不成立——需求 10 不能复用其落点）；挂载于 `page.tsx:307`。menuStore（stores/menuStore.ts:3-25）现有 isOpen/position/triggerEl/lastMousePos。
- 新节点默认尺寸偏移惯例：AddNodeMenu 用 `{ x: centerX - 125, y: centerY - 30 }`（≈节点半宽/半高）。
- 既有测试断言（需同步更新）：ImageConfigPanel.test.tsx L269 `'1×'`、L278 tooltip「生成数量」（后者不变）、L201-203 `'1:1'`/`'2K'`（默认 resolution 不变，仍通过）；ImageExt 面板测试同理检查。VideoConfigPanel **不用** GenerateCountSelector（自带内联下拉 VideoConfigPanel.tsx:61-62，count 同样纯 UI），**不受本次影响**。
- 后端（仅登记，不改）：resolution 全链路断裂——前端传 '2K' 标签 → `execution.service.ts:182`/`validation.service.ts:49` 拿它当 pricingRule.resolutionId 查库（库里是 seed-res-sdxl-1024 形态 id）→ 永远 miss →「无有效定价规则」挡掉整个 execute 且静默（不发 error 状态，节点卡 loading）；api-caller.service.ts:270/282 按 `'1024×1024'.split('×')` 解析、Number('2K')=NaN→1024 兜底。MODEL_CONFIG apiKey 明文（api-caller.service.ts:53-72）已在上线前必修项登记（#14），本 spec 不重复处理。

## 3. 设计

### 3.1 下拉面板（需求 1/2/3/4/5/6/8/9）

**A1 光标**：`PromptInput.css` 给 `.prompt-editor` 加 `cursor: text`。不加在外层容器——image-chip/命令项的 cursor:pointer 靠更具体选择器继续生效。

**A2 数量选择器**（GenerateCountSelector.tsx）：
1. 触发按钮补 `onMouseDown={(e) => e.stopPropagation()}`（与 RatioResolutionPopover L45 同款，修"再次点击关不上"）；
2. 按钮文字前加用户提供的 16×16 文档图标 SVG（path 见附录 A），`fill="currentColor"` 随按钮文字色，不引入新硬编码色；
3. 显示 `{count}×`→`{count}张`；菜单项 `1×/2×/4×/8×`→`1张/2张/4张`；默认 options `[1,2,4,8]`→`[1,2,4]`。
- spec 级登记（§7）：本项目手写 popover+触发器模式已有 3 处（比例分辨率/数量/本次新菜单），**第 4 个 popover 出现时必须抽 `useDismissablePopover` hook**；本次不抽（避免触及 RatioResolutionPopover 既有测试，控制 diff）。

**A3 占位文案**：PromptInput.tsx L230 默认值改「描述你想要生成的画面内容，@引用素材」。两图片面板（Image/ImageExt）经 PromptEditor 默认透传一齐生效；CSS 渲染机制（data-placeholder attr）不动。

**A4/A5/A6 工具行**（ImageThumbnailBar.tsx 重构行内顺序）：
- 新顺序：**[风格 56×56] [参考 56×56] [缩略图...]**（缩略图 SortableContext 移到按钮之后，dnd-kit 逻辑零改动）。
- 「参考」按钮：原 +号上传按钮改 UI——`h-[56px] w-[56px] flex-col items-center justify-center gap-[2px] rounded-[8px]`，内联参考图标 20×20 + 「参考」12px 文字；保留 onClick=handleUploadClick、隐藏 file input、`data-testid="upload-button"`、满 9 张隐藏（showUploadButton）逻辑。
- 「风格」按钮：同款样式，内联滤镜/调色图标（等价设计，附录 B），无 onClick 功能；满 9 张时**仍显示**（与上传无关）；`aria-label="风格"`。
- 颜色（§4）：底 `var(--fw-surface-dim)`，文字/图标 `var(--fw-text-dim-2)`，hover `bg-overlay-2`。

**A8 运行按钮**（RunButton.tsx）：换用户提供的 20×20 箭头 SVG（附录 C，stroke=currentColor strokeWidth 1.667 round）；`title="生成"`；颜色走新 token 对（§4）`bg-[var(--canvas-run-btn-bg)]` + 图标 `text-[var(--canvas-run-btn-icon)]`；尺寸保持 size-7；loading ⏳ 保留；ImageExt 面板随共享组件统一。

**A9 分辨率**：RatioResolutionPopover.tsx:63 `['2K','4K']`→`['1K','2K','4K']`；两面板共享自动同步；默认 resolution '2K' 不变。

### 3.2 标题（需求 7，ImageGenNode.tsx）

1. 图标 12×12→13×13；字号 12→13px——幽灵测量 span（L1078-1085）的 fontSize/lineHeight 与 input 的 style **必须同步改**（fontSize 13 + lineHeight 匹配，如 13/20px），否则宽度测量错位。
2. 交互改为 ProjectTitle 式双态：
   - **静态态**：渲染 span（文本 titleText），`nodrag select-none cursor-default`，`onDoubleClick` 进入编辑（stopPropagation 防画布手势）；
   - **编辑态**：渲染 input（现有状态机复用：draft/onChange/onBlur=saveTitle/Enter 失焦/Esc 还原），宽度=容器宽（容器已 `width: nodeWidth`，即编辑框与节点横向长度一致），挂载后自动 focus + `select()`；
   - 保存：saveTitle 内新增 `updateConfig(id, { mediaName: trimmed })`（无效空串沿用现有还原分支不写）。
3. 右侧 naturalSize 尺寸显示保留不动。
4. 风险与验收：本项是 10 项中交互最深的一项，jsdom 断言逻辑（双击前 input 不在文档、双击后出现且宽=nodeWidth、blur 回写 mock 断言）+ 浏览器人工验收双保险。

### 3.3 handle 拖拽弹菜单（需求 10）

**数据流**：
1. `onConnectStart(event, { nodeId, handleType })`：记录 `dragStart = { nodeId, handleType, x: clientX, y: clientY }`（仅拖拽通道；click-to-connect 走 onClickConnectStart/End 独立事件对，不监听、天然不误弹）。
2. `onConnectEnd(event, state)`（FinalConnectionState）：
   - `state.isValid === true` → 正常连线已由 onConnect 处理，直接返回；
   - 起点节点（dragStart.nodeId 查 nodeStore）`type !== 'imageGen'` → 返回（仅图片节点生效）；
   - `isLocked`（activeEditNodeId !== null）→ 返回（不绕过锁定语义）；
   - 位移 `< 5px`（clientX/Y 与 dragStart 差值）→ 视为原地松开的假拖拽，返回；
   - 其余 → `menuStore.openHandleMenu({ x: event.clientX, y: event.clientY, nodeId, side: handleType })`。
3. 菜单组件 `HandleAddNodeMenu`（新文件，挂 page.tsx 与 AddNodeMenu 并列，fixed 定位 `x+8, y+8`，边界钳制逻辑对齐 AddNodeMenu L167-178；外点/Esc 关闭）：
   - `side === 'source'`（右拖，产出向）：文本/图片/视频/音频 4 项；
   - `side === 'target'`（左拖，引用向）：文本/图片 2 项；
   - 图标：文本/图片/视频用用户提供的 SVG（附录 D），音频内联等价（同 20×20/32 viewBox 风格）；类型映射 textInput/imageGen/videoGen/audioGen。
4. 选择菜单项：
   - `screenToFlowPosition({ x: clientX - bounds.left, y: clientY - bounds.top })`（容器 rect 偏移=项目惯例）；
   - 新节点位置 = 松手点 − 节点半宽/半高（中心对齐松手点；偏移常量沿用 AddNodeMenu 的 −125/−30 惯例）；
   - `addNode(type, pos)`（默认选中 → 图片新节点直接弹配置面板，符合直觉）；
   - 连线：右拖 `addEdge(原, 新, undefined, undefined, autoOutEdgeId(原, 新))`；左拖 `addEdge(新, 原, undefined, undefined, autoEdgeId(原, 新))`（参数序=函数语义：autoOut(edit, product)/auto(edit, source)；两类均不入撤销栈，已实证，无行为差异）；
   - `menuStore.closeHandleMenu()`。
5. 菜单状态进 menuStore 新增 `handleMenu` 字段 + openHandleMenu/closeHandleMenu action（不进 nodeStore——避免全节点订阅抖动）；AddNodeMenu 原字段/行为零改动。

## 4. 颜色 token 方案（css-audit 门禁合规）

| 用途 | 写法 | 深档值 | 浅档值 | 说明 |
|------|------|--------|--------|------|
| 风格/参考按钮底 | `var(--fw-surface-dim)` | #262626 | #f0f1f2 | 复用现有语义 token（"输入底/凹陷区"语义吻合；浅档≈参考值 #F2F2F2） |
| 风格/参考按钮文字/图标 | `var(--fw-text-dim-2)` | rgba(255,255,255,.45) | #6b7280 | **有意偏离**参考值 #9C9C9C（≈dim-1 #9ca3af）：B0 裁定 dim-1 刻意低于 AA 仅装饰层，按钮标签是功能文本 |
| 按钮 hover | `bg-overlay-2`（现有类） | — | — | 现有 overlay 阶梯 |
| 运行按钮底 | 新 `--canvas-run-btn-bg` | rgb(145,145,145) | rgb(145,145,145) | 中灰两档同值（面板底深 rgb(38,38,38)/浅 #f0f1f2 上均可见） |
| 运行按钮箭头 | 新 `--canvas-run-btn-icon` | #141414 | #141414 | 近黑两档同值 |
| 数量按钮图标 | `currentColor` | — | — | 随按钮文字色，零新增色 |

新 token 对写入 index.css 深/浅两个块（遵守源序约束：.light 块在 :root,.dark 之后）；登记进 canvas-migration-registry 的既有流程按 C8 惯例执行。

## 5. 测试计划（TDD，每步先红后绿）

| 步骤 | 测试（先写，跑红） | 实现 |
|------|---------------------|------|
| P0 数量选择器 | ① 点击开 → 再次点击同一按钮 → 菜单关闭（当前必红：bug 复现）② 按钮内含 svg ③ 触发器文案 `1张`、菜单项 1张/2张/4张、无 8张 | A2 三处改动；同步改 ImageConfigPanel.test L269 `'1×'`→`'1张'` 及 ImageExt 对应断言 |
| P1a 输入区 | ① placeholder 文案 getByText/编辑器 attr ② `.prompt-editor` 规则含 `cursor: text`（读 CSS 断言） | A1 + A3 |
| P1b 工具行 | ① DOM 顺序：upload-button 在首个缩略图之前 ② `getByRole('button', { name: '风格' })` 存在 ③ 参考按钮含「参考」文字且仍触发 file input 点击（mock） | A4/A5/A6 |
| P1c 运行按钮 | ① `title="生成"` ② 含 20×20 svg ③ class/style 指向新 token | A8 |
| P1d 分辨率 | 弹层内 1K/2K/4K 三选项 | A9 |
| P2a 标题 | ① 双击前文档中无 input[aria-label="节点标题"] ② 双击 span 后出现且 `width === nodeWidth`（容器宽）③ 字号 13 断言 ④ blur 后 updateConfig 以 `{ mediaName }` 被调（mock 断言；空串还原分支不调） | 3.2 |
| P2b handle 菜单 | ① 模拟 onConnectEnd（isValid 非 true、位移 30px、imageGen、未锁定）→ 菜单出现且右=4 项/左=2 项 ② isValid===true 不弹 ③ 位移 3px 不弹 ④ isLocked 不弹 ⑤ 非 imageGen 不弹 ⑥ 选「文本」→ addNode+addEdge 以确定性 id（auto-out:原:新 / auto:原:新）调用（mock store 断言） | 3.3 全部 |
| 收尾 | `pnpm vitest run` 全绿 + lint-gate 0 新增 + css-audit exit 0 | — |

## 6. 执行顺序（按可回滚性）

P0（数量选择器，独立零依赖）→ P1 纯展示批（a 输入区 → b 工具行 → c 运行按钮 → d 分辨率，相互独立）→ P2 交互批（a 标题 → b handle 菜单）→ 收尾门禁 + 浏览器人工验收（重点需求 1/7/8/10 的视觉与手势）。

## 7. 范围外登记项

1. **useDismissablePopover**：手写 popover+触发器模式已有 3 处（RatioResolutionPopover/GenerateCountSelector/HandleAddNodeMenu），共享同一系统性缺陷（触发器漏 stopPropagation 即"关不上"）。**触发条件：第 4 个 popover 出现时必须抽 hook 统一**。本次不抽（控制 diff，不触 RatioResolutionPopover 既有测试）。
2. **resolution→定价链路断裂（存量，非本次引入）**：前端 '2K' 标签 vs 定价库 resolutionId（seed-res-*-1024 形态）永远 miss → execute 被校验挡掉且静默卡 loading（execution.service.ts:182、validation.service.ts:49、api-caller.service.ts:270/282 三方语义错位：标签/主键 id/像素解析）。独立 spec 级任务：需裁定 resolutionId 语义（标签 vs id vs 像素）+ seed 数据对齐 + error 状态透传。已追加至上线前必修项登记（#19）。
3. **apiKey 明文**（api-caller.service.ts:53-72）：已在登记项 #14，不重复处理。
4. **风格按钮功能与 style 字段断链**：ImageNodeData.style 存在、后端 execution.service 半透传，但前端 buildImageGenParams 不带、apiCaller 不发上游——留待风格功能正式设计（含样式列表数据源）时一并接通；本次仅外观（用户两次拍板）。
5. **其它节点类型接入拖拽菜单**：需求 10 仅 imageGen 生效；扩展=在 onConnectEnd 类型判断处放宽一行。
6. **VideoConfigPanel 自带数量下拉**（VideoConfigPanel.tsx:61-62，纯 UI）：不在本次范围，不动。

## 8. 验收清单（对应 10 项需求）

1. 悬停输入区（含空态）鼠标为 I 型；chip/按钮仍 pointer ✓自动+人工
2. 数量按钮：再点关闭 ✓；图标前缀 ✓；1张/2张/4张、无 8 ✓
3. 空输入区显示「描述你想要生成的画面内容，@引用素材」✓
4. 风格按钮在参考左侧、56×56、仅外观 ✓
5. 参考按钮 56×56、点击仍可上传 ✓
6. 上传后缩略图出现在参考按钮右侧 ✓
7. 标题/图标 13px；双击进编辑、框宽=节点宽；Enter/失焦保存、Esc 还原；刷新后标题保留（mediaName 回写）✓逻辑自动+视效人工
8. 运行按钮 20px 新箭头、灰底黑箭头、title=生成 ✓
9. 分辨率弹层 1K/2K/4K 三选项（Image 与 ImageExt 两面板）✓
10. 右 handle 拖出松开弹 4 项菜单/左 2 项；建节点中心对齐松手点并自动连线；点 handle 不拖不弹；锁定态不弹 ✓jsdom 逻辑+E2E/人工手势

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

