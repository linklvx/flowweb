# 技术债务台账

> 用途：集中登记 P2 及以下技术债，供下次集中修复时挑选任务。
> 约定：每项含【来源】【现状核查日期】【修复方向】；完成一项移入文末「已清账」并注明 commit。
> 新债发现时随手追加，修复前先核查现状（文件/行为可能已变化）。

最近核查：2026-08-21

## 前端（apps/web）

### TD-8 MinIO 存量孤儿文件对账

- **来源**：canvas-create-unify-fix spec 明示「不会自愈」；TD-11 修复前已删节点泄漏的 MinIO 文件；localStorage 脏数据部分已随 3c 基线重构清账（v2 版本化快照 + 旧 key 一次性清扫）
- **现状**：无生产用户；孤儿累积**进行中**（TD-15 实证：删除调用打到死端点实际零删除，非仅「修复前遗留」）；对账需 DB media 全量 vs MinIO listing（服务端脚本域）
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

### TD-15 删除清理链路后端断路 + 素材引用埋雷（实证升级）

- **来源**：TD-11 修复批次 spec 观察项 O1（原疑点）；2026-08-21 随手清批次侦查双重实证（spec: cleanup-batch4-quick-wins）
- **现状**：
  1. 断路（根本）：`DELETE /api/storage/files/:id` 后端不存在（storage 控制器仅 presign/confirm 两 POST；全后端无 files/:id DELETE 路由）；前端 6 处删除调用（nodeStore.ts 5 处 + useImageUpload.ts:180）全部静默 404 no-op——画布侧文件删除实际零生效，TD-8 MinIO 孤儿持续累积
  2. 埋雷：CanvasView.tsx 素材 apply 直接 `fileId: file.id`（不复制）+ nodeStore.deleteNode image 分支 DELETE 该 id——端点一旦补上，素材库资产立即被连删
- **修复方向**（预评审倾向方案 A）：后端补 DELETE 端点，校验 `file.ownerId === userId && file.source === 'upload'`，素材引用（source=material）403 跳过；前端 deleteNode 调用不变；存量节点 source 标记需迁移策略；MinIO 孤儿由端点实际删除逐步消化 + 一次性对账（并入 TD-8）
- **优先级**：高——修复需独立 spec（端点设计 + 引用语义 + 存量迁移三决策）

### TD-16 useReactFlowSync 死代码处置

- **来源**：2026-08-21 TD-11 修复批次（原 TD-11 附属观察项 O2）
- **现状**：仅测试引用，产品代码未接线；TD-11 已用 onNodesChange remove 分支方案替代复活方案
- **修复方向**：删除该 hook 及其测试文件（属破坏性清理，执行前需确认）
- **优先级**：低

## 集中修复建议批次

1. ~~**第二批（测试卫生）**：TD-9~~ ✅ 已完成（2026-08-21，3bcd50c）
2. **第三批（结构/上线）**：~~3a: TD-11~~ ✅ 已完成（2026-08-21，5584864）→ ~~3b: TD-10~~ ✅ 已完成（2026-08-21，d2cae05）→ ~~3c: TD-5/6/8~~ ✅ 已完成（2026-08-21，8be333a）→ ~~3d: TD-4~~ ✅ 已完成（2026-08-21，8397472，第三批全部收官）
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
| TD-4 慢请求覆盖窗口收口：写侧抑制（3c isHydrating 单写者，8be333a）+ 读侧遮罩封交互（isHydrating 全屏遮罩挡指针 + CanvasKeyboardHandler 首行守卫封键盘，浏览器 2s 慢 fetch 实证窗口内零交互零写入） | 2026-08-21 | 8be333a / 8397472 |
| TD-3 isSaving 死写入+类型删除；TD-7 nodeData 竞态空白换 Spin 占位（role=status）；TD-16 useReactFlowSync 死代码删除 | 2026-08-21 | （hash 回填） |
| TD-12 PromptValue.allImages 僵尸字段移除：54 处锚点 mock 迁移（8 文件）+ PromptInput 类型化字面量/断言同步 + 产品侧双 ConfigPanel 嵌套写入点清理 + mergeImageRefs 参数与 PromptValue 解耦（legacy 兼容读取保留） | 2026-08-21 | （hash 回填） |
