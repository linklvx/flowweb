# 技术债务台账

> 用途：集中登记 P2 及以下技术债，供下次集中修复时挑选任务。
> 约定：每项含【来源】【现状核查日期】【修复方向】；完成一项移入文末「已清账」并注明 commit。
> 新债发现时随手追加，修复前先核查现状（文件/行为可能已变化）。

最近核查：2026-08-20

## 前端（apps/web）

### TD-1 ConfigPanel 硬编码 `projectId: 'default'` 写库

- **来源**：canvas-refresh-data-loss-fix spec 首次 defer，canvas-create-unify-fix spec 延续 defer
- **现状**（2026-08-20 核查）：5 处仍存在
  - `src/api/imageNodeApi.ts:22`（buildImageGenParams）
  - `src/api/imageExtNodeApi.ts:31`
  - `src/pages/canvas/components/nodes/AudioConfigPanel.tsx:162`
  - `src/pages/canvas/components/nodes/VideoConfigPanel.tsx:200`
  - `src/pages/canvas/components/nodes/TextConfigPanel.tsx:163`
- **影响**：生成任务（enqueueWorkflow）归属到名为 default 的错误项目，任务追踪/审计数据错误
- **修复方向**：projectId 从 canvasStore（已有 setProjectId 同步）读取，五处统一；注意测试 `imageExtNodeApi.test.ts:134` 断言了 'default' 需同步更新
- **优先级**：高（上线前）——数据归属错误

### TD-2 `allImages` 双轨数据形状（root-level vs prompt 嵌套）

- **来源**：2026-08-20 类型清零（commit e42863f）过程中发现
- **现状**：写入方与读取方分裂
  - 写：`nodeStore.updatePromptImages` 写**根级** `data.allImages`（nodeStore.ts 注释明确 "root-level shared field, no longer nested in prompt"）
  - 读（仍在读嵌套 `prompt.allImages`）：`VideoConfigPanel.tsx:249/270`（缩略图栏展示）、`useImageUpload.getLatestAllImages`、`nodeStore.ts:455`（节点删除时的引用文件清理 deleteRefs）
  - image 节点链路已迁移至根级（ImageConfigPanel 读根级），video 链路未迁移
- **疑似症状**（待复现确认）：视频节点上传图片后缩略图栏不更新；节点删除时 presigned 引用文件不清理
- **修复方向**：先浏览器复现确认症状；统一迁移 video 链路读根级，或恢复嵌套单一来源；nodeStore.ts:455 的 deleteRefs 需两轨兼容（存量数据可能两处都有）
- **优先级**：高——潜在用户可见 bug

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

## 集中修复建议批次

1. **第一批（用户可见 bug）**：TD-2 → TD-1（复现确认后修）
2. **第二批（测试卫生）**：TD-9
3. **第三批（结构/上线）**：TD-10 → TD-5/6/8 → TD-4
4. **随手清**：TD-3、TD-7

## 已清账

| 项目 | 完成日期 | Commit |
|---|---|---|
| 117 个 TypeScript 类型错误（阻断 `tsc -b` 构建） | 2026-08-20 | e42863f |
| StrictMode 双创建（首页一次点击建 2 个画布） | 2026-08-20 | 3151d51 |
