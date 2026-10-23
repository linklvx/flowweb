# Y1c T0-S3 spike 结论：undo origin/scope（changedParentTypes 父链实证 + y-prosemirror exact pin + ySyncPlugin 事务 origin）

- 装置：`apps/web/src/stores/canvasUndo.nested-scope.spec.ts`（主池 7 用例，jsdom，~12ms 测试体；真 `attachUndoManager`——生产接线形态 scope=[nodes,edges]/trackedOrigins=[LocalUser]/captureTimeout 500）。
- 依据：spec v5.4 §3.1/§3.2（T18 单 manager）；plan v1.7 Task 0 S3 / T15 / T16 / T18 卡。
- 结论一句话：**addToScope 证明不需要**（全部目标形状经 changedParentTypes 父链天然捕获，零例外）；**y-prosemirror 推荐 exact pin `1.3.7`**（npm latest 稳定 1.x 线；对已装 ProseMirror 矩阵逐 peer 验证全满足——T16 落地非现在）；**ySyncPlugin 的 Yjs 事务 origin=`ySyncPluginKey`（PluginKey 实例）≠ LocalUser ⇒ T16 必须 `addTrackedOrigin(ySyncPluginKey)`**（y-prosemirror 1.3.7 源码引证）。

## 0. 结论速览

| 项 | 结论 | 去向 |
|---|---|---|
| ① changedParentTypes 父链 | `UndoManager([nodes,edges])` 捕获嵌套 Y.Text/Y.Map{text}/XmlFragment（含 Map→XmlFragment 混合父链与 XML 深链）任意深度变更——**addToScope 不需要**（7 用例行为锁，零例外形状） | T18 卡「不 addToScope」措辞维持 |
| ② y-prosemirror pin | **`"y-prosemirror": "1.3.7"`（exact）**——T16 落 apps/web package.json（现在不装）；peer 全满足+tiptap 同代官配佐证 | T16 卡「exact pin 按 S3」落值 |
| ③ ySyncPlugin 事务 origin | 本地键入=Yjs 事务 `origin=ySyncPluginKey`（PluginKey 单例）；远端变更=PM meta `isChangeOrigin` 非 Yjs origin ⇒ **T16 `addTrackedOrigin(ySyncPluginKey)`（必做）**；T18 单 manager=`trackedOrigins:new Set([Origin.LocalUser, ySyncPluginKey])` | T16/T18 卡接线输入 |
| 发现 F-S3-1 | `@tiptap/react` 2.10.0 exact pin **不钉 ProseMirror 矩阵**：peer `^2.10.0` 解析到 @tiptap/core/pm **2.27.2** → PM model 1.25.7/state 1.4.4/transform 1.12.0/view 1.41.8。y-prosemirror 1.3.7 的 pin 依据=该**解析后矩阵**（非 2.10.0 名义矩阵）；后续任何 tiptap core/pm 漂移须重验 | T16（及任何动 tiptap 的卡） |

## 1. 实验：changedParentTypes 父链实证（addToScope 不需要——成立）

**机制**（yjs 13.6.32 源码，`node_modules/.pnpm/yjs@13.6.32`）：
- `src/types/AbstractType.js` `callTypeObservers` :241-255——每个变更（最深）类型沿 `_item.parent` 链上行到根，把**每一级祖先**记入 `transaction.changedParentTypes`（键=祖先类型→事件数组）；
- `src/utils/UndoManager.js` `afterTransactionHandler` :210-218——捕获谓词三合取：`captureTransaction(tr)` ∧ `scope.some(type => transaction.changedParentTypes.has(type) || type===doc)` ∧ `trackedOrigins.has(transaction.origin)`。

⇒ tracked root（nodes/edges）命中任一祖先键即捕获——**任意深度嵌套天然入栈**；`addToScope` 只在「变更类型不在 scope 根子树下」时才需要（本架构不存在该形状：v4 全部嵌套容器都在 nodes/edges entry 之内）。

**用例→形状映射**（7/7 绿，首跑即绿——零例外形状，无需例外条款）：

