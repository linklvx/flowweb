# A5 三层基线 diff 报告（before-A0 × after-A）

- before：`before-A0` @ 137c29af11523085273edb085bbb14f078673da7（采集 2026-09-18T16:41:29.639Z）
- after：`after-A` @ 6ac941f579f994653f30fd4f41371ed631cf8867（采集 2026-09-19T00:28:36.047Z）
- 门禁：**PASS（三闸全过）**（意外项闸：属性 0 + 几何 0；涌现登记闸：offender 0 / 映射漂移 0；配对闸：offender 0；R:registered 已登记例外另计）

## 1. 配对统计（稳定键 tid:@n / dom: 路径）

| page | before | after | paired | removed | added |
|---|---|---|---|---|---|
| admin-models | 281 | 281 | 281 | 0 | 0 |
| canvas | 123 | 123 | 123 | 0 | 0 |
| login | 40 | 40 | 40 | 0 | 0 |
| material-modal | 215 | 215 | 215 | 0 | 0 |
| register | 12 | 12 | 12 | 0 | 0 |
| video-editor | 252 | 252 | 249 | 3 | 3 |
| videos | 123 | 123 | 123 | 0 | 0 |
| works | 144 | 144 | 144 | 0 | 0 |
- video-editor 3 个未配对键 = 运行时生成 testid（rf__node-node_<时间戳> / video-edit-node-<时间戳> / track-row-<uuid>）——同位同量元素（React Flow 节点包装+编辑节点+轨道行），键不稳定非结构变化；before/after 元素数相同（252/252）
- 其余 7 页配对率 100%（元素数逐页相等）

## 2. 属性层（聚合分桶）

| 桶 | 计数 | 预期类别 |
|---|---|---|
| borderStyle.none→solid | 4119 | P:preflight *{border-style:solid}（宽度恒 0 → 零几何，A4 删除验证） |
| borderColor.→rgb(51, 51, 51) | 4111 | P:preflight *{border-color:var(--fw-border)}——currentColor 解析值→#333 桥接（D2） |
| boxSizing.content-box→border-box | 715 | P:preflight 全局翻转 |
| borderStyle.outset→solid | 220 | P:表单控件 UA 斜面→扁平（A4-c 涌现裁定） |
| fontSize.13.3333px→14px | 131 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| borderColor.→rgb(229, 231, 235) | 124 | P:.light 恒浅岛覆盖（login 页 →#e5e7eb） |
| lineHeight.normal→22px | 121 | P:lh-form-inherit（表单重置 line-height:inherit 承接 antd body 既有 22px——before 快照 body 已是 22px；22 ≠ 1.5×表单字号，不可能源自 html 1.5；全落 form/button 子树） |
| borderWidth.0px→1px | 93 | P:涌现宽度真实渲染（A4-c colored-144 批量保留族同串显式作者色——非 33 bare 位点子集；门禁页渲染子集 24 站点，登记闸按页核验） |
| lineHeight.normal→24px | 68 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| color.rgb(0, 0, 0)→rgba(0, 0, 0, 0.88) | 29 | P:表单控件 color:inherit（buttontext/canvastext→继承色） |
| borderStyle.inset→solid | 16 | P:表单控件 UA 斜面→扁平（裸 select 1 处等） |
| lineHeight.normal→18px | 15 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.13.3333px→14px | 7 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→21px | 5 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→22.5px | 5 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→20.4286px | 4 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| borderWidth.2px→0px | 4 | P:裸 button UA outset 边框归零（四属性归零族） |
| lineHeight.normal→16.5px | 4 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→18.8571px | 2 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→15px | 2 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→17.2857px | 2 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→31.4286px | 2 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| lineHeight.normal→16px | 1 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| fontSize.13.3333px→12px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| lineHeight.normal→20px | 1 | P:lh-html-1.5（html{line-height:1.5} 根传播——normal→1.5×自身字号；html 1.5 在 16px 根=24px；部分表单/按钮后代承接 antd 祖先既有因子而非 1.5，§4 拆桶行细计） |
| color.rgb(16, 16, 16)→rgba(255, 255, 255, 0.35) | 1 | P:表单控件 color:inherit（buttontext/canvastext→继承色） |
| fontSize.13.3333px→16px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |
| fontSize.13.3333px→13px | 1 | P:表单控件 font-size:100%→inherit + UA 按钮字号(13.3333px)后代继承传播 |

### 2b. B2 预期类别（注册配对吸收，b2-migration-registry.json）

- 注册配对 43 组；本 diff 吸收 **60** 条（命中即预期；未登记 color 配对即意外——见 §6）
  - `color rgb(255, 255, 255)→rgb(226, 232, 240)` ×15
  - `borderColor rgb(17, 17, 17)→rgb(20, 20, 20)` ×12
  - `borderColor rgba(255, 255, 255, 0.08)→rgba(255, 255, 255, 0.05)` ×8
  - `borderColor rgba(255, 255, 255, 0.4)→rgba(255, 255, 255, 0.45)` ×4
  - `borderColor rgb(255, 255, 255)→rgb(247, 247, 247)` ×4
  - `color rgb(204, 204, 204)→rgb(226, 232, 240)` ×3
  - `borderColor rgba(255, 255, 255, 0.06)→rgba(255, 255, 255, 0.05)` ×3
  - `color rgba(255, 255, 255, 0.7)→rgba(255, 255, 255, 0.6)` ×2
  - `borderColor rgba(255, 255, 255, 0.094)→rgba(255, 255, 255, 0.1)` ×2
  - `color rgb(208, 208, 208)→rgb(226, 232, 240)` ×2
  - `color rgba(255, 255, 255, 0.4)→rgba(255, 255, 255, 0.45)` ×1
  - `color rgba(255, 255, 255, 0.75)→rgb(226, 232, 240)` ×1
  - `color rgba(255, 255, 255, 0.5)→rgba(255, 255, 255, 0.45)` ×1
  - `color rgba(255, 255, 255, 0.9)→rgb(226, 232, 240)` ×1
  - `color rgba(255, 255, 255, 0.8)→rgb(226, 232, 240)` ×1

