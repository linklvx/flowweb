# Spec: 随手清批次（第四批：TD-3/7/12/13/14/16 + TD-15 实证升级）

日期：2026-08-21
状态：已确认（D1=仅台账改写另立修复 spec；D2=授权删除 TD-16 两文件；D3=4a/4b/4c 三子批；B1-B3/S1-S3 全落实）
来源：tech-debt.md「随手清」清单（第三批 3d 收官后）
前置：无跨项依赖；各项相互独立

## 侦查结论（2026-08-21 实码核实）

### TD-3 ImageGenNode 死字段写入 `isSaving: false`

- 写入点：[ImageGenNode.tsx:450](../../apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx) 变换保存完成 `updateConfig(id, { ..., isSaving: false })`
- 类型：[nodeStore.ts:129](../../apps/web/src/stores/nodeStore.ts) `ImageNodeData.isSaving?: boolean`（注释自称「变换保存流程写入的标记」）
- 读取方：全库无（TransformToolbar/EditToolbar 的 `isSaving` 是组件 props，与数据字段无关；ImageGenNode 内部 `useState isSaving` 是组件 state）
- 修复：删写入一处 + 删类型一行；检查无测试 mock 依赖数据级 isSaving

### TD-7 nodeData undefined 时空白占位

- **全库仅 1 处**：[ImageGenNode.tsx:981](../../apps/web/src/pages/canvas/components/nodes/ImageGenNode.tsx) `if (!nodeData) return null;`（刷新恢复竞态守卫——canvasStore 有节点但 nodeStore 尚无数据）
- 修复：换 Spin + 轻文案（「内容加载中」），保持竞态守卫语义不变（渲染占位而非组件主体）
- 可访问性（S1）：包裹层 `<div role="status" aria-live="polite">` 显式声明（antd Spin 默认不带 role="status"）；测试断言用 getByTestId + toHaveAttribute('role','status')（规避 Spin 内部结构歧义），与 TD-4 遮罩同模式

### TD-12 `PromptValue.allImages` 僵尸类型字段

- 定义：[nodeStore.ts:90](../../apps/web/src/stores/nodeStore.ts) `PromptValue.allImages: ImageItem[]`（**必填字段**，被 ImageNodeData/VideoNodeData 的 `prompt?: PromptValue` 引用）
- **类型完整性（B1 已核实）**：删 allImages 后 PromptValue 剩 `text: string; html: string; referencedImageIds: string[]` ——**非空接口**，无连带删除 prompt 字段问题；mock 全为完整 PromptValue 形状（text/html 俱在），无 `prompt: {}` 模式
- 初始 prompt 形状：[nodeStore.ts:258](../../apps/web/src/stores/nodeStore.ts)（mergeNodeData 的 imageGenDefaults）迁移后为 `prompt: { text: '', html: '', referencedImageIds: [] }`（保留三字段仅删 allImages 键，非 undefined/{}）
- 运行时：读写已全迁根级 `data.allImages`；`mergeImageRefs`（nodeStore.ts:232）用内联结构类型兼容读旧嵌套数据（持久化 JSON 反序列化，不依赖 PromptValue 接口）——删类型不影响该兼容逻辑
- 迁移规模与模式（B2 已核实）：嵌套处约 52+ 行，**全部为单行空数组 `allImages: [],`**（内容全在根级，如 imageNodeApi.test.ts:55-57 嵌套空 + 根级含内容）；无嵌套非空样例
- **迁移工具决策（B2）**：ts-morph/jscodeshift 不在 devDeps，一次性 codemod 引新依赖违反简洁优先——采用**锚点正则 sed**：`s/allImages: \[\], referencedImageIds:/referencedImageIds:/g`（该锚点仅存在于 PromptValue 字段序 text→html→allImages→referencedImageIds 的嵌套字面量内；根级 allImages 从不紧邻 referencedImageIds，无误伤面）。验证协议：① 迁移前后 `grep -c 'allImages: \[\], referencedImageIds'` 归零 + `grep -rn 'prompt: {'` 抽样确认无残留嵌套键；② `git diff --stat` 文件数与预期 10 文件对齐；③ ≥5 处抽样人工确认（含根级含内容样例）；④ 全量测试 + tsc 双绿兜底。若锚点计数与预期不符（存在多行拆分形状），该文件转人工处理

### TD-13 三个实现新增分支无测试覆盖（api）

1. `transform.interceptor.ts:18-21`：`noTransform=true` 直通分支（@NoTransform 跳过包装）——注意构造函数需 `new TransformInterceptor(reflector)`，reflector.get 依赖 NO_TRANSFORM_KEY metadata
2. `sms.service.ts:116-119`：`SendStatusSet[0].Code !== 'Ok'` 拒绝分支（抛 SMS_SEND_REJECTED）
3. `file.controller.ts:11,15`：`type` 查询参数非空过滤路径（material-library）