| 用例 | 形状（父链） | 断言 |
|---|---|---|
| content:Y.Text | nodes→entry Y.Map→data Y.Map→Y.Text（三层深） | 捕获+undo 清空+redo 复原 |
| prompt:Y.Map{text:Y.Text} | 四层深（T15 textInput 目标形状） | 捕获+undo 恢复 |
| rich:Y.XmlFragment（Map 下挂） | data Y.Map→**XmlFragment**（混合父链——Map 挂非 Map 子类型）+XmlElement 属性/文本 | 捕获+undo 清空+redo 复原 |
| XML 深链 | frag→div→span→text | 捕获+undo 清空 |
| 异 origin | Origin.AutoEdge 与远端 applyUpdate（origin=连接对象） | **不入栈**（trackedOrigins 过滤对嵌套形状同样生效——远端编辑不进本端撤销栈） |
| 栈粒度/精度 | 两节点各一次编辑（stopCapturing 分项） | 两栈项；undo 只回滚本项，兄弟不动 |
| edges 根+基线 | edge entry 内嵌 Y.Text；根级整节点删除 | 双路径均捕获（现行主路径行为不回退） |

**裁定**：T18 卡「单 manager=`UndoManager([nodes,edges],{trackedOrigins:[LocalUser]+S3 结论})`——不 addToScope（scope 父链已含嵌套——S3 实证）」**原文成立**；T15「undo 重建合法」（容器=结构创建时一次性建+undo 重建）无额外要求（重建走根级 set/delete，父链覆盖）。

## 2. y-prosemirror exact pin 调研：推荐 **1.3.7**（T16 落地，现在不装）

**解析后矩阵**（pnpm-lock.yaml + `node_modules/.pnpm` 实测——apps/web 名义 pin `@tiptap/react 2.10.0`，但 peer `^2.10.0` 将 @tiptap/core/@tiptap/pm 解析到 2.27.2，见 F-S3-1）：

| 包 | 解析版本 | 来源 |
|---|---|---|
| @tiptap/core / @tiptap/pm | 2.27.2（peer 解析——非 2.10.0） | pnpm-lock :7530-7560；node_modules/.pnpm 实目录 |
| prosemirror-model | 1.25.7 | lock :4372；@tiptap/pm 2.27.2 声明 `^1.23.0` |
| prosemirror-state | 1.4.4 | lock :4381；声明 `^1.4.3` |
| prosemirror-transform | 1.12.0 | lock :4394 |
| prosemirror-view | 1.41.8 | lock :4397；@tiptap/pm 2.27.2 声明 `^1.37.0` |
| yjs | 13.6.32（exact——与 api/shared 同源） | apps/web package.json :48 |
| y-protocols | 1.0.7 | node_modules/.pnpm 实目录 |
| lib0 | 0.2.117（≥y-prosemirror 要求 ^0.2.109） | node_modules/.pnpm 实目录 |

**y-prosemirror@1.3.7 兼容性验证**（registry 元数据，2026-10-24 查）：

| peer 声明（1.3.7） | 已装 | 满足 |
|---|---|---|
| prosemirror-model `^1.7.1` | 1.25.7 | ✓ |
| prosemirror-state `^1.2.3` | 1.4.4 | ✓ |
| prosemirror-view `^1.9.10` | 1.41.8 | ✓ |
| yjs `^13.5.38` | 13.6.32 | ✓ |
| y-protocols `^1.0.1` | 1.0.7 | ✓ |

- 源码 import 面（tarball 实测）：只 import prosemirror-state/view/model 三包（均为已声明 peer）——无 transform/keymap 直接依赖，pnpm 严格解析无缺口。
- 版本面：1.3.7=2025-07-03 发布、npm dist-tag `latest`（1.x 稳定线末位）；GitHub master 已有 v2.0.0-x 预发布线（changelog「stable 1.x API stays documented in the v1.3.7 README」）但**未上 npm latest**——exact pin 天然免疫 v2 漂移。
- 官配佐证：@tiptap/extension-collaboration@2.27.2（与已装 core/pm 同代）声明 `y-prosemirror: ^1.2.11`——tiptap 官方在同一 PM 矩阵上配 1.2/1.3 线。
- **裁定**：T16 落 `"y-prosemirror": "1.3.7"`（exact——yjs 13.6.32/@hocuspocus 4.6.0 同款纪律）。升级须走 S1 形态行为锁（本仓惯例），不因 peer 宽范围而放宽 pin。

**F-S3-1（精化）**：任务假设「@tiptap/react 2.10.0 的 ProseMirror 矩阵」实测不成立——名义 pin 不钉矩阵，矩阵由 peer 解析的 @tiptap/pm 2.27.2 决定。若后续卡要求「真 2.10.0 世代矩阵」，需显式 pin @tiptap/core+@tiptap/pm（本 spike 不做——现矩阵满足全部 peer 且为 tiptap 官配基准）；任何 core/pm 漂移都必须重跑本节矩阵表。

