<!-- doc-status: historical | verified_at: n/a -->
# Spec: TD-11 删除链路断裂修复（子批 3a 止血）

日期：2026-08-21
状态：待确认
来源：tech-debt.md TD-11；第三批分批方案子批 3a（用户 2026-08-21 确认）

## 问题：删除链路三层断裂

键盘删除节点（CanvasView.tsx:247 `deleteKeyCode={['Backspace','Delete']}`）产生的 remove change 只更新 React Flow 视图，以下三层全部缺失：

| 层 | 断裂点 | 后果 |
|---|--------|------|
| 1. nodeStore | canvasStore.onNodesChange（canvasStore.ts:401-422）无 remove 分支 → nodeStore.deleteNode 永不被调 | 节点永久残留 nodeStore/localStorage（持久化回写脏快照） |
| 2. 引用清理 | deleteNode 清理分支只认 imageGen/imageExtGen（isImageNode，nodeStore.ts:204）+ multiImageGen（:214）；**videoGen/audioGen 无分支** | video/audio 节点的引用文件 DELETE 从不发出 → MinIO 孤儿持续泄漏 |
| 3. DB | syncNodes/syncEdges 仅在 5 个 ConfigPanel 生成时 + SaveAsTemplate 调用，删除无同步 | 删除后若不再生成 → 刷新后节点从 DB 复活 |

对比正确范本：`canvasStore.deleteTransformNode`（canvasStore.ts:151-163，ImageGenNode 工具栏在用）已实现 1+2 层（cancelNodeProcess + ns.deleteNode + ns.unregisterSaveHandler），但仍缺第 3 层 DB 同步。

## 侦查结论（全部已核实）

- **useReactFlowSync 不复活**：它是 `useNodesState` 本地状态平行架构（自带一套 reactFlowNodes，与 canvasStore 状态源冲突），复活=整体换状态源；正确路径是给 onNodesChange 加 remove 分支
- **canvasStore.deleteNode（:140-149）无产品调用方**（仅 canvasStore.test 引用）——观察项，不动
- **fileId 语义分化**（关键）：
  - videoGen/audioGen 的 `fileId` = **生成结果**（socket done handler 写入，AudioGenNode.test:279 同款）→ 生成历史引用它，随节点删除会抹历史
  - `referenceVideo`/`referenceAudio` = **上传引用** file id（AddNodeMenu.tsx:246-248）→ 节点私有，应删
  - `VideoNodeData.allImages`（根级，TD-2 统一）+ `prompt.allImages`（嵌套遗留）= 上传引用图
  - `trimmedFileId` = 裁剪输出 file id（nodeStore.ts:708）→ 节点私有派生文件，应删
- **DB 同步载荷安全**：mergedNodes 以 canvasStore.nodes（view）为基准构造（VideoConfigPanel.tsx:191-196 同款）——remove 后 view 已排除该节点，无需等 nodeStore.deleteNode 完成
- **空数组边界**：后端 syncNodes 空数组 = 先 deleteMany 再跳过 createMany（project.service.ts:84-85）= 全清，删最后一个节点无问题
- **边自动清理**：React Flow 删节点时自动发 edge remove changes → onEdgesChange（applyEdgeChanges）已覆盖，无需手动清边
- **TextNodeData 无文件字段**（nodeStore.ts:96-99 仅 content/prompt）→ text 删除走默认 store 移除即可，无需清理分支
- **image 分支的合并去重是内联实现**（nodeStore.ts:462-465 局部变量，非独立 deleteRefs 函数）→ videoGen 复用方式 = 提取私有 helper 共用，不重复实现

## 修复设计

### F1：canvasStore.onNodesChange 加 remove 分支（修 1+3 层）

执行顺序（时序保障：先更新 view，后清理同步）：

```
① set((s) => applyNodeChanges(changes, s.nodes))      // 现有实现首句，同步完成 → view 已排除删除节点
② for (change of changes 中 type === 'remove'):
     cancelNodeProcess(id)                              // 对齐 deleteTransformNode
     useNodeStore.getState().deleteNode(id)             // async fire（含引用 DELETE + store 移除）
     useNodeStore.getState().unregisterSaveHandler(id)
③ 若本次 changes 含 remove 且 projectId 非空（循环外统一一次）:
     mergedNodes = get().nodes（①后新状态）map nodeStore.data
     Promise.all([syncNodes(projectId, mergedNodes), syncEdges(projectId, get().edges)])
       .catch(e => console.error('[canvasStore] delete sync failed', e))
```

