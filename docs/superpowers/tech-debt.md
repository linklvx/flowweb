# 技术债务台账

> 用途：集中登记 P2 及以下技术债，供下次集中修复时挑选任务。
> 约定：每项含【来源】【现状核查日期】【修复方向】；完成一项移入文末「已清账」并注明 commit。
> 新债发现时随手追加，修复前先核查现状（文件/行为可能已变化）。

最近核查：2026-08-21

## 前端（apps/web）

### TD-3 ImageGenNode 死字段写入 `isSaving: false`

- **来源**：2026-08-20 类型清零时发现；已如实补类型（`ImageNodeData.isSaving?: boolean`）但未删行为
- **现状**：`src/pages/canvas/components/nodes/ImageGenNode.tsx:450` 变换保存完成后往节点数据写 `isSaving: false`，全库无读取方（工具栏的 isSaving 是组件 state 非数据字段）
- **修复方向**：删除该字段写入（一行）；`ImageNodeData.isSaving` 类型可一并移除
- **优先级**：低——微清理

### TD-4 持久化防抖 500ms 慢请求覆盖窗口

- **来源**：canvas-create-unify-fix plan 备注1（用户确认接受为 P2）
- **现状**：`loadProjectIntoStore` 慢 fetch 返回后整体 setState，可覆盖 500ms 防抖期内用户的新编辑（切换项目场景下发生概率低）
- **修复方向**（plan 已定）：加载期间订阅 isLoading 标志，防抖写入在 isLoading=true 时抑制
- **优先级**：中

### TD-5 localStorage 双 store 两份独立数据

- **来源**：canvas-refresh-data-loss-fix spec defer
- **现状**：canvasStore 与 nodeStore 各自持久化，同一画布两份数据靠恢复逻辑拼接
- **修复方向**：合并为单一持久化 schema（与 TD-6 一并设计）
- **优先级**：中——结构性，涉及面广，需单独 spec

### TD-6 localStorage key 版本化 + schema 校验

- **来源**：canvas-refresh-data-loss-fix spec defer
- **现状**：`safeParseLocalNodes` 仅做解析失败兜底，无版本/结构校验
- **修复方向**：key 带 version 前缀 + 恢复时 schema 校验，不兼容直接丢弃（当前 `safeParseLocalNodes` 已清除脏 key，可在此基础上扩展）
- **优先级**：中

### TD-7 nodeData undefined 时空白占位

- **来源**：canvas-refresh-data-loss-fix spec（UX 债）
- **现状**：相关组件 `return null`，用户看到空白
- **修复方向**：换 Spin/轻文案占位
- **优先级**：低

### TD-8 localStorage 已污染脏数据

- **来源**：canvas-create-unify-fix spec 明示「不会自愈」
- **现状**：开发期手动处理（清 key 或删画布）；无生产用户
- **修复方向**：上线前评估——若无生产数据可直接忽略；否则写一次性清理迁移
- **优先级**：上线前评估

## 后端（apps/api）

### TD-9 既有测试失败 9 个（5 文件）

- **来源**：Fix 7 开发期间基线比对确认与业务改动无关（git stash 前后同样失败）
- **现状**（2026-08-20 复验仍失败）：
  - `src/common/audit/audit.service.spec.ts`（2 例：必填字段/最小字段写入）
  - `src/interceptors/transform.interceptor.spec.ts`（1 例：成功响应包装）
  - `src/modules/ai-image-edit/ai-image-edit.processor.spec.ts`（3 例：erase/outpaint 成功路径 + 失败路径积分处理）
  - `src/modules/material-library/controllers/file.controller.spec.ts`（2 例：文件夹内文件列表/null folderId）
  - Sms 相关（1 例）
- **修复方向**：逐文件判断是测试过时（实现演进后断言未跟）还是实现回归；修复标准 = api 全量绿
- **优先级**：中——掩盖真实回归的噪音

## 数据 / 部署

### TD-10 Prisma migrate 历史断裂

- **来源**：长期存在（详见记忆档案 prisma_migrate_history_broken）
- **现状**：本地库实际靠 `db push` 同步，migrate 历史自 2026-07 起未应用
- **修复方向**：上线部署前人工核对 schema 与迁移一致性；建议基线重置（`migrate resolve`/重新基线）并在部署流程中固化
- **优先级**：**上线阻塞项**

### TD-11 节点删除链路断裂（视图删、nodeStore 永不删）

- **来源**：2026-08-21 TD-1/TD-2 修复批次浏览器手验发现（实锤）
- **现状**：
  - CanvasView 绑定 `canvasStore.onNodesChange`（CanvasView.tsx:51），其实现只处理 dimensions change（canvasStore.ts:401-422），**remove change 无分支** → 删除节点只更新 React Flow 视图 state
  - 正确实现 remove→deleteNode 的 `useReactFlowSync.ts` **只有测试在用，是未接线的死代码**
  - 叠加：`nodeStore.deleteNode` 清理分支只认 image 节点（isImageNode），**videoGen 节点即使接线后引用图也不清理**
- **实测后果**：已删节点永久残留 nodeStore/localStorage（刷新后不复活——恢复走 DB，用户基本无感）；引用文件 DELETE 从未发出 → MinIO 孤儿泄漏
- **修复方向**：remove change 接线到 nodeStore.deleteNode（复活 useReactFlowSync 或在 canvasStore.onNodesChange 加 remove 分支）+ deleteNode 扩 videoGen 清理分支（allImages 根级+嵌套合并去重逻辑已在位，nodeStore.ts deleteNode）
- **优先级**：中——数据泄漏不可见但不可逆（MinIO 孤儿）；与 TD-8 存量清理一并做收益更大

### TD-12 `PromptValue.allImages` 僵尸类型字段

- **来源**：2026-08-21 TD-2 修复批次（spec O3 决议保留类型、记台账）
- **现状**：运行时读写已全部迁移根级 `data.allImages`，`PromptValue.allImages` 无运行时读取方；几十处测试 mock 仍使用嵌套形状
- **修复方向**：测试 mock 批量迁移到根级形状后，从 `PromptValue` 类型移除该字段（连带 nodeStore.ts:245 初始 prompt 形状）
- **优先级**：低——纯类型卫生

## 集中修复建议批次

1. **第二批（测试卫生）**：TD-9
2. **第三批（结构/上线）**：TD-10 → TD-5/6/8 → TD-4 → TD-11（与 TD-8 一并）
3. **随手清**：TD-3、TD-7、TD-12

## 已清账

| 项目 | 完成日期 | Commit |
|---|---|---|
| 117 个 TypeScript 类型错误（阻断 `tsc -b` 构建） | 2026-08-20 | e42863f |
| StrictMode 双创建（首页一次点击建 2 个画布） | 2026-08-20 | 3151d51 |
| TD-2 allImages 双轨统一（根级）：useImageUpload/VideoConfigPanel/deleteRefs 三读取方迁移 + 测试基建修正 | 2026-08-21 | 7a62eb2 / bdf8fdd / 4af7834 |
| TD-1 projectId 硬编码（实际 15 处非台账原记 5 处，含 syncNodes/syncEdges 位置参数形式漏报；修复带节点画布生成 500 阻断） | 2026-08-21 | e82cf36 |