## 3. ySyncPlugin 事务 origin：机制源码结论（T16 addTrackedOrigin 必做）

y-prosemirror 1.3.7 源码（npm tarball 逐行引证；T0 无法运行实测——包未装，T16 落地后以 S1 式契约测试锁）：

- **origin 身份**：`src/plugins/keys.js`——`ySyncPluginKey = new PluginKey('y-sync')`（模块级单例；包根 `export * from './plugins/keys.js'` 转出——单副本安装下 `import { ySyncPluginKey } from 'y-prosemirror'` 即同一对象）。
- **本地键入**（PM→Yjs）：`src/plugins/sync-plugin.js` :198-233 plugin `view.update` → :226-231
  `binding.mux(() => pluginState.doc.transact((tr) => { tr.meta.set('addToHistory', …); binding._prosemirrorChanged(view.state.doc) }, ySyncPluginKey))`
  ——**Yjs 事务 origin=`ySyncPluginKey`**（内层 `_prosemirrorChanged`/`updateYFragment` 事务同参 ：649-656/:1207-1297）。无 `origin` 可配项（ySyncPlugin 选项仅 colors/colorMapping/permanentUserData/onFirstRender/mapping——:103-109）。
- **远端变更**（Yjs→PM）：`_typeChanged`（observeDeep :592-643）→ PM 事务 `tr.setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: transaction.origin instanceof Y.UndoManager })`（:635）——**PM meta 非 Yjs origin**；Yjs 侧事务来自网络 applyUpdate（origin=连接对象）→ 不产生本地 tracked origin → 远端编辑不入任何撤销栈（与 §1 实验第 5 用例同语义）。
- **官方自证**：`src/plugins/undo-plugin.js` :68-72——y-prosemirror 自带 yUndoPlugin 构造
  `new UndoManager(ystate.type, { trackedOrigins: new Set([ySyncPluginKey].concat(trackedOrigins)), captureTransaction: tr => tr.meta.get('addToHistory') !== false })`
  ——官方即按 `ySyncPluginKey` 作 tracked origin。

**T16/T18 接线裁定**：
1. T16：`import { ySyncPluginKey } from 'y-prosemirror'` → `undoManager.addTrackedOrigin(ySyncPluginKey)`（plan T16 卡预留写法落值；等价形态=T18 直接构造 `trackedOrigins: new Set([Origin.LocalUser, ySyncPluginKey])`——单 manager 卡一次到位）。
2. 前提保持：单副本 y-prosemirror（exact pin 单版本——pnpm 无双实例）+单 editor 实例（T16 卡钉死）——PluginKey 单例身份成立。
3. 注册时序：plan T16「plugin 首次事务前注册」与 yjs 语义一致——UndoManager 只捕获 attach 之后的事务；T18 attach 点维持现行 `attachUndoManager(doc)`（initCollab 会话起点）即满足（editor 挂载晚于 doc）。
4. 可选采纳：`addToHistory` 镜像——ySyncPlugin 把 PM tr 的 addToHistory meta 镜像进 Yjs 事务 meta（sync-plugin.js :228），UndoManager 可用 `captureTransaction` 按 `tr.meta.get('addToHistory') !== false` 过滤（官方同款 ：71）——T18 如需「PM 层免历史事务不入画布撤销栈」再采纳，非本 spike 裁定项。

## 4. 运行结果

- `apps/web` `npx vitest run src/stores/canvasUndo.nested-scope.spec.ts`：7/7 绿（12ms）。
- 调研面零网络依赖失败项（registry/GitHub raw 各一次成功；矩阵数据以本地 node_modules/lockfile 为权威）。

## 5. 发现登记（对 plan v1.7 / spec v5.4 的反馈）

- **F-S3-1**（§2）：`@tiptap/react` 2.10.0 exact pin 不钉 ProseMirror 矩阵——实际 @tiptap/core/pm=2.27.2（peer 解析）。y-prosemirror pin 依据解析后矩阵；动 tiptap 的卡须重验。
- 无发现推翻 plan 主体：addToScope 不需要（T18 卡原文成立）、y-prosemirror exact pin 落值 1.3.7（T16 卡占位收敛）、addTrackedOrigin(ySyncPluginKey) 必做（T16/T18 卡预留语义确认+精确落值）。
