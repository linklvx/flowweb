# C8 D4 性能实测双探针留痕（Task 27，2026-09-20）

> 一次性脚本 e2e/tmp-d4-perf.mjs 已删（原始读数 JSON 未留档，本文为结论真身）。环境：dev server 5173（Vite dev 产物，非 preview 构建——性能读数为辅据，规格见 plan Step 2）+ API dev 3000/collab 3001；Playwright headless chromium 1280×800，storageState=e2e/.auth/user.json。

## 1. 性能实测①——render 计数复验（主据）

`npx vitest run src/pages/canvas/components/CanvasView.theme-perf.test.tsx` → **1 passed（4.36s）**。

- 前置自证：节点确已渲染（mock 2 节点 `[data-testid="perf-node"]` ×2 在 DOM）；**首渲染计数 2**（与 D2 首跑"首渲 2"同形——test 文件自 Task 18 加固 commit `7b240030` 后零改动，D3 大面积节点组件迁移未破坏 memo 链）。
- `setMode('light')` 一次后**节点组件 render 增量 = 0**（断言口径不变：同步 uSES 冲刷窗口内计数）。
- 结论：D3 后主题切换仍只有 CanvasView 自身重渲，节点组件零重渲——`nodes/{groups}` 禁 useTheme 的机制收益实证保持。

## 2. 性能实测②——大画布切换读数（辅据）

规模：**50 节点画布**（临时 scratch 画布经 `POST /api/canvases` 创建、UI 添加节点菜单逐次加 50 个文本节点（实测 DOM `.react-flow__node` = 50），测毕 `DELETE /api/projects/:id` 删除（status 200）；gate 画布零残留）。三域读数均经"深⇄浅双向"：

| 域 | 场景 | setMode 同步段（performance.now 包裹） | 切换后 1s 窗 rAF 计帧 | long-animation-frame（>50ms） |
|---|---|---|---|---|
| canvas | 50 节点深→浅 | **0.0ms** | **60**（零掉帧） | 无 |
| canvas | 50 节点浅→深 | **0.1ms** | **60** | 无 |
| canvas | 50 节点+素材库 Modal 开启态 深→浅 | **0.1ms** | 60 | **1 帧 53.8ms**（antd cssinjs 重注入+Modal 树重渲） |
| videos | 深→浅 / 浅→深 | 0.1ms / 0.0ms | 60 / 60 | 无 |
| video-editor | 深→浅 / 浅→深 | 0.1ms / 0.1ms | 60 / 60 | 无 |

- 空闲基线 rAF：三页 55.7~61.0 fps（headless 波动），切换后窗计帧恒 60——**50 节点画布切换零掉帧**；全表唯一长帧 = Modal 开启态 53.8ms（≈1 掉帧当量，见上）。
- React 提交时序：body/html 类（setMode 直改 DOM）同步段即翻；`.react-flow` 画板底（React colorMode 驱动的 wrapper 类）在同步段后、首个 rAF 采样前落定（sync-lane 微任务提交）——**下一帧绘制前完成，无一帧视觉延迟**；板底实测值 rgb(0,0,0)→rgb(245,245,245) 与 D2 登记 pair 同值互证。
- ⚠ 机制外现象辨析：videos VideoCard 与画板部分表面观感为 ~150ms 渐变（rgb 30→255 分 10 帧阶梯）——来源是产品侧 `transition-colors duration-150`，非主题传播机制延迟；机制层翻转（类/样式注入）均同帧完成。

## 3. antd cssinjs 晚一帧观察（三域同帧与否——plan Step 2 登记）

MutationObserver（head 内 style 节点增/改）+ rAF 逐帧采样，切一次各域读数：

| 域 | cssinjs style 变更条数 | 首条时间戳相对 setMode | 帧归属 |
|---|---|---|---|
| videos（Tabs 挂载） | 88（深→浅）/ 60（浅→深） | 同步段内（t0+0.1ms 量级，先于首 rAF 采样） | **同帧** |
| video-editor（Slider 等挂载） | 150 / 122 | 同步段内 | **同帧** |
| canvas（MaterialLibrary Modal 挂载） | 62（Modal 开启态） | 同步段内 | **同帧** |

- **结论：三域同帧，无"晚一帧"**——antd cssinjs 在 setMode 调用栈内（useToken 重渲→style 同步重注入）完成，先于下一次绘制；浅色实测 `.ant-modal-content` 底 rgb(30,30,30)→rgb(255,255,255) 与非 antd 面同一采样帧内翻白。
- 附注：canvas 域常态（无 Modal 挂载 antd 组件时）cssinjs 仍有 70/42 条变更（effect 类与已挂载 antd 组件样式），同步段内完成；ve 域 `.ant-slider` 容器底为透明非可辨色标，antd 翻转证据以 videos Tabs/canvas Modal 实测为准。

## 4. 环境复原自证

- gate 画布临时 videoEdit 节点（ve 域测量用）加删后 `.react-flow__node` 计数 = 2 断言通过（与 a0 采集 spec 清理模式同构）。
- scratch 画布已删除（DELETE status 200）；主题切换仅发生在一次性浏览器上下文 localStorage，user.json/.auth 存储态未污染。