### 2c. D 段预期类别（注册配对吸收，canvas-migration-registry.json——D 对 attrSetVersion=D1 时生效）

- 注册配对 0 组（page 限定 0 + 全局 0）；本 diff 吸收 **0** 条（命中层级记入条目：[page] 优先 / [global] 兜底）
  - （无——A5 旧对不读 D 注册表；D 对下采集页未命中任何注册色对时为 0）

## 3. 几何层归因汇总（w/h/x/y/padding/border-width/font-size 逐条）

| 归因 | 条数 | 说明 |
|---|---|---|
| P:form-reset | 533 | 表单控件 UA padding/border/font 抵消（裸 button 四属性归零族；ul/ol/fieldset reset 同列；含按钮后代 span/svg 传播——13.3333px UA 字号标记） |
| C:cascade | 481 | 自身驱动静态的传导位移/尺寸（全局行高、表单重置、margin 归零在上游发生；块级子元素跟随父容器宽；量级直方图） |
| P:emergent-border | 118 | 涌现边框占位（border 宽度类 0→N 真实渲染；auto 尺寸总 w/h += 边框和；A4-c colored-144 批量保留族门禁页子集） |
| P:media-block | 82 | img/svg display:block + vertical-align:middle（行内空隙移除/占位变化） |
| P:box-sizing-flip | 33 | box-sizing content-box→border-box：width+padding/border 组合总宽收窄（register form −64 / 手写 CSS 26px·2px 实例族） |
| P:line-height | 20 | 自身 line-height normal→数值（1.5×font-size）高度增长 |

级联位移量级直方图（|Δ|≤40px 自动归级联）：`{"y+2":73,"w+4":3,"x+1":12,"y+1":46,"x+3":3,"w-2":27,"y-1":71,"h-2":19,"h-6":12,"x-1":34,"x-2":31,"w-7":3,"h+2":6,"x+7":6,"x+8":3,"x+9":3,"x+10":3,"x+11":3,"w-1":10,"h+3":7,"x+6":4,"y+3":7,"w+1":6,"w-4":1,"x+4":3,"x+32":1,"y+14":1,"w-66":2,"x+33":2,"y-3":5,"y-2":11,"y+4":1,"y+6":1,"w+2":1,"h-1":6,"x-4":2,"x-3":4,"y-6":6,"h-17":2,"h+5":2,"w-24":1,"w-23":1,"x+23":4,"h+7":2,"y+5":4,"y-8":10,"h+6":8,"y-5":5,"y-9":2,"w+7":1}`

## 4. line-height 二分统计（对照 A0 冻结值）

- changed 239 / unchanged 948
- 拆桶：**lh-form-inherit**（normal→22px，表单重置 line-height:inherit 承接 antd body 既有 22px；全落 form/button 子树）×121
 - **lh-html-1.5**（其余：html{line-height:1.5} 根传播 normal→1.5×自身字号）×118——其中 23 条承接 antd 祖先既有 unitless 因子（1.5714×字号，如 20.4286px=1.5714×13、18.8571px=1.5714×12），非 html 1.5 直算
- 值对分布（全量）：
  - `normal→22px` ×121
  - `normal→24px` ×68
  - `normal→18px` ×15
  - `13.3333px→14px` ×7
  - `normal→21px` ×5
  - `normal→22.5px` ×5
  - `normal→20.4286px` ×4
  - `normal→16.5px` ×4
  - `normal→18.8571px` ×2
  - `normal→15px` ×2
  - `normal→17.2857px` ×2
  - `normal→31.4286px` ×2
  - `normal→16px` ×1
  - `normal→20px` ×1

## 5. A4 border-width 验证（回补；audit-A5-borderwidth.json 同步落盘）

- style 翻转 + 宽度 0→0（A4 删除 no-op 实证）：4229 边
- 涌现宽度 0→N：93 边 / 24 站点
- 表单 UA 边框抵消 N→0：4 边
- 非预期宽度变化：0 条

## 6. 意外项（gate 对象——必须为空或全部转登记）

（空）

## 7. 已登记例外（R:registered）

（无）

## 8. 未采集属性（冻结属性集外，覆盖方式登记）

- a 链接 text-decoration 移除（19 Link 站点）——冻结属性集未采集；§2.4 目检覆盖
- 裸 button background-color buttonface→transparent——属性集仅含 color(表单)；a1-preflight 常驻默认套件四项归零门禁覆盖（A1_RED 组1 红用例已于 A6 转绿收口）
- ::placeholder gray-400 / textarea resize:vertical——伪元素/交互属性不入快照；§2.4 目检覆盖
- disabled cursor not-allowed——交互态不入快照（informational）
- divide 线涌现（TeamBillingPage:140，唯一站点）——团队账单页不在 8 门禁页；emergence-adjudication-A4.json 已登记
- img/video max-width:100%（19 处裸媒体全带 h-full，低风险）——§2.4 目检抽查覆盖
- img/svg display:block + vertical-align:middle——display 不在冻结属性集；几何层 rect 归因 + §2.4 目检覆盖

## 9. §2.4 目检清单（人工）

本文件为机械产物，重跑即覆盖；人工目检表独立维护于 `e2e/audit/baseline-diff-A5.eyeball.md`（一次性提交，本脚本永不写入/覆写）。

