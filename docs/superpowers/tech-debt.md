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

### TD-7 nodeData undefined 时空白占位

- **来源**：canvas-refresh-data-loss-fix spec（UX 债）
- **现状**：相关组件 `return null`，用户看到空白
- **修复方向**：换 Spin/轻文案占位
- **优先级**：低

### TD-8 MinIO 存量孤儿文件对账

- **来源**：canvas-create-unify-fix spec 明示「不会自愈」；TD-11 修复前已删节点泄漏的 MinIO 文件；localStorage 脏数据部分已随 3c 基线重构清账（v2 版本化快照 + 旧 key 一次性清扫）
- **现状**：无生产用户；对账需 DB media 全量 vs MinIO listing（服务端脚本域）
- **修复方向**：上线前评估——若无生产数据可直接忽略；否则一次性清理脚本（含 DB media vs MinIO listing 对账）
- **优先级**：上线前评估

## 后端（apps/api）

### TD-13 三个实现新增分支无测试覆盖

- **来源**：2026-08-21 TD-9 修复批次（spec 明示不补覆盖，记台账）
- **现状**：`transform.interceptor` 的 noTransform=true 分支（@NoTransform 跳过包装）、`sms.service` 的 SendStatusSet.Code !== 'Ok' 拒绝分支（SMS_SEND_REJECTED 抛错路径）、`file.controller` 的 type 参数非空过滤路径——均为实现新增逻辑，零覆盖
- **修复方向**：各补 1-2 个用例；属测试增强
- **优先级**：低

### TD-14 api spec 文件不在 tsc 类型检查范围

- **来源**：2026-08-21 TD-9 修复批次发现（结构性根因）
- **现状**：api tsconfig.json 排除 `**/*.spec.ts`，测试与实现的接口漂移无编译期安全网，仅运行时暴露——TD-9 的 9 例过时断言（如 `new TransformInterceptor()` 无参调用）长期存活的根因即此
- **修复方向**：新增 tsconfig.spec.json 并 `tsc -p tsconfig.spec.json --noEmit`（可接入 test script 或 CI）
- **优先级**：低——一次性基建投入，长期防接口漂移静默累积

## 数据 / 部署

### TD-15 素材库 fileId 随节点删除疑点

- **来源**：2026-08-21 TD-11 修复批次 spec 观察项 O1
- **现状**：CanvasView.tsx:85 素材库「应用到画布」创建节点时 `data.fileId` 直接用素材库文件 id；nodeStore.deleteNode 的 image 分支会 DELETE 该 fileId——若素材库文件被库内引用，删画布节点会连带删库资产。TD-11 批次浏览器验证未覆盖「素材应用节点删除」场景，**未实证**
- **修复方向**：核查素材 apply 是否复制文件；若不复制，image 分支的 fileId 删除需区分上传源与素材引用（或 apply 时复制）
- **优先级**：中——潜在用户资产丢失，未实证

### TD-16 useReactFlowSync 死代码处置

- **来源**：2026-08-21 TD-11 修复批次（原 TD-11 附属观察项 O2）
- **现状**：仅测试引用，产品代码未接线；TD-11 已用 onNodesChange remove 分支方案替代复活方案
- **修复方向**：删除该 hook 及其测试文件（属破坏性清理，执行前需确认）
- **优先级**：低

### TD-12 `PromptValue.allImages` 僵尸类型字段

- **来源**：2026-08-21 TD-2 修复批次（spec O3 决议保留类型、记台账）
- **现状**：运行时读写已全部迁移根级 `data.allImages`，`PromptValue.allImages` 无运行时读取方；几十处测试 mock 仍使用嵌套形状
- **修复方向**：测试 mock 批量迁移到根级形状后，从 `PromptValue` 类型移除该字段（连带 nodeStore.ts:245 初始 prompt 形状）
- **优先级**：低——纯类型卫生

## 集中修复建议批次

1. ~~**第二批（测试卫生）**：TD-9~~ ✅ 已完成（2026-08-21，3bcd50c）
2. **第三批（结构/上线）**：~~3a: TD-11~~ ✅ 已完成（2026-08-21，5584864）→ ~~3b: TD-10~~ ✅ 已完成（2026-08-21，d2cae05）→ ~~3c: TD-5/6/8~~ ✅ 已完成（2026-08-21，8be333a）→ 3d: TD-4
3. **随手清**：TD-3、TD-7、TD-12、TD-13、TD-14、TD-15、TD-16

## 已清账

| 项目 | 完成日期 | Commit |
|---|---|---|
| 117 个 TypeScript 类型错误（阻断 `tsc -b` 构建） | 2026-08-20 | e42863f |
| StrictMode 双创建（首页一次点击建 2 个画布） | 2026-08-20 | 3151d51 |
| TD-2 allImages 双轨统一（根级）：useImageUpload/VideoConfigPanel/deleteRefs 三读取方迁移 + 测试基建修正 | 2026-08-21 | 7a62eb2 / bdf8fdd / 4af7834 |
| TD-1 projectId 硬编码（实际 15 处非台账原记 5 处，含 syncNodes/syncEdges 位置参数形式漏报；修复带节点画布生成 500 阻断） | 2026-08-21 | e82cf36 |
| TD-9 既有测试失败 9 例（5 文件，全部为实现演进后断言/mock 过时，零实现回归；结构性根因另立 TD-14） | 2026-08-21 | 3bcd50c |
| TD-11 删除链路三层断裂：remove 接线（三件套+DB 同步）+ videoGen/audioGen 清理分支（生成 fileId 不删，D1）；存量泄漏处置见 TD-8 / 3c；衍生 TD-15/TD-16 | 2026-08-21 | 5584864 |
| TD-10 Prisma migrate 历史断裂（基线重置为单一 init，沙箱重放自证；部署流程固化于 deployment-db-baseline.md；遗留：本地 `migrate dev` 需用户一次性执行 `ALTER ROLE flowweb CREATEDB`） | 2026-08-21 | d2cae05 |
| TD-5/6 localStorage 持久化合一：单一版本化快照 `flowweb_canvas_v2_${pid}`（nodeStore 数据权威 + 视图派生恢复 + isHydrating 抑制单写者 + 旧 key 一次性清扫）；TD-8 localStorage 部分随清，余 MinIO 对账 | 2026-08-21 | 8be333a |
