# A4-c 涌现裁定注册表（摘要）

- 生成：2026-09-18 · 基线 commit `e37414e8`（A4-b 后）· 冻结审计 `audit-A0.json`（commit 137c29af，行号已按 file+ctx 重定位）
- 复扫快照：`audit-A4c.json`（bare 118 / colored 144 / divide 1 site / textarea 6 —— 与冻结值一致，A4-a/b 未触及本族）
- 机器可读明细：`emergence-adjudication-A4.json`（A5 消费）

## 结论一览

| 族 | 数量 | 裁定 | 说明 |
|---|---|---|---|
| 裸 border（宽度无 hex 色） | 118 | **保留 118 / 修剪 0** | 见下方分解 |
| └ 非零宽度·代码位 | 33 | 全保留 | 全部携带显式色证据：同串色类 / 模板双分支色 / inline borderColor——涌现边框均为设计色，无一命中默认 #333 |
| └ border-0·代码位 | 72 | 批量保留 | 宽 0 无涌现；与 preflight 冗余但防御性保留（antd 宿主仍压制 antd border-width） |
| └ 测试文件项 | 13 | 随代码保留 | 断言/描述串；修剪为 0 故无需同步 |
| border-[color]（宽度+显式 hex/var） | 144 | 批量保留，异常 0 | 色值与表面自洽；VideoEditNode 浅色值=白皮节点自洽（bg-white 卡） |
| divide（TeamBillingPage.tsx:140） | 1 site | 登记涌现，不编辑 | 现状无分隔线 → 涌现 1px rgba(255,255,255,0.05)（divide-y + divide-white/5） |

**为什么修剪为 0**：审计的"裸"判据只看同字面量串内有无 border 色类；逐一复核 33 个非零代码位，色证全部由 ① 同串色类（如 `border border-white/[0.1]`）② 模板另一分支（如 `border ${active ? 'border-[#4ade80]' : 'border-transparent'}`）③ inline `borderColor`（AnnouncementBar/AddNodeMenu/AnnotationToolbar/EraseBottomToolbar）提供。唯一同串真无色的 AnnotationToolbar 色板钮（`border border-solid`）有 inline borderColor 三态取值。修剪判据（wrapper/ghost、模板残渣、双线/挤压）无一命中。

## §2.3 附带审计

- **死视觉（无 bg 依赖 border 成视觉）**：0 处破损。四处 `border-[#363636]` 弹层根有 inline `oklab(0.269/0.95)` 底 + blur；CreditsDropdown 卡有 inline 渐变；MultiImageNode 图层帧有 inline 半透明底（叠于图像上 by-design）。
- **textarea 对比度（6 清单位，静态 WCAG 计算，登记不修）**：6/6 正文 AAA——PromptInput 14.9:1、AudioConfigPanel 9.9:1、EraseBottomToolbar 10.6:1、TextConfigPanel 9.9:1、SaveAsTemplateDialog 12.4:1、PropertiesPanel(--ve) 12.3:1。顺带登记：placeholder 两处偏低（neutral-500≈3.2:1、#555≈2.1:1），既有弱化取舍。

## 视觉抽样验证（vite preview + gate 会话，getComputedStyle 实测）

| 页 | 元素 | 实测 | 结论 |
|---|---|---|---|
| /login | AuthModal 面板 + 邮箱/密码 input | 1px solid rgb(58,58,58)=#3a3a3a | sane |
| /works | WorkspaceTabBar 激活页签（裸 border-b-2） | 2px solid 白下划线，top/x 归零 | sane |
| /videos | VideoCard ×5 | 1px rgba(255,255,255,.1) on #1e1e1e | sane |
| /canvas | ProjectTitle+TopBar 药丸 ×4（#333） | 1px rgb(51,51,51) on rgba(26,26,26,.9) | sane |
| /canvas | AddNodeMenu 面板（裸 border+inline var） | 1px rgb(54,54,54) on rgb(38,38,38) | sane（截图留档） |
| /settings/credits | 卡片 ×2 + 充值金额钮（裸 border 双分支） | 选中 1px #5DDCFF/未选 1px #333 | sane——旗舰证据 |
| /templates | 页签 ×3（裸 border-b-2 双分支）+ 搜索框 | 激活 2px #4ade80/未选 transparent；1px #333 | sane |

未目验：antd 悬浮触发件（CreditsDropdown/AnnotationToolbar/EraseBottomToolbar 弹层——合成事件无法开启，antd5 怪癖）与未渲染的分页钮，按源码分支证据裁定。
