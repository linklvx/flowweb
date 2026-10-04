<!-- doc-status: historical | verified_at: n/a -->
# Spec: TD-15 删除清理链路实况对齐（canvas cleanup realignment）

日期：2026-08-22
状态：已确认（D1=方案 B；D2=TD-8 收窄为「软删行 MinIO 对象回收」维持上线前评估；D3=uploads 库可见性本批不动；P1/P2 已落实）
来源：TD-15（2026-08-21 双实证升级：断路 + 埋雷）；用户预评审倾向方案 A（后端补端点 + source 校验）
前置：第四批 b3eafad 台账升级；本 spec 侦查推翻方案 A 的数据模型前提

## 侦查结论（2026-08-22 实码核实，与预评审假设的差异已标注）

### 1. 数据模型：Media 单表 = 用户资产库（预评审假设的 source 字段已存在但语义不同）

- [schema.prisma:290](../../apps/api/prisma/schema.prisma) Media：`userId`（所有权）、`type: uploaded | generated | temp`（**预评审的 source 概念即此字段**）、`folderId`（素材库组织，**无独立素材表**——素材文件就是带 folderId 的 Media 行）、`deletedAt`（软删）、`projectId/nodeId/taskId`（业务关联）、`expiresAt`（temp 7 天）
- 无 StorageFile 表；presign 建 Media 行（type 随 dto，temp 才有 expiresAt，storage.service.ts:19-31）；生成结果由各 processor 建行（type='generated'，带 projectId/nodeId/taskId，如 ai-image-edit.processor.ts:130-134）

### 2. 素材库与历史记录是同一份数据的两个视图（决定性事实，预评审未知）

- 素材库弹窗：`GET /api/material/files?folderId=X` **无 type 过滤 → uploads 也在库中可见**（materialLibraryStore.ts:89）
- 历史记录弹窗：`GET /api/material/files?type=image|video|audio` → **同一端点**，filter 强制 `type='generated'`（material.service.ts:16-32，historyStore.ts:62）
- 结论：**所有 Media 行都是库可见的用户资产**；generated 更是历史资产

### 3. 库内删除是纯软删——「用户删除资产不物理销毁」是既有产品语义

- material.service.deleteFile/deleteFiles：仅置 `deletedAt`，**从不碰 MinIO**（:93-112）
- 全后端物理删除仅三处：上传确认失败（storage.service.ts:65-66）、temp 过期清扫（temp-cleanup.processor.ts:38）、banner 清理

### 4. 6 处画布清理死调用的目标全部是库可见资产（预评审未覆盖的语义冲突）

| 调用目标 | Media.type | 库可见 | 历史资产 | 现前端意图 |
|---|---|---|---|---|
| imageGen `fileId`（生成结果） | generated | 是（根级+type 过滤） | **是** | DELETE——**与 TD-11 D1（videoGen/audioGen 生成结果不删）直接矛盾** |
| `trimmedFileId`（裁剪产物） | generated | 是 | **是** | DELETE——同上矛盾 |
| refs/`allImages`（提示词上传） | uploaded | 是（库根列表） | 否 | DELETE——删除库可见资产 |
| `referenceVideo`/`referenceAudio`/multiImage images | uploaded/generated | 是 | 部分 | DELETE——同上 |

### 5. 断路与调用面（沿用 08-21 实证）

- `DELETE /api/storage/files/:id` 后端不存在；前端 6 处（nodeStore.ts 5 + useImageUpload.ts:180）静默 404
- 若按预评审补端点：`source==='upload'` 才删 → 但 uploads 也在库中（结论 2）→ 要么误删库资产（埋雷引爆）、要么加「库引用不删」守卫——而库=全部 Media → 守卫退化为**几乎什么都不删**。方案 A 在真实模型下不成立

## 修复方向

### 方案 B：移除 6 处死调用，画布节点删除不再触发文件清理（推荐）

- 前端：删 nodeStore.deleteNode 四个清理分支的 DELETE 调用块（image/multiImage/videoGen/audioGen，nodeStore.ts:473-508 区域）+ useImageUpload.ts:180 的提示词图片移除 DELETE；相应更新断言这些调用的测试（nodeStore.test.ts ~:355、useImageUpload.test.ts ~:526-540）
- 后端：**不补端点**（库删除已有；物理销毁不是任何用户流的语义）
- 语义对齐：节点删除 = 画布内容移除；资产清理 = 用户在库内显式软删（现状语义）；生成历史完整保留（D1 语义扩展到 imageGen/trim，一致性修复）
- TD-15 埋雷彻底消除（无调用则无端点补齐引爆面）；TD-8「孤儿」重定义：软删除行的 MinIO 对象（唯一真实孤儿类）→ D2 处置
- 成本：删 ~40 行 + 测试更新；风险低

