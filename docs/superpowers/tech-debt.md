# 技术债务台账

> 用途：集中登记 P2 及以下技术债，供下次集中修复时挑选任务。
> 约定：每项含【来源】【现状核查日期】【修复方向】；完成一项移入文末「已清账」并注明 commit。
> 新债发现时随手追加，修复前先核查现状（文件/行为可能已变化）。

最近核查：2026-08-21

## 前端（apps/web）

### TD-8 软删 Media 行的 MinIO 对象回收

- **来源**：canvas-create-unify-fix spec 明示「不会自愈」；TD-11 修复前已删节点泄漏的 MinIO 文件；localStorage 脏数据部分已随 3c 基线重构清账（v2 版本化快照 + 旧 key 一次性清扫）
- **现状**：无生产用户；TD-15 方案 B 落地后画布侧不再产生孤儿，唯一孤儿来源 = 库内软删（deletedAt）行的 MinIO 对象；对账需 DB media 全量 vs MinIO listing（服务端脚本域）
- **修复方向**：上线前评估——若无生产数据可直接忽略；否则一次性清理脚本（含 DB media vs MinIO listing 对账）；可选运行时回收（软删 >N 天物理清扫，temp-cleanup 模式扩展）
- **优先级**：上线前评估

## 后端（apps/api）

## 数据 / 部署

## 集中修复建议批次

1. ~~**第二批（测试卫生）**：TD-9~~ ✅ 已完成（2026-08-21，3bcd50c）
2. **第三批（结构/上线）**：~~3a: TD-11~~ ✅ 已完成（2026-08-21，5584864）→ ~~3b: TD-10~~ ✅ 已完成（2026-08-21，d2cae05）→ ~~3c: TD-5/6/8~~ ✅ 已完成（2026-08-21，8be333a）→ ~~3d: TD-4~~ ✅ 已完成（2026-08-21，8397472，第三批全部收官）
3. ~~**随手清**：TD-3、TD-7、TD-12、TD-13、TD-14、TD-15、TD-16~~ ✅ 全部完成（2026-08-21/22，第四批 a20bab1/c939c20/c43ccc0/de9b744/257d86b；TD-15 于 08-22 方案 B 收口）

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
| TD-3 isSaving 死写入+类型删除；TD-7 nodeData 竞态空白换 Spin 占位（role=status）；TD-16 useReactFlowSync 死代码删除 | 2026-08-21 | a20bab1 |
| TD-12 PromptValue.allImages 僵尸字段移除：54 处锚点 mock 迁移（8 文件）+ PromptInput 类型化字面量/断言同步 + 产品侧双 ConfigPanel 嵌套写入点清理 + mergeImageRefs 参数与 PromptValue 解耦（legacy 兼容读取保留） | 2026-08-21 | c939c20 |
| TD-14 spec 编译安全网：tsconfig.spec.json（vitest/globals types）接入 test script 前置 tsc；清零 13 处潜伏类型错误（S2 单独清零 commit c43ccc0） | 2026-08-21 | c43ccc0 / de9b744 |
| TD-13 三分支覆盖补齐：interceptor @NoTransform 直通不包装 / sms SendStatusSet 非 Ok 拒绝（含状态码透传与 SMS_SEND_REJECTED 兜底）/ file controller type 非空过滤透传 | 2026-08-21 | 257d86b |
| TD-15 双实证（断路+埋雷，b3eafad）→ 方案 B 收口：移除 6 处死调用（deleteNode 四分支 + useImageUpload）固化「画布删除不触文件清理」语义——Media 行是素材库/历史资产（软删为产品语义）、生成结果不随节点删除（TD-11 D1 扩展至 imageGen/trim）；mergeImageRefs 随调用方退役 | 2026-08-22 | b3eafad + 本批（hash 回填） |