### TD-14 api spec 文件不在 tsc 类型检查范围

- 根因实证：apps/api/tsconfig.json `"exclude": [..., "**/*.spec.ts"]`
- 修复：新增 tsconfig.spec.json（include src + spec，noEmit），`tsc -p tsconfig.spec.json --noEmit` 接入 test script；TD-9 的 9 例过时断言长期存活的根因即此

### TD-16 useReactFlowSync 死代码

- 引用扫描：仅 `useReactFlowSync.ts` 自身 + 其测试文件，产品代码零接线
- 修复：删 2 文件（**破坏性清理，需用户确认 D2**）

### TD-15 素材库 fileId 疑点 → 升级为结构性断路实证（P1 级新发现）

原台账疑点「apply 不复制 → 删画布节点连带删库资产」侦查后**双重实证**：

1. **埋雷确认**：[CanvasView.tsx:85](../../apps/web/src/pages/canvas/components/CanvasView.tsx) apply 直接 `fileId: file.id`（素材库文件 id，无复制）；[nodeStore.ts:480-482](../../apps/web/src/stores/nodeStore.ts) deleteNode image 分支会 `DELETE /api/storage/files/${fileId}`——若该端点存在，素材库资产被连删
2. **断路确认（更根本）**：`DELETE /api/storage/files/:id` 在后端**根本不存在**（storage 控制器仅 presign/confirm 两个 POST；全后端无 files/:id DELETE 路由；main.ts 无自定义路由）。前端 6 处调用（nodeStore 5 + useImageUpload 1）全部静默 404 no-op（`.catch(() => {})` 吞掉）
3. **后果链**：
   - TD-15 的资产丢失当前实际不发生（因 404），但任何人补上该端点的瞬间，素材库资产立即被连删（从埋雷变实雷）
   - **TD-8 MinIO 孤儿累积仍在进行**——TD-11 修复接通了前端删除调用，但调用打到死端点（TD-11 浏览器验证只验证了调用发出，未验证后端实际删除）
4. **修复牵扯结构决策**（超出随手清量级）：后端补端点（所有权校验 + MinIO 对象删除 + DB 行删除）+ 前端区分上传源与素材引用（或 apply 时复制文件）——需独立 spec/plan；预评审倾向方案 A（后端校验 `ownerId && source==='upload'`，素材引用 403 跳过，前端调用不变），详见附录台账改写稿

### TD-15 台账改写（B3：单独 docs commit，不随 4a）

P1 级实证发现独立追溯——改写前后 diff 见本 spec 附录；TD-8 条目同步改写（孤儿累积进行中，非「修复前遗留」）。

## 处置建议

- **TD-3/7/12/13/14/16** 按随手清本批修（子批 4a/4b/4c）
- **TD-15 本批仅台账改写**：条目更新为实证结论（断路 + 埋雷双事实），升级为中高优先级新债（修复需独立 spec：后端端点设计 + 引用语义决策 A 区分来源 / B apply 复制 / C 暂只标记）；TD-8 现状描述同步（孤儿累积进行中，非「修复前遗留」）

## 批次结构建议

- **4a（web 微清理）**：TD-3（2 行删除）+ TD-7（占位组件）+ TD-16（删 2 死文件，D2 确认后）
- **4b（TD-12 类型卫生）**：锚点 sed 迁移 + 类型删除（单原子，全量一次完成）
- **4c（api 测试卫生）**：TD-14 第一步**裸跑 `tsc -p tsconfig.spec.json --noEmit` 确认基线**（S2：TD-9 后干净是假设非事实；若有残留错误，单独 commit 清零后再接入 test script，避免 TD-14 commit 混入无关修复）→ TD-13 三组测试（在安全网下补，防新 mock 漂移）
- 各子批独立 commit；TD-15/TD-8 台账改写为**独立 docs commit**（B3，先于 4a）

## 验证标准

**总门禁（S3）**：4a/4b/4c 每个子批 commit 前——`pnpm --filter @flowweb/web test` 全绿 + `tsc -b` 零错误；4c 起另加 `tsc -p tsconfig.spec.json --noEmit` 零错误（api 侧测试以 `pnpm --filter @flowweb/api test` 全绿为准）。