### 方案 A'：补守卫端点（预评审方案的修正尝试）

- 后端补 `DELETE /api/storage/files/:id`：校验 userId；跳过 generated（历史）与「库引用」——但库=全部 Media（folderId null 也在库根）→ 守卫语义只能落到「uploaded 且未被任何画布节点引用」——需要全画布引用扫描（跨项目 DB 查询 CanvasNode.data JSON），复杂且仍删除库可见资产
- 不推荐：语义仍然与库可见性冲突，实现复杂度高

### 方案 C：B + 软删清扫（物理回收扩展）

- B 的全部 + temp-cleanup 模式扩展：`deletedAt < now()-N 天` 的 Media 行物理删 MinIO + 硬删行（库回收站语义）
- 解决 TD-8 真实孤儿类的持续回收；成本：processor 扩展 + 测试

## 验证标准（按方案 B）

**TDD 顺序（P1）**：先改测试（红）——将「DELETE 被调用」断言改为「零 `/api/storage/files` DELETE 调用」并保留节点删除本身断言；再删代码（绿）。

1. 测试红→绿：
   - nodeStore.test.ts 用例 16/16a/16b：改断言 storageDeletes 为空 + 节点已移除（16 的宽泛 `fetchSpy.toHaveBeenCalled()` 随之删除——移除后无任何 fetch）
   - useImageUpload.test.ts 用例 10（含 ~:598 img-a 批量删除断言）：改断言 DELETE 不被调用 + 库存过滤断言保留
2. `pnpm --filter @flowweb/web test` 全绿 + `tsc -b` 零错误
3. 浏览器验证：删画布节点 → 库/历史中该生成资产仍存在（软删都不应有）；网络面板无 `/api/storage/files` DELETE 请求
4. 台账：TD-15 清账（双实证 → 方案 B 对齐，D1 语义扩展到 imageGen/trim）；TD-8 收窄定义

## 删除边界（P2，已实码核对）

- **nodeStore.deleteNode（:469-511）**：四个 if 清理分支整体删除（image :471-481 / multiImage :482-488 / videoGen :489-499 含 TD-11 D1 注释 / audioGen :500-506）；`const node = getNode(...)` 随之无消费方 → 连带删；函数保留 `async` 签名（调用方 await，零风险）；`mergeImageRefs` 若因此无剩余调用方 → 连带删（实现时 grep 确认）
- **useImageUpload.deleteImage（:172-184）**：删 try/fetch/catch 块，保留 store 过滤逻辑与 async 签名

## 不做什么

- 不动素材库/历史记录的软删语义（既有产品语义）
- 不做画布节点删除时的引用扫描（方案 B 下无删除则无需扫描）
- 不处理存量已软删行的 MinIO 对象（TD-8 收窄后维持上线前评估；运行时回收 C 另立独立任务）
- 不动 transform 保存流程的旧文件丢弃行为（旧 Media 留库，与 B 语义一致）
- 不动 uploads 库可见性（D3：产品设计域，非技术债）

## 风险

- 移除清理调用后 uploads 生命周期 = 用户手动库内管理（软删）——现状（404）实际行为已是本方案行为，**方案 B = 把既有事实行为固化为语义**，零行为变化
- mergeImageRefs 若被删除，legacy 嵌套数据的读取兼容仅剩持久化恢复路径——实现时确认无其他调用方后再删

## 决策点（已裁定）

- **D1 修复方向**：✅ B 移除死调用固化现状（A' 否决：跨项目 CanvasNode.data JSON 扫描复杂且语义冲突未解；C 降级为后续独立任务）
- **D2 TD-8 处置**：✅ 维持「上线前评估」，台账收窄为「软删 Media 行的 MinIO 对象回收」（方案 B 后画布删除不再产生孤儿，唯一孤儿来源 = 库内软删）
- **D3 uploads 库可见性**：✅ 本批不动（产品设计决策非技术债）
