# Plan: TD-11 删除链路断裂修复（子批 3a）

日期：2026-08-21
Spec：docs/superpowers/specs/td11-deletion-chain-fix.md（已确认，D1=不删生成 fileId、D2=null 跳过 DB 同步）
总原则：TDD 红绿循环，每任务先写测试确认红再实现转绿；只碰 spec 范围内代码。

## 任务 0：提交文档

- commit 1：`docs: spec and plan for TD-11 deletion chain fix (batch 3a)`（spec + plan）

## 任务 1：mergeImageRefs helper 提取（重构，行为不变）

- nodeStore.ts：新增模块级私有 `mergeImageRefs(data)`（root allImages + prompt.allImages 按 id 去重），image 分支（:462-465 内联逻辑）改调 helper
- 覆盖确认（已核实）：16a=root 级（nodeStore.test.ts:334）、16b=嵌套遗留（:361）、16c=双轨去重（:392）——三种场景全覆盖，重构安全网成立，无需补测试
- 验证：现有 image 引用清理测试保持绿

## 任务 2：videoGen 清理分支（F2）——TDD

- 先写测试（nodeStore.test.ts，复用既有 fetch spy 计数模式）：
  - videoGen 节点 root+嵌套同 id 引用 → 去重后 DELETE 数正确
  - referenceVideo / trimmedFileId 各自 DELETE
  - **负向：fileId 无 DELETE**（D1）
- 确认红 → 实现：isVideoGenNode 类型守卫（沿 :191-216 既有 guard 风格）+ deleteNode 扩分支（复用 mergeImageRefs）
- 验证：新测试绿 + 全文件绿

## 任务 3：audioGen 清理分支（F3）——TDD

- 先写测试：referenceAudio DELETE；**fileId 无 DELETE**（D1）
- 确认红 → 实现：isAudioGenNode 守卫 + deleteNode 扩分支
- 验证：绿

## 任务 4：onNodesChange remove 分支（F1）——TDD

- canvasStore.test.ts 准备：vi.mock('@/api/projectApi')（canvasStore 新增该 import）
- cancelNodeProcess 可测性（已核实）：store action（canvasStore.ts:94/:609），直接 `vi.spyOn(useCanvasStore.getState(), 'cancelNodeProcess')`，与既有 unregisterSaveHandler spy（canvasStore.test.ts:309）同款模式
- 先写测试：
  - remove change → cancelNodeProcess / nodeStore.deleteNode / unregisterSaveHandler 均被调
  - syncNodes+syncEdges 各一次，payload 不含被删节点（view 基准）
  - projectId null → 不 sync，清理照常
  - 多 remove 批量 → sync 仅一次
  - 非 remove change（dimensions）→ 不 sync（回归）
- 确认红 → 实现（canvasStore.ts onNodesChange，spec F1 三步顺序）：
  1. 现有 `set(applyNodeChanges + dimensions 同步)` 原样保留
  2. remove 循环：三件套清理
  3. projectId 非空时循环外单次 `Promise.all([syncNodes, syncEdges]).catch(console.error)`
- 验证：绿

## 任务 5：全量验证

1. `pnpm --filter @flowweb/web test` 全量绿
2. `pnpm --filter @flowweb/web exec tsc -b --noEmit` 绿（web spec 在 tsc 范围内，类型真实受检）
3. 发现与 spec 判定矛盾 → 停下报告

## 任务 6：浏览器手验（spec 验证标准 3）

- video 节点（粘贴 2 张引用图）键盘删除 → Network：2 次 storage DELETE（无 fileId 的 DELETE）、1 组 nodes/edges PUT；localStorage content key 无该节点；刷新不复活
- image 节点（带引用图）键盘删除回归 → DELETE 正常、刷新不复活
- 多选 2+ 节点删除 → 每节点清理齐全、PUT 仅一组

## 任务 7：commit 2

```
fix(web): wire node deletion chain — store cleanup, video/audio ref branches, DB sync (TD-11)

- onNodesChange: remove branch mirrors deleteTransformNode trio (cancel/deleteNode/unregister)
  + single view-based syncNodes/syncEdges after batch (projectId-gated, error-logged)
- deleteNode: videoGen branch (allImages root+nested dedup via extracted mergeImageRefs,
  referenceVideo, trimmedFileId) and audioGen branch (referenceAudio);
  generated fileId NOT deleted (history-referenced, D1)
- stops: MinIO orphan leaks, localStorage residue, DB-resurrect on refresh
```

## 任务 8：台账清账（commit 3）

- TD-11 → 已清账（引用 commit 2），条目注明「存量泄漏处置见 TD-8 / 3c 持久化版本化」
- 新增观察项条目：O1 素材库 fileId 随删疑点（CanvasView.tsx:85，独立核查）、O2 useReactFlowSync 死代码处置
- O3 处置（已核实 TD-8 现仅覆盖 localStorage 脏数据）：TD-8 条目扩一行「含 TD-11 修复前泄漏的 MinIO 存量孤儿对账」，不新增编号
- commit 3：`docs: settle TD-11 in tech-debt ledger, add O1/O2 entries`