1. TD-3：tsc 零错误 + 全量测试绿（无 mock 依赖数据级 isSaving）
2. TD-7：新增测试——nodeData undefined 时渲染占位（getByTestId + role="status" 断言，S1 模式）而非 null
3. TD-12：锚点计数归零 + git diff --stat 与 10 文件预期对齐 + ≥5 处抽样 + 全量测试绿 + tsc 绿 + `PromptValue.allImages` 从类型删除
4. TD-13：三组新测试覆盖对应分支（interceptor 直通不包装 / sms 拒绝抛错 / file type 过滤）
5. TD-14：基线裸跑确认（S2）→ `tsc -p tsconfig.spec.json --noEmit` 通过并接入 test script
6. TD-16：全量测试绿（删除后无引用断裂）
7. TD-15/TD-8：台账两条同步改写（B3：TD-15 实证升级 + 修复方向方案 A 预评审、TD-8 现状改为「孤儿累积进行中」），独立 docs commit，零代码

## 不做什么

- 不修 TD-15 断路本身（另立 spec，涉及后端端点设计与素材引用语义决策）
- 不动 TD-8 MinIO 存量对账（维持「上线前评估」）
- TD-12 不改 mergeImageRefs 运行时兼容逻辑（持久化旧数据反序列化仍需读嵌套形状）
- TD-13 不为 sms/interceptor 引入新 mock 基建以外的重构

## 风险

- TD-12 锚点 sed 误伤面已由字段序锚点排除（B2 验证协议兜底：计数归零 + diff --stat 对齐 + ≥5 抽样 + 双绿）；若发现多行拆分形状转人工
- TD-14 接入前先裸跑基线（S2）；若存量 spec 有类型错误，单独 commit 清零后再接入，不与 TD-14 混合
- TD-16 删除为破坏性操作（git 可恢复，D2 授权后执行）

## 决策点（裁定状态）

- **D1 TD-15 处置**：✅ 已裁定——本批仅台账实证改写 + 修复另立 spec（审核确认）
- **D2 TD-16 删除确认**：**待用户显式授权**——删除 useReactFlowSync.ts + 其测试（破坏性，git 可恢复）
- **D3 批次划分**：✅ 已裁定——4a/4b/4c 三子批（审核确认）

## 附录：TD-15 / TD-8 台账改写稿（B3①，独立 docs commit 内容）

### TD-15 改写前

```markdown
### TD-15 素材库 fileId 随节点删除疑点

- **来源**：2026-08-21 TD-11 修复批次 spec 观察项 O1
- **现状**：CanvasView.tsx:85 素材库「应用到画布」创建节点时 `data.fileId` 直接用素材库文件 id；nodeStore.deleteNode 的 image 分支会 DELETE 该 fileId——若素材库文件被库内引用，删画布节点会连带删库资产。TD-11 批次浏览器验证未覆盖「素材应用节点删除」场景，**未实证**
- **修复方向**：核查素材 apply 是否复制文件；若不复制，image 分支的 fileId 删除需区分上传源与素材引用（或 apply 时复制）
- **优先级**：中——潜在用户资产丢失，未实证
```

### TD-15 改写后

```markdown
### TD-15 删除清理链路后端断路 + 素材引用埋雷（实证升级）

- **来源**：TD-11 修复批次 spec 观察项 O1（原疑点）；2026-08-21 随手清批次侦查双重实证（spec: cleanup-batch4-quick-wins）
- **现状**：
  1. 断路（根本）：`DELETE /api/storage/files/:id` 后端不存在（storage 控制器仅 presign/confirm 两 POST；全后端无 files/:id DELETE 路由）；前端 6 处删除调用（nodeStore.ts 5 处 + useImageUpload.ts:180）全部静默 404 no-op——画布侧文件删除实际零生效，TD-8 MinIO 孤儿持续累积
  2. 埋雷：CanvasView.tsx 素材 apply 直接 `fileId: file.id`（不复制）+ nodeStore.deleteNode image 分支 DELETE 该 id——端点一旦补上，素材库资产立即被连删
- **修复方向**（预评审倾向方案 A）：后端补 DELETE 端点，校验 `file.ownerId === userId && file.source === 'upload'`，素材引用（source=material）403 跳过；前端 deleteNode 调用不变；存量节点 source 标记需迁移策略；MinIO 孤儿由端点实际删除逐步消化 + 一次性对账（并入 TD-8）
- **优先级**：高——修复需独立 spec（端点设计 + 引用语义 + 存量迁移三决策）
```

### TD-8 改写（仅「现状」行）

改写前：

```markdown
- **现状**：无生产用户；对账需 DB media 全量 vs MinIO listing（服务端脚本域）
```

改写后：

```markdown
- **现状**：无生产用户；孤儿累积**进行中**（TD-15 实证：删除调用打到死端点实际零删除，非仅「修复前遗留」）；对账需 DB media 全量 vs MinIO listing（服务端脚本域）
```