- ③ 的 payload 在 ① 之后同步取快照，必然不含被删节点；deleteNode 不 await（与 deleteTransformNode 一致）
- 多选批量删除（N 个 remove）：② 逐节点清理，③ 仅一次 DB 同步
- DB 同步失败仅记日志不重试（删除低频，重试易与后续操作冲突；静默不一致至少可从日志排查）
- 瞬时态无害：nodeStore 移除在引用 DELETE 完成后发生，期间持久化回写含已删节点的快照，删除完成后即被干净快照覆盖

### F2：deleteNode 扩 videoGen 分支（修 2 层）

镜像 image 分支模式；合并去重逻辑提取为私有 helper（如 `mergeImageRefs(data)`），image 分支（现内联于 nodeStore.ts:462-465）与 videoGen 分支共用，不重复实现：

- `allImages`（根级）+ `prompt?.allImages`（嵌套遗留）合并按 id 去重 → 逐个 DELETE
- `referenceVideo` 存在 → DELETE
- `trimmedFileId` 存在 → DELETE
- **不删 `fileId`**（决策点 D1）

### F3：deleteNode 扩 audioGen 分支

- `referenceAudio` 存在 → DELETE
- **不删 `fileId`**（同 D1）

## 决策点（已确认 2026-08-21）

- **D1 生成结果 fileId 是否随节点删除**：✅ **不删**（生成文件进历史记录，删节点抹历史不可逆）；image 分支现状删 fileId 但语义不同（素材应用/上传源，见观察项 O1），不冲突
- **D2 projectId 为 null 时是否同步 DB**：✅ **跳过 DB 同步**（本地三层照常删）——`?? 'default'` 是 TD-1 已证明会 FK 500 的路径，不用

## 观察项（不本批处理，仅记录）

- **O1**：CanvasView.tsx:85 素材库「应用到画布」创建节点时 `fileId: file.id` 指向素材库文件——若属实，image 分支删 fileId 会删掉素材库资产。TD-2 批次浏览器验证过删除流程无异常，可能素材 apply 有复制语义或该路径不设 fileId；留待独立核查（不阻塞本批）
- **O2**：useReactFlowSync.ts 死代码处置（删除/保留）——CLAUDE.md 约定不动既有死代码，本批完成后由用户决定是否清账时删
- **O3**：存量泄漏（localStorage 已残留节点 + MinIO 已孤儿文件）——无生产用户；localStorage 残留建议随 3c 持久化版本化丢弃，MinIO 对账留 TD-8/上线前

## 验证标准

1. TDD 先红后绿：
   - canvasStore.test：remove change → cancelNodeProcess + nodeStore.deleteNode + unregisterSaveHandler 被调 + syncNodes/syncEdges 以 view 基准载荷被调；projectId null 时不同步
   - nodeStore.test：videoGen 删除 → allImages 根+嵌套去重 DELETE + referenceVideo + trimmedFileId，fileId 无 DELETE；audioGen 删除 → referenceAudio，fileId 无 DELETE
2. web 全量测试绿 + `tsc -b` 绿
3. 浏览器手验：
   - video 节点（带引用图）键盘删除 → Network 面板见全部 DELETE（allImages 去重后 + referenceVideo + trimmedFileId，无 fileId）、localStorage content key 无该节点、刷新后不复活
   - image 节点（带引用图）键盘删除**回归验证**（F1 是所有节点类型的公共路径变更）→ DELETE 正常、刷新不复活
   - 多选批量删除 → 每节点清理齐全、DB 同步仅一次
4. 与判定矛盾时停下报告

## 不做什么

- 不复活/不删除 useReactFlowSync（见 O2）
- 不动 canvasStore.deleteNode 与 image/multiImage 分支现状（含 O1 疑点）
- 不做存量清理（见 O3）
- 不做删除防抖/批量合并（低频操作，直接同步）
