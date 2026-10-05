<!-- doc-status: canonical | anchors: - | superseded_by: - | verified_at: 2026-10-06 | verified_at_commit: 4af57719 -->
# CreditsDropdown 浅色主题设计稿（C8 Task 19 / P5）

> 产出：ui-ux-pro-max skill（浅深配对规则：分层方向反转 / 对比度对等 / 辉光降 alpha / token 驱动）。
> 深色档现状冻结（实现期 mode 分支，Task 23 落地）；本稿是浅档的目标值与逐处裁定表。
> 参照系：FlowWeb `--fw-*` 浅值体系（bg #f7f8fa / surface #ffffff / surface-dim #f0f1f2 / border #e5e7eb /
> overlay rgba(0,0,0,0.03–0.08)）与 login 营销页浅色语言（白面 / 柔和阴影 / 品牌紫点缀）。

## 一、层级结构（浅档）

| 层 | 深档（冻结） | 浅档（本稿） |
|---|---|---|
| 下拉容器 | 渐变 #111111→#171717→#101828 + zinc-900/90 边 | 渐变 #ffffff→#fafbfc→#f3f5f9（终段蓝灰呼应深档 #101828 蓝调）+ rgba(0,0,0,0.08) 边 |
| 容器投影 | 0 20px 60px rgba(15,23,42,0.16) | 0 20px 60px rgba(15,23,42,0.10)（浅档阴影略降、保留 elevation 分层——surface readability 规则） |
| 光斑层 | amber radial 0.20 + teal radial 0.16 + 白 4% 渐变 | **保留双 radial 光斑**（组件个性），alpha 降：amber 0.12 + teal 0.10；白 4% 蒙层→**白高光渐变** rgba(255,255,255,0.5)→transparent 38%（浅底用顶部提亮替代白蒙层） |
| 总额卡（嵌套） | 白 8%→3% 渐变 + inset 白 6% + border-overlay-2 | 黑 2%→1% 微暗渐变（浅底嵌套卡分层方向反转）+ inset rgba(255,255,255,0.8) 顶部高光 + border-overlay-2（已 token 化自动翻浅） |
| 积分数值 | 白→amber-100 渐变字 + amber 0.18 辉光 | #1f2329→#1f2329→#b45309（amber-700）渐变字——保"金调数字"个性且浅底可读（#b45309@#ffffff≈4.9:1）+ 辉光 alpha 降 0.10 |
| 图标底 | bg-zinc-900 | bg-zinc-100（浅档图标底） |

## 二、按钮裁定

| 钮 | 深档 | 浅档 | 依据 |
|---|---|---|---|
| 充值钮 :267 | bg-white + hover:zinc-100 + 白辉光 rgba(255,255,255,0.22) | **反转深钮**：bg-zinc-950 + hover:zinc-800 + 深辉光 0 18px 44px -12px rgba(15,23,42,0.18) | 白钮在浅底不成立（白上白）；反转深钮保 primary-action 唯一性；深档白族字面冻结（通道 3）不受影响——浅档分支换值 |
| 邀请钮 :282-288 | rgba(255,255,255,0.04) 渐变 + inset 白 5% | rgba(0,0,0,0.02) 渐变 + inset rgba(255,255,255,0.6) 高光 | 分层方向反转同总额卡 |

## 三、命名色清单逐处裁定表（第七轮 P1-3——五通道皆不可见面，本表是唯一核销依据）

| 位点 | 深档 | 浅档裁定 | 值 |
|---|---|---|---|
| :125 | border-zinc-900/90 | 换等效 | rgba(0,0,0,0.08) |
| :179 | text-violet-200/80（订阅积分） | 换等效 | text-violet-700/80 |
| :184 | text-amber-200/85（奖励积分） | 换等效 | text-amber-700/85 |
| :255 | text-amber-100/70（说明文字；@深底≈1.05 不可见类） | 换等效 | text-amber-800/70（#92400e，浅底可读） |
| :270 | bg-amber-200/40（徽章底，装饰光斑） | 浅档等效 | bg-amber-100/60 + 字色 amber-900 |
| :271 | bg-zinc-900（图标底） | 换等效 | bg-zinc-100 |
| :275 | text-zinc-950（充值钮字） | 随钮反转 | text-zinc-50（白字@深钮） |
| :276 | text-zinc-500（小字） | 换等效 | text-zinc-600 |
| :278 | text-zinc-400 / group-hover:text-zinc-700 | 换等效 | text-zinc-500 / group-hover:text-zinc-800 |
| :292 | bg-rose-300/15（角标底，装饰光斑） | 浅档等效 | bg-rose-100/40 + 字 rose-700 |
| :268 | 白辉光 boxShadow | 随钮换 | rgba(15,23,42,0.18) 深辉光 |
| :287-288 | 白 4% 渐变 + inset 白 5% | 换等效 | 见二（邀请钮行） |

## 四、与 login 营销浅色语言的参照关系

login 浅色语言 = 白面层级 + 柔和大投影 + 品牌紫（#6C5CE7 系）点缀。本稿容器白渐变/降 alpha 投影与其"白面 + 柔影"一致；总额卡的 amber/teal 光斑与积分数值的 amber 渐变是积分组件专属个性（login 无对应物），按"浅底降 alpha / 深色变体"规则保个性不抢层级——品牌一致性由容器中性白 + 边框体系承担。

## 五、实现注记（Task 23 消费）

- 深档字面全部冻结（differ 深侧零 diff——Popover 未展开时采集面无此 DOM，两侧皆无 diff，机制见 registry）。
- 浅档分支：组件内 `const { mode } = useTheme()` 分支取值（CreditsDropdown 在 CanvasTopBar 域，非 React Flow 节点，不受 §11.1 禁令）。
- 每处浅值落地时按 registry `styleObjects`/盲区核销口径登记 adjudications。
