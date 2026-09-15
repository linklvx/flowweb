# 视频作品展示页（Video Works）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公开免登录的视频作品展示页 `/videos`（列表 + 全屏播放 Modal + 创作过程快照 + 画布克隆）+ Admin 策展后台 + by-key 兑换口前置修复。

**Architecture:** 独立功能岛 `modules/video-work/`（公开+admin 双 controller 共用 service，样板参照 home-banner）；快照与克隆共用同一白名单纯函数；presign 3600s 直连 + /flowai 同源改写；单路由 `/videos/:id?` 驱动 Modal。

**Tech Stack:** NestJS 10 + Prisma + PostgreSQL + Redis + MinIO；React 18 + antd 5.22.5 + @xyflow/react v12 + Tailwind；Vitest 全栈 strict TS。

**Spec:** `docs/superpowers/specs/2026-09-16-video-works-design.md`（七轮审核冻结；第八轮勘误归一——spec 与 plan 的分叉已全部消除）。执行本 plan 前须通读 spec 的 D1-D18 决策与 §4.6 白名单表、§4.7 克隆伪代码——本 plan 引用其结论不重复论证。

**TDD 铁律:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST。每任务红-绿-提交。测试命令：api `pnpm --filter @flowweb/api test`（含 tsc -p tsconfig.spec.json --noEmit）；web `pnpm --filter @flowweb/web test`（**仅 vitest、无类型检查**）——**每个 web 批次（7/8/9/10）收尾必须加跑 `pnpm --filter @flowweb/web exec tsc -b`**（=build 脚本的类型半边，emit 到 dist 无害、比整跑 vite build 快；tsconfig include:["src"] 连测试文件一起查，否则类型错误堆积到批次 11 才暴露。第八轮立规、第十轮由 build 减负为 tsc -b，批次 11.1 仍跑全量 build）。纯文件操作类任务（migration/DB 核查）无测试对象，按步骤执行但验证不可省。

---

## ⚠️ 执行前必读：落地约定与勘误（**正文为唯一权威**——单一规则，勿再按勘误层执行）

> 第八轮归一：C1 约定表、C5 测试装配模板、C4 边界清单长期有效；**C2/C6/C7 为历史审核记录，其修正均已回写正文——记录与正文冲突时一律以正文为准**。已知被正文取代的勘误实例：①C2"Task 2.5"的 fileFilter 单行静默拒绝版（`cb(null, regex.test)`）已被正文显式抛错版取代（`cb(new BadRequestException, false)`——admin-home-banner.controller.ts:42 与 subscription/admin-banner.controller.ts:30 两处先例同款）；②C7-F4 的 shadow 库方案整体废止（正文 Task 1.1 Step 4 已改 `--from-schema-datasource` 免 shadow 方案）。

### C1. 全局落地约定（C1-1～C1-6 共 6 条，覆盖多数阻断项）

| # | 约定 | 依据 |
|---|---|---|
| C1-1 | **前端 API 调用一律不带 `/api` 前缀**：`apiFetch('/video-works?...')`（client.ts:1 `BASE_URL='/api'` 已内置）。**已机械回写正文全部 apiFetch 路径——含 Task 10.1 admin 侧 16 处（admin 先例 adminApi.ts:29 `apiFetch('/admin/node-types')` 不带 /api；`adminFetch` 函数不存在，一律 apiFetch）**。**唯一例外**：multipart 上传不能走 apiFetch（硬编码 JSON Content-Type 冲掉 boundary）——用裸 `fetch('/api/admin/video-works/upload-cover', { method:'POST', body: formData, credentials:'include' })`（**此处必须带 /api**，逐字对齐 adminApi.ts:137 先例），响应解析 `body.data ?? body`（先例 adminApi.ts:133-144 注释明写） | client.ts:1,11；mediaApi.ts:4；adminApi.ts:29,133-144 |
| C1-2 | **测试双栈约定**：api 侧 `import { describe, it, expect, beforeEach, vi } from 'vitest'` + `vi.fn()`（**已机械回写**：正文全部 `vi.fn()`/`Mock`；用到 `Mock` 类型的 spec 文件顶部补 `import type { Mock } from 'vitest'`——api 跑 tsc，`jest` 未定义直接编译红）；web 侧路由导入一律 `from 'react-router'`（**已机械回写全文 import**；react-router-dom 包不存在，web/package.json 只有 react-router@^7；MemoryRouter/createMemoryRouter/RouterProvider/useParams/useNavigate/useLocation 全部从 react-router 导出） | api package.json:8；media.service.spec.ts:2；web package.json:39 |
| C1-3 | **全屏壳（z-[100000]）内 toast/弹层机制（第五轮修正——单嵌套 ConfigProvider 抬不起 useApp() toast）**：①静态 `message.*` 落 body、z≈2010（AssetPanel.tsx:34 注释实测值）被壳盖住，禁用；②壳是 createPortal(document.body)（BaseFullscreenModal.tsx:68-80）但 React context 按组件树走——**壳内组件 `AntdApp.useApp()` 解析到根 App（App.tsx:15，holder 挂 body、z 基座 11000）→ 壳内 toast 仍被盖；嵌套 ConfigProvider 只能抬 Modal 类弹层（读最近 Provider token），追不到根 App 的 holder**。**正确配方（第七轮措辞修正：**结构**照抄 VideoEditorShell.tsx:127-141（同为 BaseFullscreenModal 壳）——getPopupContainer 进壳 + `<AntdApp component={false}>`（component={false} 必须：默认渲染 div.ant-app 打断壳布局）；**`theme token zIndexPopupBase:100000` 是本 plan 新增层，先例没有**（其 theme 只有 darkAlgorithm、弹层从不落 body 故不需要；本功能 LoginModal 需要它保首帧回退路径，勿以"先例没有"为由删掉）。另**有意不加 darkAlgorithm**：LoginModal 全仓均为浅色渲染（TopActionBar 先例），加了反而换肤。配方：壳根 div 挂 shellRef，内容包两层——嵌套 `<ConfigProvider theme={{ token:{ zIndexPopupBase:100000 } }} getPopupContainer={() => shellRef.current ?? document.body}>` 内再 `<AntdApp component={false}>`；PlayView/ProcessView 渲染在内层 App 之下，直接 `const { message } = AntdApp.useApp()`（holder 渲染在壳 DOM 内 → 可见，无需 bridge）**。LoginModal（antd Modal）读最近 Provider token → z=100100 > 壳 100000，D18 不变。（第九轮删旧注：LoginModal 自身不调用 useApp/message——components/auth/ 下零命中；嵌套 AntdApp 层服务的是 PlayView/ProcessView 的 toast，勿据此写"LoginModal 弹 toast"断言。）**两层各自的作用（勿"简化"掉任一层，第六轮 N9）**：getPopupContainer 是常规路径（弹层挂进壳 DOM）；zIndexPopupBase:100000 是首帧/兜底路径（shellRef 未挂载首帧 getPopupContainer 回退 body——VideoEditorShell.tsx:128-129 注释："漏挂 shellRef 则永远回退 body，弹层作用域修复静默失效"，此时唯一撑住可见性的是 token 的 100100>100000）。**Esc 双关守卫是承重机制（勿删；机制措辞第六轮修正）**：rc-dialog 9.6.0 的 ESC 处理在 `onWrapperKeyDown`（Dialog/index.js:144-148）——挂在 dialog 包装**节点**上（React onKeyDown）且 e.stopPropagation()。焦点在登录框内 → 事件在 wrapper 节点被截、冒泡不到 document，壳不受影响（第八轮源码级复核维持本结论：React 18 合成 e.stopPropagation() 会调用 nativeEvent.stopPropagation()，且 antd Modal portal 到 body、React 委托监听在 portal 容器——原生传播止于 body，document 上的壳监听收不到；曾有第八轮外审称"合成事件不阻断原生冒泡、两种焦点场景壳都会触发"，该机制论不成立，勿据其改写）；**焦点不在登录框内**（点了壳内其它区域/焦点在 body）→ 事件不经 rc-dialog 的 wrapper、直达 document → BaseFullscreenModal 监听触发——无守卫时关掉的是整个播放 Modal；守卫（close 回调首行 `if (showLogin) { setShowLogin(false); return; }`）使该场景只关登录层。副作用登记为有意：登录层开着时点壳 ✕ 只关登录层。**测试装配**：渲染链含 useAuth 的测试文件必须 `vi.mock('@/components/AuthProvider', ...)`（context 默认 `null!`，裸渲染解构即抛，AuthProvider.tsx:25,56）；message stub 四键齐全或测试树包 `<AntdApp>`（先例 AssetPanel.test.tsx:28、ExportModal.test.tsx:7） | VideoEditorShell.tsx:19-24,127-141；AssetPanel.tsx:34；BaseFullscreenModal.tsx:57,68-80；App.tsx:8-19；rc-dialog Dialog/index.js:144-148 |
| C1-4 | **关键组件真实 API**：MinIO 写对象是 `this.minio.upload(key, buffer, contentType)`（**无 putObject/uploadBuffer**）；上传键一律 `this.minio.buildKey('uploaded', 'system', { ext })` → `uploads/system/{date}/{uuid}.{ext}`（内置 randomUUID，与 D17 白名单精确对齐，**勿手拼 key 勿用 uuid 包**——该包非依赖，仓库用 node:crypto）。`isLoggedIn()` 不存在——用 `const { user } = useAuth()` 判 `!user`（AuthProvider.tsx:17-23，App.tsx:16 AuthProvider 包住 RouterProvider，公开路由可用 hook）。EmptyState/CardGridSkeleton 是 **workspace 私有组件**（pages/workspace/components/，EmptyState 必填 variant+onAction）——/videos 不复用，内联 ≤5 行空态/骨架（D2 孤岛） | minio.service.ts:46-57,105；admin-home-banner.controller.ts:39-66（第六轮更正路径——原引"admin-banner.controller.ts:27-57"是订阅 banner 文件）；nodeStore 类型真值 |

**C1-5（第十轮新增）**：api 侧 spec 块凡 `toThrow(异常类)` 的，宿主文件头必须 import 对应类（`@nestjs/common` / `@nestjs/throttler`）——api test 第一步是 tsc，缺导入是 TS2304、红因与 plan 声明不符。四个 spec 头已随任务配齐（2.1 BadRequest / 2.2 四类 / 3.2 Unauthorized / 6.1 四类），后续追加新异常时同步补。

**C1-6（第十二轮新增，web 侧文件级铁律）**：仓内 web vitest **未开 clearMocks/restoreMocks/mockReset**（vite.config.ts:29-33 仅 globals/environment/setupFiles；test-setup.ts 亦无 afterEach 清理）——mock 的**实现**与**调用历史**都跨用例存活（两个独立症状：实现存活如 Task 9.2 曾靠上用例 mock 才绿；历史存活如 not.toHaveBeenCalled 撞前用例残留计数）。凡断言 `toHaveBeenCalledTimes(n)` / `not.toHaveBeenCalled()` / 依赖 `mock.calls[i]` 的测试文件，beforeEach（或公共 render helper）**首行必须 `vi.clearAllMocks()`**——只清记录保留实现，其后重新声明本文件依赖的 mockResolvedValue。api 侧免疫（各 spec beforeEach 重建 prisma/minio 等替身，天然无残留）。先例：ExportModal.test.tsx:73（"旧 I-1 坑"注释）、AnnouncementPage.test.tsx:19。本 plan 落点：Task 8.1/8.3/9.2。**豁免（第十三轮补）**：单用例文件（如 Task 7.3 route.integration 全文一例）、或断言对象为用例体内新建的局部替身（如 Task 8.2 的 onDetailRefresh——局部 vi.fn 无跨用例共享面）天然无残留，无需清理，勿照字面加无意义行。

### C2. 正文代码块勘误（按 Task 序；历史记录——已回写正文，冲突以正文为准，勿按本节执行）

**Task 1.1 Step 4**（**第八轮已废止——本段 shadow 方案整体不再使用**，正文 Task 1.1 Step 4 已改 `--from-schema-datasource` 免 shadow 方案；下文保留仅为审计记录）：shadow-database 命令的 `\|\| echo` 兜底会把失败变"假成功"——改为断言 diff 输出为空：

```bash
cd apps/api
# 第七轮修正：.env 的 DATABASE_URL 带双引号且行尾是 "（sed 's/flowweb$/' 不匹配）→ 原命令会把"带引号的原库 URL"当 shadow 库传给 prisma（重置风险）。
# 先 tr -d '"' 去引号、再锚定路径段 /flowweb$ 替换；并断言替换确实发生。
SHADOW_URL=$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"' | sed 's#/flowweb$#/flowweb_shadow#')
ORIG_URL=$(grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')
[ "$SHADOW_URL" != "$ORIG_URL" ] || { echo "FAIL: shadow URL 未生效（检查 .env 格式）"; exit 1; }
DIFF=$(pnpm exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "$SHADOW_URL" 2>&1)
[ -z "$DIFF" ] && echo "OK: 零差异" || { echo "FAIL: $DIFF"; exit 1; }
```

（Windows 本机执行注记：Task 0.1/1.1/11.2 中 `grep|cut|sed`/`$(...)` 为 bash-only，本机 bash 可用；若换 PowerShell 需等价改写。）**另**：Step 3 预期文案"含 5 张表 DDL"应为"4 张表 + 1 enum + Media 索引"。

**Task 1.3**：module 骨架**先建 `video-work-clone.service.ts` 空壳类**（`@Injectable() export class VideoWorkCloneService {}`），providers 直接全量列出，不留注释中间态；REDIS_CLIENT 工厂照抄 **media.module.ts** 模式（`validateEnv().REDIS_URL` 或 auth.module.ts:13-20 的 `process.env.REDIS_URL || 'redis://localhost:6379/0'` 兜底，勿裸 `new Redis(undefined)`）：

```ts
providers: [
  VideoWorkService,
  VideoWorkCloneService,   // 空壳，Task 6.1 填充
  RateLimiterService,      // 类形式直接 provide（auth.module.ts:13-20 先例），无需 useFactory 包一层
  { provide: 'REDIS_CLIENT', useFactory: () => new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0'), inject: [] },
],
```

（注：RateLimiterService 构造注入 `'REDIS_CLIENT'`——同模块内 token 可解析。AppModule 级 REDIS_CLIENT 是私有 provider，功能模块拿不到，自备判断正确。）

**Task 2.1**：controller spec 的 service mock **补全 controller 实际调用的全部方法**（正文 mock 漏了 `listAllCategories/listAllTags/listAllWorks/createWork/updateWork/getWork/removeWork/uploadCover/getSettings/updateSettings/listCandidates`——逐个 `vi.fn()` 列出，勿用 `new Proxy` 兜底）。**AdminVideoWorkController 类级挂 ValidationPipe（正文缺失，安全边界）**：

```ts
@Controller('api/admin/video-works')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 仓库无全局 pipe（main.ts:89-90 只挂 filter+interceptor）——不挂则 DTO 装饰器纯装饰，{...dto} 会把 publishedAt 等任意字段透传进 Prisma（先例 admin-home-banner.controller.ts:12）
export class AdminVideoWorkController { ... }
```

VideoWorkController（公开侧 body 端点 view/like/clone 同理，类级挂载）。

**Task 2.2**：controller 片段括号修正：

```ts
@Get('candidates')
listCandidates(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
  return this.service.listCandidates(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
}
```

**Task 2.3**：DTO 的 `@IsEnum(['DRAFT','PUBLISHED'])` 功能成立（class-validator 0.14 按值匹配）但错误消息为空——换 `@IsIn(['DRAFT', 'PUBLISHED'] as const)` 文案更干净。**updateWork 下架不清 publishedAt 是有意行为**（再次上架保留原发布日期，spec §3.2"重新下架再发布不重置"）。

**Task 2.5**：整体替换为照抄 banner 先例（minio.service.ts:105 upload 三参 + buildKey；controller 挂 FileInterceptor + limits + fileFilter，先例 **admin-home-banner**.controller.ts:39-66——第七轮修正文件名，"admin-banner.controller.ts" 是订阅 banner 文件且行号不符）：

```ts
// controller
@Post('upload-cover')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image\/(png|jpe?g|webp))$/.test(file.mimetype)),
}))
uploadCover(@UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }) { // 仓库无 @types/multer——内联类型，勿用 Express.Multer.File
  if (!file) throw new BadRequestException('file is required');
  return this.service.uploadCover(file.buffer, file.mimetype);
}

// service
async uploadCover(buffer: Buffer, mimetype: string): Promise<{ key: string }> {
  // magic-number（WebP 查 12 字节：RIFF(0-3) + 偏移 8-11 WEBP——banner 同款，勿只查 4 字节）
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
  if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
  const key = this.minio.buildKey('uploaded', 'system', { ext });
  await this.minio.upload(key, buffer, mimetype);
  return { key };
}
```

（spec 断言相应改为 `minio.upload` 收到 `(key, buffer, mimetype)` 且 key 匹配 `^uploads/system/`。）

**Task 3.3**：匿名短路断言与实现矛盾修正（presignWork 也调 redis.get）——断言收窄：

```ts
it('liked 初始态：匿名 false 且未查询 like 键（匿名短路——URL 缓存的 get 不在此限）', async () => {
  // ... setup 同正文
  const getCalls = (service as any).redis.get.mock.calls as string[][];
  const d = await service.getDetail('w1', null);
  expect(d.liked).toBe(false);
  expect(getCalls.flat().some((k: any) => String(k).startsWith('videoWork:like:'))).toBe(false); // 只断言 like 键未查
});
```

**Task 4.3**：$executeRaw tagged template 断言修正（mock 第 1 参是模板字符串数组；**正文三条 `toHaveBeenCalledWith(expect.stringContaining('GREATEST'), ...)` 全部废弃**——①stringContaining 匹配不了 TemplateStringsArray，②值序是 (delta, id) 不是 (id, delta)）。**统一改为此式，delta 用字面量（它是 service 内部变量，测试文件无此名）**：

```ts
// mock：prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1));
// 首次点赞 / 取消 / 下界 三条用例同款（值序分别为 [1,'w1'] / [-1,'w1'] / [-1,'w1']）：
const call = (prisma.$executeRaw as any).mock.calls[0];
expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)'); // SQL 模板拼接（join('?') 还原参数位）
expect(call.slice(1)).toEqual([1, 'w1']);                           // 值序：(delta, id)
```

**Task 5.1 WHITELIST 真值表（第五轮修正——aspectRatio 回归：nodeStore.ts:113 它是根级通用字段（imageGen/imageExtGen 都有），上一版拆表误删，spec §4.6 明确保留）**：

```ts
export const WHITELIST: Record<string, string[]> = {
  textInput: ['content', 'prompt'],                                  // content=HTML→纯文本；prompt=string
  imageGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio'],  // style/model/prompt 为 imageGen 根级专属（nodeStore.ts:117-122）
  imageExtGen: ['prompt', 'aspectRatio', 'aiTool'],                  // aiTool/aspectRatio 根级（:113,:126）；prompt 通常在 extConfig 内随整体剥离——保留 'prompt' 为 no-op 兜底（与 spec 合并行语义一致）
  videoGen: ['model', 'ratio', 'prompt', 'trimStart', 'trimEnd', 'label'],  // label 运行期由导出写入（nodeStore 未声明，PreviewPlayer 以断言读）
  audioGen: ['model', 'content'],
  multiImageGen: ['prompt', 'label'],
  videoEdit: [],
  group: ['groupType', 'cells', 'name'],
};
```

（ImageNodeData 是覆盖 imageGen/imageExtGen 的**单一接口**（nodeStore.ts:101-127）：aspectRatio 属"根级通用"注释组、aiTool/extConfig 属"imageExtGen 专属"组、style/model/quality/ratio/resolution/prompt 属"imageGen 根级专属"组。applyWhitelist 的 `if (!(field in node.data)) continue` 使缺失字段 no-op——本表与 spec §4.6 合并行**语义等价**，ext 节点的提示词 v1 不外显是 spec 冻结决策（"extConfig 整体剥离…将来若保留须先剥 extConfig.prompt"）。）

**补独立用例（测试与实现同错的盲区，第五轮修正 fixture——root 无 prompt 时断言 prompt('t') 必红）**：`imageExtGen 喂 { aiTool:'grid_25', aspectRatio: 1, extConfig:{ model:'m', prompt:{ text:'t', html:'<x>' } }, style:'s' } → data 只含 aiTool+aspectRatio，无 extConfig 无 html 无 style 无 prompt`（ext 节点提示词在 extConfig 内、随整体剥离，v1 不外显）。**正文 imageGen 用例同步修正**：fixture 删 `aiTool:'grid_25'`（ext 专属，imageGen 输入不会有）、加 `aspectRatio: 1`，断言 `expect(d.aiTool).toBe('grid_25')` 改 `expect(d.aspectRatio).toBe(1)`。**nodeTypes 全覆盖测试的清单来源注意**：NODE_TYPES 常量只有 6 键（不含 videoEdit/group），权威注册表是 **CanvasView.tsx:42-51 的 nodeTypes**——覆盖测试按 CanvasView 清单写，注释同步更正（正文"NODE_TYPES 为唯一真值"表述不准，spec D8 语义不变、真值来源更正为 CanvasView nodeTypes）。

**Task 5.1 ensureParentFirst 环防护（B7 修正——互指 parentId 递归爆栈）**，照抄仓内 nodeOrder.ts:4 的 visiting 先例：

```ts
export function ensureParentFirst(nodes: RawNode[]): RawNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();  // 环守卫：A↔B 互指命中即跳过（nodeOrder.ts 同款）
  const out: RawNode[] = [];
  const visit = (n: RawNode) => {
    if (emitted.has(n.id) || visiting.has(n.id)) return;  // visiting 命中=环，跳过不爆栈
    visiting.add(n.id);
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) visit(p);                                       // 悬空 parentId：byId 未命中 → 安全跳过
    emitted.add(n.id); out.push(n);
    visiting.delete(n.id);
  };
  for (const n of nodes) visit(n);
  return out;
}
```

**Task 5.1 快照 position 兜底**：readCanvas 的 position 可为 undefined（collab-document.service.ts:70 `?.toJSON()`）——buildFilteredSnapshot 输出前加 `position: n.position ?? { x: 0, y: 0 }`。

**Task 6.1**：①新 id 生成器（第五轮简化——节点 id 是画布内作用域，同一克隆内 `seq++` 已保证唯一，跨工程同毫秒重名无影响；randomUUID 后缀与 `?? seq++` 混型防御均不必要，CLAUDE.md 简洁优先）：`const newId = () => \`vw${Date.now().toString(36)}_${seq++}\``；②**multiImageGen 的态字段是 `nodeStatus` 非 `status`**（nodeStore.ts:158 必填）——resetStatusIdle **限定到有声明了态字段的类型**（给 textInput/group 塞 status 是无害噪音，勿加）：

```ts
if (opts.resetStatusIdle) {
  if (node.type === 'multiImageGen') data.nodeStatus = 'idle';
  else if (['imageGen', 'imageExtGen', 'videoGen', 'audioGen'].includes(node.type)) data.status = 'idle';
}
```

③**已知状态登记（非 bug 勿修）**：Promise.race 超时后底层 create 仍可能跑完——CanvasProject+ProjectMember 行已建、doc 写失败留空工程，或用户看到 503 但工程实际建成了（开发期无存量数据接受，spec §4.7 已登记"create 的 DB 行先建、doc 后写"）。④ 克隆 id 断言：`JSON.stringify` 检查旧 id 时 mock 的 idMap 若实现失误返回 undefined，stringify 成 null——断言 `not.toContain('"child1"')` 仍有效，保留。

**Task 7.1**：正文所有 apiFetch 路径去 `/api`（C1-1，已机械回写）；shared 导入（第七轮归属修正）：**`import type` 是 API 侧硬约束**（纯 TS 源码包 barrel 无扩展名相对导入，Node ESM 运行时解析失败——video-project.service.ts:20 注释/admin.guard.ts:3-5）；**web 侧无此约束**（全仓 49 个文件值导入 @flowweb/shared 正常走打包器）——videoWorkApi.ts 只用类型，顺手 `import type { ... } from '@flowweb/shared'` 即可、勿当"禁令"理解。**toFlowaiUrl 不从 mediaApi 提取**（避免批次 0 的 banner 改动面）——直接复制那一行正则进 videoWorkApi.ts（YAGNI）。

**Task 7.2**：路由导入已机械回写为 `from 'react-router'`（C1-2）；EmptyState/CardGridSkeleton 替换为内联：

```tsx
{loading ? (
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-video rounded-lg bg-white/5 animate-pulse" />)}
  </div>
) : items.length === 0 ? (
  <div className="py-24 text-center text-white/40 text-sm">暂无作品</div>
) : ( ...网格... )}
```

**VideoCard 的 Link 必须带 state（M4——fromList 否则是死代码）**：

```tsx
<Link to={`/videos/${work.id}`} state={{ fromList: true }} data-card ...>
```

**Task 7.3 测试**：`from 'react-router'`；Task 10.1 的路由存在性断言不用 JSON.stringify（React element 不含组件名且可能循环引用）——**flatten 内联在本测试文件（第五轮修正：`router.admin.test.utils` 模块不存在，flatten 是 router.admin.test.tsx:19-21 的文件内局部函数且未导出——import 测试文件会连带其 vi.mock 副作用）；且 admin 子路由是相对路径（router.tsx:61-68 全是 'models'/'subscription/plans'）——匹配 `'content/video-works'` 而非 `'/admin/content/video-works'`（后者永远 false）**：

```ts
// 与 router.admin.test.tsx:19-21 同款，本文件内联（勿 import 测试文件）
const flatten = (routes: any[]): any[] =>
  routes.flatMap((r) => [r, ...(r.children ? flatten(r.children) : [])]);
expect(flatten(router.routes).some((r: any) => r.path === 'content/video-works')).toBe(true); // 相对路径
```

（router.admin.test.tsx 本身**不改**——spec §7 前端9 冻结"既有测试不改、自建断言补覆盖"。）

**Task 8.x 执行顺序调整（先叶子后外壳）**：正文顺序 8.1→8.2→8.3→8.4 会留下死占位与不可编译中间态。**按此顺序执行**：8.2 PlayView → 8.3 CarouselBar → 9.1 ProcessSnapshot → 9.2 ProcessView → **8.1 外壳（此时直接集成全部真实子组件）** → 8.4 页内登录。Task 编号不变（plan 勾选框仍按任务跟踪），仅执行序调整。**8.1 新增必做步骤（第五轮——正文只留了挂载注释，无任务承接则外壳测试找不到 modal）**：VideosPage.tsx 中 `{/* 批次 8：<VideoPlayerModal workId={activeWorkId} /> 在此挂载 */}` 注释替换为 `<VideoPlayerModal />`（组件内部自取 `useParams().id`），并删除随之无用的 `const { id: activeWorkId } = useParams();`。8.1 外壳测试装配修正（P0-4）：

```tsx
// renderAt 用真实 VideosPage（Modal 由其内部挂载，D5 单路由不重挂同时成立）
const router = createMemoryRouter([{ path: '/videos/:id?', element: <VideosPage /> }],
  { initialEntries: initial === '/videos/w1' ? [{ pathname: '/videos/w1', state }] : [initial] });
render(<AntdApp><RouterProvider router={router} /></AntdApp>);  // AntdApp 包裹（C1-3 message context）
```

**四场景补第五场景（第五轮升格为正式用例，非备注）**：`场景5 列表带 ?page=2&categoryId=x 进入 → 关闭后查询串仍在`（navigate(-1) 保留查询串；朴素 replace 会丢——这是模式 A 与 replace 的唯一可测差异）。PlayView props 与外壳对齐（onDetailRefresh 必传：外壳传 `() => fetchVideoWorkDetail(id).then(setDetail)`）。

**Task 8.2**：①message 改 `AntdApp.useApp().message`（C1-3）；②onError 测试先点「立即观看」再 fireEvent.error（idle 态无 video 元素）；③viewCount/likeCount 断言收进 `data-testid="desc-panel"`（`/10/` 会命中无关文本）；④onLike 的 `isLoggedIn()` → `const { user } = useAuth(); if (!user)`（C1-4）。

**Task 8.3**：CarouselBar 取数与筛选分离（**第五轮修正——ref 方案有洞：items 在 [settings, categoryId] 变化时才计算，轮播从 w1 切到 w2 后旧列表仍含 w2（新当前项）且不再排除 w1 → "当前作品不在轮播中"被破坏，spec §4.2/验收 #10）。改法更简单也更正确：state 存全量、渲染期派生过滤，useRef 整段不要**：

```tsx
const [all, setAll] = useState<VideoWorkListItem[]>([]);
useEffect(() => {
  if (!settings?.carouselEnabled) return;
  fetchVideoWorks({
    categoryId: settings.carouselScope === 'category' ? (categoryId ?? undefined) : undefined,
    page: 1, pageSize: 11,
  }).then(r => setAll(r.items));                    // 依赖 [settings, categoryId]——不随 currentId 重取
}, [settings, categoryId]);
const items = all.filter(w => w.id !== currentId).slice(0, 10); // 渲染期派生：恒排除当前作品
```

（**实施决定登记**：公开读取轮播设置落为 `GET /api/video-works/settings`——spec §4.2 端点表已同步补行；声明序在 `:id` 之前。）

**Task 8.4**：ConfigProvider+AntdApp 两层包住 Modal 全部内容（配方与 getPopupContainer/shellRef 细节见 C1-3 第五轮修正；data-zprovider 锚点第十一轮更正为** Provider 内层** div 并绑定 token 常量——原"壳根包裹层"位置删层不红，见正文 Task 8.1/8.4）。

**Task 9.1（B8/P1-4 定案）**：group **不走 RF 内置 group 类型**（内置渲染 null、无 Handle——断言 6≠8 必红且连组边静默消失）。自定义 GroupFrame 注册进 nodeTypes：

```tsx
function GroupFrame({ data }: any) {
  return (
    <div data-group-type={String((data as any).__groupType ?? 'normal')}
      className="w-full h-full min-h-[120px] rounded-xl border border-dashed border-white/25 bg-white/5 box-border">
      <div className="px-2 py-1 text-[11px] text-white/50">{String((data as any).__name ?? '')}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { simple: SimpleNode, group: GroupFrame };  // 覆盖内置 group（v12 允许；若覆盖后行为异常，类型名换非保留名 'vwGroup' 即可——测试断言的是 data-group-type 而非类型字符串，零测试改动）
// nodes 映射：type: n.type === 'group' ? 'group' : 'simple'（group data 注入 __groupType/__name——
// 显式映射：__groupType: n.data.groupType, __name: n.data.name。白名单字段名是 groupType，
// 不会自己变成 __groupType，漏映射则 data-group-type 恒为 'normal'、测试红）
```

（**jsdom 边界**：勿断言 `.react-flow__edge` 路径/handle bounds——test-setup 把 ResizeObserver 打成空实现、jsdom 25 无 DOMMatrix，测量路径不跑；Handle 计数 + data-group-type 结构断言 + 浏览器手工验收 #8 的分工不变。）

**Task 10.1**：①`adminFetch` 不存在——全部 `apiFetch`（**正文 16 处 admin 路径已机械回写去掉 /api**，C1-1；admin 先例 adminApi.ts:29）；②uploadCover 前端走裸 fetch multipart（C1-1 例外，**唯一带 /api 的行**）；③AdminLayout 实际只有 模型管理/会员订阅/首页配置/参数配置 四项、**无"内容管理"分组**——直接新建顶级菜单项「视频作品」（/admin/content/video-works）；④路由注册：router.tsx admin 子路由加 lazy 叶子（参照既有 admin 叶子写法，相对路径 `content/video-works`——见 Task 7.3 修正的路径匹配）。

**Task 11.2**：部署清单补一行——**packages/shared 必须同步上传**（deploy_full 覆盖、deploy_api 不覆盖；web 构建依赖工作区包解析新类型，**且服务器 `nest build` 的 tsc 也要解析 @flowweb/shared 类型——shared 不是新版会直接编译失败**，deploy.sh:53-62）。

### C3. spec 同步（**已全部完成，本节无待办——勿再按旧文执行**）

①②（第五轮）③④⑤⑥（第七轮）均已完成并经第八轮逐条复核现状（spec:24 D8 8 键真值 / §5.4:348 内联 / §7:400 已调和 13 it / §4.2:155 canClone 回流）。第八轮归一时另修复了最后残留与新增同步项：§4.6 开篇句（NODE_TYPES → CanvasView 8 键 + shared 锚定）、§4.3 allowClone→allowViewProcess 耦合校验、§5.3 error008 措辞精度、§6 轮播"当前项"矛盾、§7.6 videoEdit 保留正向断言、§5.1 Sidebar 插入位置措辞。

### C4. 已知边界登记（执行中勿当 bug 修）

- clone 超时/部分失败孤儿工程行（见 Task 6.1 ③）。
- 同一 uploads/system/ 域两种 TTL：by-key 固定 900s、作品 videoKey/coverKey 3600s+3500s 缓存——同对象双入口双有效期，登记不改。
- 限流本地永不生效（IP_WHITELIST 含 127.0.0.1/::1）——手工验收表"限流 429"仅由单测覆盖，浏览器不验。
- 候选索引 [type,status,deletedAt] 不覆盖 mimeType/JSON/createdAt 排序——数据量增长后可改 [type,status,deletedAt,createdAt]，本期接受。
- RateLimiterService 多模块各自实例化（AuthModule/VideoWorkModule 各一）——Redis 连接不同实例，无功能影响。
- **like 计数不可对账（第七轮 A1 登记）**：SET NX→DEL 非原子（并发双击可致 likeCount 与键集合瞬态漂移）+ 90 天 TTL 过期后同用户可再点赞 → likeCount 只增不减、无上界。互动量语义（D6）接受；需精确对账则改 VideoWorkLike 唯一行表 + 计数派生（后续增强）。
- **空 Y.Doc 快照 200 空白（第七轮 A6 登记）**：canvasProject DB 行在、doc 从未持久化时 readCanvas 返回空 nodes/edges → 前端渲染空画布无提示（503 超时不覆盖）。开发期无存量数据接受；如需防护加 nodes/edges 双空 → 404。
- **AuthGuard 每请求新建 PrismaClient（既有问题，第七轮登记）**：带陈旧 cookie 的游客访问 /videos 列表/详情，每次都 new PrismaClient + 会话查询 + $disconnect（auth.guard.ts:29-41）——本功能是首个公开高频入口、放大该路径；匿名快路径的"零 Redis 调用"优化会被这层吃掉。不在本期修，登记。
- **apiFetch 的 e.status 仅在 HTTP 非 2xx 时挂载（client.ts:23 vs :28）**：`json.code!==0` 的 200 分支抛错无 .status → PlayView/ProcessView 的 `e.status===401/429` 判断静默失配。当前 HttpExceptionFilter 用真实状态码、该分支不可达；若后端响应形态变化需重审。
- **D10 下架时效对封面不成立（第七轮显式化）**：videoKey（results/...）不在 by-key 白名单域 → ≤1h 失效 ✓；但 upload-cover 的封面写 uploads/system/ → 拿到 key 者可经公开 by-key 无限续期封面图（仅图片、仅封面）。接受并登记。
- **AdminVideoWorkController 单 controller 管 6 类资源（第七轮 A4 登记）**：categories/tags/candidates/works/upload-cover/settings 集中一处（spec §4.1 冻结结构、home-banner 双 controller 先例）。接受；若后续膨胀按 A4 建议拆 2-3 个 controller。
- **god service 接缝（第七轮建议登记）**：VideoWorkService ≈ 公开 7 + 后台 9 端点 + 快照构造。批次 5 定稿后若超 ~350 行，把 injectThumbnails + getProcessSnapshot + presign 收敛为 video-work-snapshot.service.ts（与 video-work-clone.service.ts 同构，不违背 D2）。

### C7. 第七轮审核修正（执行记录——已回写正文，冲突以正文为准）

> 三份并行报告（两份含 antd/rc-dialog 源码级复核）。核验排除 0 项旧版误报、采纳全部阻断+主要项：

1. **B1**：Task 0.1 SQL 表名 `subscription_banner`（schema.prisma:545 是全仓唯一 @@map；列名引号保留）+ 密码 flowweb_dev（.env 实值；"123456" 是 postgres 超级用户密码）。
2. **B2**：/videos/:id? lazy 元素补 **Suspense 边界**（AppLayout 无 Suspense、公开组现有 3 路由全静态、react-router 7 SPA 无隐式边界 → 直链首屏白屏；照抄 AdminLazy router.tsx:22-24）。
3. **B3**：buildFilteredSnapshot 补 **__ephemeral 标记过滤**（spec §4.6 字面；当前与 shadow- 前缀共生但白名单不依赖命名约定）+ 专用夹具（无前缀带标记也剥）。
4. **B4**：Task 3.3 readCanvas 断言改**无条件**（`if (collabDoc)` 条件式在实现改名/漏注入时静默变绿——spec §7.6 红线）。
5. **B5/A2**：PlayView onError 补 **retriedRef 一次性守卫**（防对象已删的 错误→重取→再错误 无限循环）+ 双 error 用例；z-index 不变量以 Task 8.1 注释"勿删 token 层"钉住（jsdom 测不出、导出常量断言亦近恒真，注释+手工验收 #6 是可执行防线）。
6. **F2**：Task 7.3 补 getPublicSettings/recordView mock + **getPublicSettings mock 为 {carouselEnabled:false}**（关轮播——否则 Modal 内 CarouselBar 二次调列表端点击垮 toHaveBeenCalledTimes(1)）；Task 8.1 场景 fixture 已含。
7. **F3**：invalidateWorkCaches 前移 **Task 2.3 就地定义**（Task 2.4 也调用——前向引用 Task 5.3 让批次 2 tsc 红）；Task 5.3 仅收敛常量。
8. **F4**（**第八轮已整体废止**）：shadow 库方案废止——本机无 flowweb_shadow 库（实测库列表仅 flowweb/flowweb_pbase/postgres/template*）且 psql 不在 PATH；正文 Task 1.1 Step 4 已改用 `migrate diff --from-schema-datasource --to-schema-datamodel --exit-code`（免 shadow，Prisma CLI 自动读 .env 并去引号）。
9. **F5**：Task 8.2 测试块补全 harness（imports/mocks/vi.hoisted AuthProvider/detail fixture/renderPlay）；修语法错（少右括号）；onError 断言改 onDetailRefresh 回调（PlayView 自身不拉详情）；viewCount 断言收进 desc-panel。Task 8.4 renderModalWithNeedLogin 改本文件内定义（跨测试文件复用局部函数不可能）。
10. **F6**：UpdateVideoWorkDto 补类体（不声明 videoKey/videoMediaId → forbidNonWhitelisted 下后台再提交即 400——"不支持换源"语义定死）。
11. **B2'/mock 名**：Task 2.1 mock 改 listAllCategories/listAllTags（controller 实际调用名——原 mock 是 TypeError）；Task 3.1 switchToHttp 改函数形态 `{ switchToHttp: () => ({ getRequest: ... }) }`（auth.guard.spec.ts:31 既有形态；对象形态 TypeError）；Task 4.1 变量名对齐既有文件 mockRedis/service。
12. **签名一次到位（架构建议①）**：Task 1.3 骨架的 service/controller 构造注入全量声明（video-project.service.ts:15 注释同款惯例）——后续任务只加方法，spec 文件 providers 从创建即完整（第六轮 4.2/6.2 两个"补 provider"补丁作废）。
13. **杂项**：公开 settings 端点自 Task 8.3 前移 Task 3.2（后端改动不留前端批次；Task 3.3 声明序断言同步）；view 去重 key 改 **ipHash**（sha256 截断 16——spec §4.5 写的就是 ipHash，Redis 不驻留明文 IP）；Task 2.2 candidates previewUrl 改走 presignWork（A5——与列表/详情/缩略图同缓存纪律，原逐行裸签名 50 次/页）；Task 0.2 导入精确化；C2 Task 2.5 文件名更正；C2 Task 7.1 import-type 归属修正（API 侧约束/web 侧自由）；C1-3"照抄先例"改为"结构照抄 + token 为本 plan 新增层（勿删）+ 有意不加 darkAlgorithm（LoginModal 全仓浅色）"；VideoCard 改用 --vw-* token（杀死变量）；C4 新增 7 条登记（A1/A6/AuthGuard PrismaClient/apiFetch status/D10 封面例外/A4/快照 service 接缝）；C6 #10 诊断修正。

### C5. web 测试装配模板（**长期有效**）+ 第五轮回写记录

第五轮的 4 项机械替换（vi.fn/react-router/apiFetch 去 /api/adminFetch 消除）与 10 处正文错误修正均已回写正文（执行时勿再动；逐项明细见 git 历史）。

**web 测试装配模板（渲染链含 useAuth 的测试文件必加——AuthProvider.tsx:25 context 默认 `null!`，裸渲染 `const { user } = useAuth()` 解构即抛）**：

```ts
// 文件顶部（ctx 用 vi.hoisted 提升——vi.mock 工厂会被 hoist 到顶层，工厂内引用外层变量必须经 vi.hoisted；
// ctx 稳定引用勿每次渲染新建对象——WorkspacePage.test.tsx:17-20 警告，防 effect 依赖触发重渲染循环）
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
// 需要登录态的用例：authCtx.user = { id: 'u1' }
// 第六轮 N8：用例改 ctx.user 后必须复位——否则同文件后跑的用例带着已登录态（假绿/误红）
beforeEach(() => { authCtx.user = null; });
// PlayView/ProcessView/VideoPlayerModal/LoginInModal 测试适用（CarouselBar 不用 useAuth 可不加）
```

message stub（组件用 AntdApp.useApp() 时）：测试树包 `<AntdApp>` 或 mock antd 四键齐全（先例 AssetPanel.test.tsx:28-29——antd context 默认值无 static 回退，裸渲染必 stub）。

**对账清单补全（批次 11 回归范围）**：正文"修改的既有文件"另含 `apps/web/src/api/adminApi.ts`（Task 10.1 追加 adminVideoWorkApi）、`apps/web/src/pages/videos/VideosPage.tsx`（Task 8.1 挂载 Modal + 删 activeWorkId 解构）、`docs/superpowers/specs/2026-09-16-video-works-design.md`（C3 settings 行 + §4.6 字段分布注记）。router.admin.test.tsx **不改**（spec §7 前端9 冻结）。

### C6. 第六轮审核修正（执行记录——已回写正文，冲突以正文为准）

> 三份并行报告核验结论：部分指控基于提交前旧版（react-router-dom 残留 / apiFetch /api 残留 / Task 2.3 三参调用——第五轮已修）；其余 14 处"勘误已改、正文仍旧"的分叉 + 3 项新发现全部属实，本轮一次性真回写：

1. **Mock 类型导入（会卡批次 2 第一个 tsc）**：Task 2.1/2.2/3.2 三个 spec 顶部补 `import type { Mock } from 'vitest'`（vitest/globals 无 Mock 类型，先例 canvas-doc-update.repository.spec.ts:2）。
2. **路由声明序断言渐进化**：Task 2.1 Step 5 占位版（引用不存在方法、findIndex=-1 必红）删除，断言移 Task 2.4 首写 :id 时落（数组仅 categories/tags/candidates；Task 2.5 += uploadCover、Task 2.6 += getSettings）；Task 3.2 的 getDetail 比较（-1 恒红）移 Task 3.3 首写 getDetail 时落。
3. **测试 DI 跟随构造注入增长**：Task 2.2 service spec providers 预置 RateLimiterService/CollabDocumentService mock（否则 4.2/5.3 一加注入整文件编译红）；Task 4.2 controller spec 补 RateLimiterService provider + recordView 用例；Task 6.2 补 VideoWorkCloneService provider + 登录/未登录两用例。
4. **Task 4.3 findUnique 序列化 mock**：$executeRaw 是 mock 不真改库，findUnique 两次调用须 mockResolvedValueOnce 链式给值（首次 status / 回读 likeCount），否则返回值断言必红；删除空体占位用例（恒绿假覆盖）。
5. **Task 3.3 匿名断言**：正文旧版 `not.toHaveBeenCalled()`（presignWork 的 URL 缓存也 redis.get，必红）换 C2 收窄版（只断言无 videoWork:like: 前缀 key）。
6. **Task 5.1 正文实现三处**：WHITELIST 换 C2 定稿表（imageGen 去 aiTool 加 aspectRatio / imageExtGen ['prompt','aspectRatio','aiTool']）、ensureParentFirst 补 visiting 环守卫（nodeOrder.ts 同款）、applyWhitelist resetStatusIdle 类型感知（multiImageGen→nodeStatus；限定 imageGen/imageExtGen/videoGen/audioGen）；头注释真值来源更正为 CanvasView nodeTypes。
7. **Task 6.1 四处测试取参**：clone() 只返回 { projectId }——四条用例改经 `projectService.create.mock.calls[0][2]/[3]` 取 nodes/edges（旧解构是 TS2339 + undefined.find）。
8. **Task 7.3**：VideosPageStub（全文未定义，TS2304/ReferenceError）→ import 真实 VideosPage（本任务无 Modal 断言照样成立，批次 8 挂载后回归保持绿）。
9. **Task 8.1**：壳根 div `relative h-full w-full` → **`fixed inset-0`**（VideoEditorShell.tsx:132 同款——BaseFullscreenModal 的 dialog 包装无尺寸类，百分比高度在 auto 父级解析为 auto，壳内容塌 0 高度；jsdom 无布局测不出、手工验收 #3 才暴露）；renderAt 换真实 VideosPage；四场景改点真实卡片（VideoCard Link 自带 state）+ fixture 补 w2 + **场景5（?page=2&categoryId=x 关闭后查询串保留）升格正式用例**；补 AuthProvider/getPublicSettings/recordView mock。
10. **Task 8.2/8.3/8.4**：PlayView 简介浮层加 `data-testid="desc-panel"`；onError 用例先点「立即观看」（idle 态无 video 元素）；CarouselBar 测试补 renderBar helper（显式 mock getPublicSettings——漏 mock 时 auto-mock 返回 undefined → `getPublicSettings().then` 是**同步 TypeError**（.catch 接不到同步 throw），用例以 unhandled error 变红；第七轮修正诊断——原写".catch 兜成 enabled:true"的机制不成立，按错误方向排查会绕路）+ 点击切换用例落地；Task 8.4 login-modal-root 由 mock LoginModal 提供（真实组件无此 testid）+ **Esc 守卫真用例**（捕获壳 onClose → 断言只关登录层、播放 Modal 仍在——守卫此前无测试）。
11. **Task 9.1/9.2/10.1/10.2**：ProcessSnapshot 正文换 GroupFrame 定案（含 __groupType/__name 显式映射 + 双 Handle；删恒真的 `[dangerouslysetinnerhtml]` querySelector 断言）；ProcessView 三处 render 补必填 onNeedLogin + 未登录克隆用例落地；Task 10.1 Files 行更正（顶级菜单项，非"内容管理区"）+ JSON.stringify 断言换内联 flatten + 相对路径 + 表格列/ModalForm 用例落地；Task 10.2 三条空壳用例落地。
12. **杂项**：Task 1.3 矛盾注释段删除（代码已 import 克隆空壳）；Task 2.1 controller 正文补类级 @UsePipes；Task 2.3 DTO 正文 @IsEnum→@IsIn；C1-3 补两层各自作用（getPopupContainer 常规路径 / token 首帧兜底路径）与 Esc 真实机制（rc-dialog onWrapperKeyDown 挂 dialog 节点 + stopPropagation——守卫承重场景是"焦点不在登录框内"）；C1-4 引用路径更正（admin-home-banner.controller.ts:39-66）；C3 补 §4.6 注记记录；C5 AuthProvider 模板改 vi.hoisted + beforeEach 复位。

---

---

## 文件结构总览

```
apps/api/src/modules/video-work/
├── video-work.module.ts                  # Task 1.3
├── video-work.service.ts                 # CRUD+公开查询+计数+快照构造（Task 2.3/2.4/3.2/3.3/4.2/4.3/5.3）
├── video-work.controller.ts              # 公开 @Controller('api/video-works')（Task 3.x/4.x/5.3/6.2）
├── admin-video-work.controller.ts        # @Controller('api/admin/video-works')（Task 2.x）
├── video-work-clone.service.ts           # 克隆编排（Task 6.1）
├── snapshot-filter.util.ts               # 快照/克隆共用白名单纯函数（Task 5.1）
├── dto/create-video-work.dto.ts          # Task 2.3
├── dto/update-video-work.dto.ts          # Task 2.3
├── dto/video-category.dto.ts             # Task 2.1
├── dto/video-tag.dto.ts                  # Task 2.1
├── dto/update-video-work-settings.dto.ts # Task 2.6
├── video-work.service.spec.ts
├── video-work.controller.spec.ts
├── admin-video-work.controller.spec.ts
├── video-work-clone.service.spec.ts
└── snapshot-filter.util.spec.ts

packages/shared/src/types/video-work.ts   # 前后端共享响应类型（Task 1.2）

apps/web/src/
├── api/videoWorkApi.ts                   # Task 7.1
├── pages/videos/
│   ├── VideosPage.tsx                    # 列表（Task 7.2）
│   ├── VideoCard.tsx                     # 卡片（Task 7.2）
│   ├── VideoPlayerModal.tsx              # 播放 Modal（Task 8.1/8.2）
│   ├── CarouselBar.tsx                   # 底部轮播（Task 8.3）
│   ├── ProcessSnapshot.tsx               # 只读画布（Task 9.1）
│   ├── ProcessView.tsx                   # 创作过程视图（Task 9.2）
│   └── __tests__/*.test.tsx
├── pages/admin/pages/VideoWorksPage.tsx  # 后台管理（Task 10.1/10.2）
├── pages/canvas/components/nodeTypes.coverage.test.tsx # Task 9.3（shared 锚定；与 CanvasView.test.tsx 同级）
├── pages/canvas/components/CanvasView.tsx  # Task 9.3 导出 nodeTypes（仅加 export 一词）
├── router.tsx / components/layout/Sidebar.tsx / index.css   # Task 7.3 修改

修改的既有文件（对账清单，与 spec §4.1 一致）：
- apps/api/src/modules/media/media.service.ts + media.controller.ts（批次 0）
- apps/api/src/common/services/rate-limiter.service.ts + .spec.ts（Task 4.1）
- apps/api/src/auth/auth.guard.ts（Task 3.1，+1 行）
- apps/api/src/app.module.ts（Task 1.3）
- apps/api/prisma/schema.prisma（Task 1.1）
- apps/web/src/router.tsx / Sidebar.tsx / index.css（Task 7.3；router.tsx 另有 Task 10.1 admin lazy 叶子——第十一轮补 Files 漏项）
- apps/web/src/api/adminApi.ts（Task 10.1 追加 adminVideoWorkApi）
- apps/web/src/pages/admin/AdminLayout.tsx（Task 10.1 新建顶级菜单项「视频作品」——第十一轮补对账漏项）
- apps/web/src/pages/videos/VideosPage.tsx（Task 8.1 挂载 Modal + 删 activeWorkId 解构）
- apps/api/src/auth/auth.guard.spec.ts（Task 3.1 追加 /api/video-works 前缀放行用例——guard 本体仅 +1 行）
- packages/shared/src/index.ts（Task 1.2 barrel）/ apps/web/src/pages/canvas/components/CanvasView.tsx（Task 9.3 导出 nodeTypes）
- docs/superpowers/specs/2026-09-16-video-works-design.md（第八轮归一同步）
```

---

## 批次 0：by-key 兑换口修复（D17，D10 前提）

### Task 0.1: 运行时数据核查（SubscriptionBanner.backgroundImageKey）

**Files:** 无代码改动；产出核查记录（写入本 plan 的执行记录或 PR 描述）。

- [x] **Step 1: 查询存量 key**（第八轮：本机 psql 不在 PATH——改用 api 依赖里的 pg 直查，在 apps/api 目录下执行（命令自带 cd）；连接串实测可连）

```bash
cd apps/api && node -e "const {Client}=require('pg');const c=new Client({connectionString:'postgresql://flowweb:flowweb_dev@localhost:5432/flowweb'});c.connect().then(()=>c.query('SELECT id, \"backgroundImageKey\" FROM subscription_banner WHERE \"backgroundImageKey\" IS NOT NULL')).then(r=>{console.log(JSON.stringify(r.rows,null,2));process.exit(0)}).catch(e=>{console.error('ERR',e.message);process.exit(1)})"
```

（表名 `subscription_banner`——schema.prisma:545 是全仓唯一 `@@map("subscription_banner")`，查 "SubscriptionBanner" 直接 relation does not exist；列名引号保留。密码 flowweb_dev——.env `DATABASE_URL` 用的是该值，"123456" 是 postgres 超级用户密码。pg@^8.22.0 在 apps/api dependencies。）

Expected: 列出所有非空 key。

- [x] **Step 2: 逐个比对前缀**

规则：每个 key 必须 `startsWith('uploads/system/')`。全部符合 → 记录"核查通过"。
若有不符合（如 `uploads/banner-bg.png`）：在 admin 后台重新上传封面覆盖该值（走 admin-banner 上传端点会自动生成规范 key），或在本 plan 执行记录中登记"已知视觉回退"并知会用户——登记时注明 VipSubscribeModal 有 backgroundImageKey→backgroundImageUrl→渐变 三级 fallback（VipSubscribeModal.tsx:152-189），不规范 key 仅退次选图、不会裂（第八轮放松措辞）。

- [x] **Step 3: 无需提交（纯核查），记录结果供批次 0 验收引用**

### Task 0.2: MediaService.getPresignedUrlByKey（TDD）

**Files:**
- Modify: `apps/api/src/modules/media/media.service.ts`
- Test: `apps/api/src/modules/media/media.service.spec.ts`（已存在，追加用例）

- [x] **Step 1: 写失败测试（追加到 media.service.spec.ts）**

```ts
describe('getPresignedUrlByKey', () => {
  it('uploads/system/ 前缀放行并 presign 同一个规范化值', async () => {
    const key = 'uploads/system/2026-01-01/abc.png';
    minio.generatePresignedGetUrl = vi.fn().mockResolvedValue('http://minio/url'); // 第八轮：既有替身变量是裸 minio（media.service.spec.ts:10），非 service['minio']
    const url = await service.getPresignedUrlByKey(`  ${key}  `); // 带空白验证 trim
    expect(url).toBe('http://minio/url');
    expect(minio.generatePresignedGetUrl).toHaveBeenCalledWith(key, 900); // 签名用 trim 后的同一值
  });

  it('非 system 前缀一律 403（含登录场景语义，方法级不区分）', async () => {
    await expect(service.getPresignedUrlByKey('uploads/user1/a.png')).rejects.toThrow(ForbiddenException);
    await expect(service.getPresignedUrlByKey('results/user1/p/n/x.mp4')).rejects.toThrow(ForbiddenException);
  });

  it('尾斜杠边界：uploads/systematic-x 不放行', async () => {
    await expect(service.getPresignedUrlByKey('uploads/systematic-x/evil.png')).rejects.toThrow(ForbiddenException);
  });

  it('空 key 拒绝', async () => {
    await expect(service.getPresignedUrlByKey('   ')).rejects.toThrow(BadRequestException);
  });
});
```

注意：mock 装配沿用该 spec 文件既有替身——变量名是 `service`/`prisma`/`minio`/`redis`（media.service.spec.ts:8-12；minio 是裸 `let minio: any` 变量、不是 service 属性——第八轮对齐，原写 `mediaService['minio']` 是 TS2304 编译红）。**导入精确化（第七轮）**：spec 文件已导入 ForbiddenException/NotFoundException（media.service.spec.ts:6）——只补 `BadRequestException`；**media.service.ts:1 现只有 NotFoundException**——实现侧需同时补 `ForbiddenException, BadRequestException` 两个。

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- media.service.spec`
Expected: FAIL（getPresignedUrlByKey 不存在，TS 编译错误即红）

- [x] **Step 3: 实现（media.service.ts 追加方法）**

```ts
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'; // 顶部改导入——media.service.ts:1 现只有 NotFoundException，Forbidden/BadRequest 均新增

/** 公开 by-key 兑换（唯一合法域：运营公开素材 uploads/system/）。
 *  仅 trim 规范化（禁止二次解码——Express 已解码一次，再解 %2F..%2F 会绕过前缀），
 *  校验与签名必须用同一个 normalized 值。其余 key 一律 403（正路是 GET /api/media/:fileId/url）。 */
async getPresignedUrlByKey(rawKey: string): Promise<string> {
  const key = (rawKey ?? '').trim();
  if (!key) throw new BadRequestException('key is required');
  if (!key.startsWith('uploads/system/')) throw new ForbiddenException();
  return this.minio.generatePresignedGetUrl(key, 900);
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api test -- media.service.spec`
Expected: PASS 全绿

- [x] **Step 5: Commit**

```bash
git add apps/api/src/modules/media/media.service.ts apps/api/src/modules/media/media.service.spec.ts
git commit -m "feat(video-work): 批次0 MediaService.getPresignedUrlByKey——by-key 收窄为 uploads/system/ 前缀放行"
```

### Task 0.3: controller 改调 service（消除绕过 service 层）

**Files:**
- Modify: `apps/api/src/modules/media/media.controller.ts:23-28`（getUrlByKey 方法）

- [x] **Step 1: 修改 controller（该文件无既有 controller spec，行为已由 Task 0.2 service 用例覆盖）**

```ts
@Get('by-key')
async getUrlByKey(@Query('key') key: string) {
  const url = await this.mediaService.getPresignedUrlByKey(key); // 校验下沉 service，controller 变薄
  return { url };
}
```

同时删除该方法内原有的 `if (!key) throw new BadRequestException(...)`（service 已做）与对 `this.minioService` 的直接调用。**已核验（第五轮）**：minioService 在该 controller 其余方法零使用、`BadRequestException` 的唯一使用点就是被删的 :25 行——**MinioService 的 import+注入、BadRequestException 的 import 一并删除**（media.controller.ts:1-15），不留未用导入。

- [x] **Step 2: 全量 api 测试**

Run: `pnpm --filter @flowweb/api test`
Expected: PASS（含既有全部用例）

- [x] **Step 3: 手工端到端验收（批次 0 验收项）**

本地起 api + web 后，浏览器**未登录**打开 `http://localhost:5173/` → 打开会员订阅弹窗 → banner 正常显示图片（非默认渐变）；DevTools Network 中 `/api/media/by-key` 请求返回 200。
再手工验证反例：`curl "http://localhost:3000/api/media/by-key?key=results/user1/a.mp4"` → 403。

- [x] **Step 4: Commit**

```bash
git add apps/api/src/modules/media/media.controller.ts
git commit -m "feat(video-work): 批次0 by-key controller 改调 service（校验下沉，D17）"
```

> **批次 0 执行记录（2026-09-16）**：Task 0.1 核查通过——subscription_banner 共 1 行、backgroundImageKey 非空 **0 行**，零存量 key 需比对前缀，无需重传覆盖/登记视觉回退（key 为 NULL 时 VipSubscribeModal 走 backgroundImageUrl→渐变 三级 fallback 正常路径）。Task 0.2/0.3 提交 be26f44b + 97fde83b（+质量审查补 undefined 用例 ff569af3）；spec 合规审查 ✅、代码质量审查 ✅ Ready to merge。端到端 curl 实测：`key=uploads/system/2026-01-01/test.png` → 200、`key=results/user1/a.mp4` → **403（修复前实测 200）**；浏览器 banner 验收因零存量非空 key 无验证对象（必走 fallback），由 curl 端点验收覆盖。api 全量 998 tests + media.service.spec 12 tests 全绿。

---

## 批次 1：Schema + Shared 类型 + 模块骨架

### Task 1.1: Prisma schema 四张表 + Media 候选索引 + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（文件末尾追加模型；Media model 内追加索引）

- [x] **Step 1: 追加 4 个 model（schema.prisma 末尾）**

```prisma
enum VideoWorkStatus {
  DRAFT
  PUBLISHED
}

model VideoWork {
  id               String          @id @default(cuid())
  title            String          @db.VarChar(200)
  description      String?         @db.Text
  authorName       String          @db.VarChar(64)
  categoryId       String?
  category         VideoCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  videoKey         String          @db.VarChar(512)
  videoMediaId     String?
  coverKey         String?         @db.VarChar(512)
  canvasProjectId  String?

  durationSec      Int?
  width            Int?
  height           Int?

  viewCount        Int             @default(0)
  likeCount        Int             @default(0)
  tags             String[]        @default([])
  sortOrder        Int             @default(0)
  status           VideoWorkStatus @default(DRAFT)
  allowViewProcess Boolean         @default(false)
  allowClone       Boolean         @default(false)
  publishedAt      DateTime?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([status, sortOrder, publishedAt(sort: Desc)])
  @@index([categoryId, status])
}

model VideoCategory {
  id        String      @id @default(cuid())
  name      String      @db.VarChar(64) @unique
  sortOrder Int         @default(0)
  active    Boolean     @default(true)
  works     VideoWork[]
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([active, sortOrder])
}

model VideoTag {
  id        String   @id @default(cuid())
  name      String   @db.VarChar(32) @unique
  sortOrder Int      @default(0)
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([active, sortOrder])
}

model VideoWorkSetting {
  id              String   @id @default("singleton")
  carouselEnabled Boolean  @default(true)
  carouselScope   String   @default("all")
  updatedAt       DateTime @updatedAt
}
```

- [x] **Step 2: Media model 追加候选索引（声明式，保 migrate diff 零差异）**

在 `model Media` 的现有 `@@index` 行旁追加：

```prisma
  @@index([type, status, deletedAt])
```

- [x] **Step 3: 生成 migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --name add_video_work
```

Expected: 生成新 migration 目录（本地时间戳前缀，含 **4 张表 + 1 enum** 的 DDL + Media 候选索引）；`prisma generate` 自动执行。
**红线**：migrate dev 若检测 drift 提示 reset，一律拒绝（选 No/中止）——开发库有真实数据；drift 处置另行人工判断。（shadow 库由 Prisma 自动创建；.env 无 shadowDatabaseUrl，既有迁移此前均 migrate dev 生成，CREATEDB 路径已验证可用。）

- [x] **Step 4: 验证 diff 零差异（第八轮改法：免 shadow 库——直接拿真实库比 schema）**

```bash
cd apps/api
# Prisma CLI 自动加载 ./.env（dotenv 去引号），--from-schema-datasource 读 DATABASE_URL 连真实库
pnpm exec prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --exit-code
echo "exit=$?"   # 0 = 零差异；2 = 有差异（schema 与迁移/库不一致，必须修复后重跑）；1 = 命令用法错误
pnpm exec prisma migrate status   # 全部 applied、无 pending（含 add_video_work）
```

（原 shadow-database-url 方案废止：本机无 flowweb_shadow 库，且 .env 的 DATABASE_URL **带双引号**——旧命令的 `sed 's/flowweb$/'` 因行尾是 `"` 不匹配，会把带引号的原库 URL 传给 --shadow-database-url（重置风险），`|| echo` 再把失败伪装成成功。）
**口径登记（第九轮）**：`--from-schema-datasource` 验的是"库 == schema"，不含"migrations 能重放出该 schema"（后者才是生产 migrate deploy 的路径）——与 spec §8"migrate deploy 后 diff 零差异"验收口径一致，接受；若将来要同时守住可重放性，补一条 createdb flowweb_shadow 后的 `--from-migrations` 断言（需 shadow 库，本期不做）。

- [x] **Step 5: 全量测试 + Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(video-work): 批次1 schema——VideoWork/VideoCategory/VideoTag/VideoWorkSetting 四表 + Media 候选索引"
```

### Task 1.2: Shared 响应类型

**Files:**
- Create: `packages/shared/src/types/video-work.ts`
- Modify: `packages/shared/src/index.ts`（barrel 追加 1 行）

- [x] **Step 1: 写类型文件（纯类型无测试对象，编译即验证）**

```ts
/** 视频作品展示（spec 2026-09-16 §4.2 契约） */

export interface VideoWorkListItem {
  id: string;
  title: string;
  coverUrl: string | null;
  durationSec: number | null;
  tags: string[];
}

export interface VideoWorkDetail extends VideoWorkListItem {
  videoUrl: string;
  categoryId: string | null;
  viewCount: number;
  likeCount: number;
  liked: boolean;
  description: string | null;
  authorName: string;
  publishedAt: string | null; // PUBLISHED 恒非空；UI 依赖服务端保证，勿用 ! 断言
  width: number | null;
  height: number | null;
  canViewProcess: boolean;
  canClone: boolean;
}

export interface VideoWorkListResult {
  items: VideoWorkListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VideoCategoryItem {
  id: string;
  name: string;
  sortOrder: number;
}

export type CarouselScope = 'all' | 'category';

export interface VideoWorkSettings {
  carouselEnabled: boolean;
  carouselScope: CarouselScope;
}

/** 创作过程快照（§4.6）——data 为白名单后字段，未知类型仅结构字段 */
export interface SnapshotNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
}

export interface ProcessSnapshotData {
  workId: string;
  title: string;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export interface CandidateMedia {
  id: string;
  key: string;
  projectId: string | null;
  canvasExists: boolean;
  thumbnailKey: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  previewUrl: string | null;
}

/** 快照白名单的跨端锚定清单（第八轮裁定，spec §4.6 实现注记）：
 *  真值仍是 CanvasView.tsx:42-51 的 nodeTypes 注册表（8 键）——本常量是两侧测试的锚：
 *  api 断言 WHITELIST 键 ⊇ 本清单（Task 5.1）、web 断言 CanvasView nodeTypes 键 ⊆ 本清单（Task 9.3）。
 *  CanvasView 新增节点类型而清单未同步时任一侧测试红——替代"人工同步 + 自指测试"防线。 */
export const VIDEO_WORK_NODE_TYPES = [
  'imageGen', 'imageExtGen', 'textInput', 'videoGen', 'audioGen', 'multiImageGen', 'videoEdit', 'group',
] as const;
```

- [x] **Step 2: barrel 追加导出（packages/shared/src/index.ts）**

```ts
export * from './types/video-work';
```

- [x] **Step 3: 验证编译并提交**

```bash
pnpm --filter @flowweb/shared build 2>/dev/null || cd packages/shared && pnpm exec tsc --noEmit
git add packages/shared/src/types/video-work.ts packages/shared/src/index.ts
git commit -m "feat(video-work): 批次1 shared 响应类型"
```

### Task 1.3: 模块骨架 + app.module 注册

**Files:**
- Create: `apps/api/src/modules/video-work/video-work.module.ts`
- Create: `apps/api/src/modules/video-work/video-work.service.ts`（空壳）
- Create: `apps/api/src/modules/video-work/video-work.controller.ts`（空壳）
- Create: `apps/api/src/modules/video-work/admin-video-work.controller.ts`（空壳）
- Create: `apps/api/src/modules/video-work/video-work-clone.service.ts`（空壳类，与骨架同建——第八轮补进 Files，原只在 C2 散文）
- Modify: `apps/api/src/app.module.ts`（imports 数组 + VideoWorkModule）

- [x] **Step 1: 创建空壳文件**

```ts
// video-work.module.ts
import { Module } from '@nestjs/common';
import { VideoWorkController } from './video-work.controller';
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service'; // Task 1.3 先建空壳类，providers 全量列出（C2）
import { ProjectModule } from '../project/project.module';
import { CollabModule } from '../collab/collab.module';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import Redis from 'ioredis';
// PrismaService/MinioService 是 @Global（prisma.module.ts:4 / minio.module.ts:5）——service 构造注入即可，module 无需 import/providers（勿写未用导入）

@Module({
  imports: [ProjectModule, CollabModule],
  controllers: [VideoWorkController, AdminVideoWorkController],
  providers: [
    VideoWorkService,
    VideoWorkCloneService,   // 空壳，Task 6.1 填充
    RateLimiterService,      // 类形式直接 provide（auth.module.ts:13-20 先例），构造注入同模块 'REDIS_CLIENT' token
    { provide: 'REDIS_CLIENT', useFactory: () => new Redis(process.env.REDIS_URL || 'redis://localhost:6379/0'), inject: [] }, // env 兜底，勿裸 new Redis(undefined)（C2 Task 1.3）
  ],
})
export class VideoWorkModule {}
```

注意：克隆服务空壳类 `video-work-clone.service.ts` 与骨架同建（上方 import + providers 已全量列出，无中间态）；REDIS_CLIENT 提供模式**已核验定案**（AppModule 级 REDIS_CLIENT 是私有 provider、功能模块拿不到——自备 `{ provide: 'REDIS_CLIENT', useFactory: ... }`，先例 media.module.ts / auth.module.ts:13-20），无需再 grep。

```ts
// video-work.service.ts（空壳，构造签名一次到位——第七轮：video-project.service.ts:15 注释同款惯例
// "签名一次到位，避免 Task N 中途改构造器"。后续任务只加方法、不动构造/providers，
// spec 文件从创建起就 provide 全部依赖、永不需要二次编辑）
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MinioService } from '../minio/minio.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import Redis from 'ioredis';

@Injectable()
export class VideoWorkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,             // @Global
    @Inject(MinioService) private readonly minio: MinioService,                 // @Global（presign，无删除能力——删除红线）
    @Inject('REDIS_CLIENT') private readonly redis: Redis,                      // Task 2.1 缓存/3.3 liked/4.x 计数
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService, // Task 4.2 view 限流
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService, // Task 5.3 快照 readCanvas（详情端点禁用）
  ) {}
  // Task 2.x/3.x/4.x/5.3 逐步填充方法
}
```

```ts
// video-work.controller.ts（空壳，签名一次到位——rateLimiter 供 Task 4.2 getClientIp、cloneService 供 Task 6.2）
import { Controller, Inject } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

@Controller('api/video-works')
export class VideoWorkController {
  constructor(
    @Inject(VideoWorkService) private readonly service: VideoWorkService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(VideoWorkCloneService) private readonly cloneService: VideoWorkCloneService, // Task 6.1 前是空壳类，可注入
  ) {}
  // Task 3.x/4.x/5.3/6.2 逐步填充方法
}
```

```ts
// admin-video-work.controller.ts（空壳）
import { Controller, Inject } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';

@Controller('api/admin/video-works')
export class AdminVideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}
  // Task 2.x 逐步填充方法
}
```

- [x] **Step 2: app.module.ts imports 数组追加 `VideoWorkModule`**（找到既有 modules import 列表，按字母序或文件尾惯例插入 + 顶部 import）

- [x] **Step 3: 验证 api 可启动 + 全量测试**

```bash
pnpm --filter @flowweb/api test
```

Expected: 编译通过、全部既有用例 PASS。

- [x] **Step 4: Commit**

```bash
git add apps/api/src/modules/video-work/ apps/api/src/app.module.ts
git commit -m "feat(video-work): 批次1 模块骨架（双 controller 空壳 + module 注册）"
```

> **批次 1 执行记录（2026-09-16）**：Task 1.1 提交 92f0ec33——migration `20260915212910_add_video_work`（enum+4 表+Media_type_status_deletedAt_idx+FK SetNull），migrate dev 无 drift，diff 零差异 exit=0、17 migrations 全 applied；Task 1.2 提交 cb732693——shared 类型照抄 plan，tsc 零错误；Task 1.3 提交 4cd98e03——五文件骨架照抄，app.module 注册于 VideoProjectModule 后。验证：api 全量 **999 tests** 全绿（= 998 基线 + 批次 0 补的 undefined 用例）、`nest build` + `node dist/main.js` 启动日志确认 VideoWorkModule DI 链与双 controller 路由装配、常驻 dev 实例热重载后 health 200。spec 合规审查 ✅（审查者独立复验库状态+启动）、代码质量审查 ✅ Ready to merge（3 Minor 均冻结设计/量级可忽略：inject:[] 冗余为 plan 逐字、categoryId 排序索引量级不扩、carouselScope DB 无约束由 DTO 校验兜底）。环境注记：prisma generate 因常驻 dev server 锁 query_engine dll 报 EPERM——TS 客户端已完整生成、引擎版本未变无影响；**未来升级 Prisma 版本前必须先停 dev server 再 generate**。

---

## 批次 2：Admin API（类型/标签/候选/作品 CRUD/封面上传/设置）

### Task 2.1: VideoCategory + VideoTag CRUD（TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/dto/video-category.dto.ts`、`dto/video-tag.dto.ts`
- Modify: `video-work.service.ts`（追加 category/tag CRUD 方法）
- Modify: `admin-video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/admin-video-work.controller.spec.ts`

- [x] **Step 1: 写失败测试（admin-video-work.controller.spec.ts 新建）**

```ts
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 必须显式导入——vitest/globals 只声明运行时全局、无 Mock 类型（先例 canvas-doc-update.repository.spec.ts:2）
import { BadRequestException } from '@nestjs/common'; // 第十轮（C1-5）：Task 2.5 缺文件用例 toThrow 用
import { AdminVideoWorkController } from './admin-video-work.controller';
import { VideoWorkService } from './video-work.service';

describe('AdminVideoWorkController categories/tags', () => {
  let controller: AdminVideoWorkController;
  // 第八轮：Record<string, Mock>——原窄注解还是旧方法名（listCategories/listTags），与下方赋值（listAllCategories/listAllTags）
  // 是 TS2741+TS2353；且 Task 2.4/2.5/2.6 补方法时窄注解需逐任务 lockstep。Record 让后续任务直接加 vi.fn() 行即可。
  let service: Record<string, Mock>;

  beforeEach(async () => {
    service = {
      // 第七轮：方法名必须与 controller 实际调用一致——controller 是 listAllCategories()/listAllTags()
      // （admin 端返回全部含 inactive），mock 写 listCategories/listTags 是 TypeError（B1）
      listAllCategories: vi.fn().mockResolvedValue([]),
      createCategory: vi.fn().mockResolvedValue({ id: 'c1' }),
      updateCategory: vi.fn().mockResolvedValue({ id: 'c1' }),
      deleteCategory: vi.fn().mockResolvedValue(undefined),
      listAllTags: vi.fn().mockResolvedValue([]),
      createTag: vi.fn().mockResolvedValue({ id: 't1' }),
      updateTag: vi.fn().mockResolvedValue({ id: 't1' }),
      deleteTag: vi.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminVideoWorkController],
      providers: [{ provide: VideoWorkService, useValue: service }],
    }).compile();
    controller = moduleRef.get(AdminVideoWorkController);
  });

  it('GET categories 调 service.listAllCategories', async () => {
    await controller.listCategories();
    expect(service.listAllCategories).toHaveBeenCalled();
  });

  it('POST categories 传 DTO 给 service', async () => {
    await controller.createCategory({ name: 'AI真人影视', sortOrder: 0, active: true });
    expect(service.createCategory).toHaveBeenCalledWith({ name: 'AI真人影视', sortOrder: 0, active: true });
  });

  it('PUT categories/:id 与 DELETE categories/:id 透传', async () => {
    await controller.updateCategory('c1', { name: 'MV' });
    await controller.deleteCategory('c1');
    expect(service.updateCategory).toHaveBeenCalledWith('c1', { name: 'MV' });
    expect(service.deleteCategory).toHaveBeenCalledWith('c1');
  });

  it('tags 同构透传', async () => {
    await controller.listTags();
    await controller.createTag({ name: '悬疑', sortOrder: 0, active: true });
    await controller.updateTag('t1', { active: false });
    await controller.deleteTag('t1');
    expect(service.listAllTags).toHaveBeenCalled();
    expect(service.createTag).toHaveBeenCalledWith({ name: '悬疑', sortOrder: 0, active: true });
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- admin-video-work.controller.spec`
Expected: FAIL（controller 方法不存在）

- [x] **Step 3: 写 DTO + service 方法 + controller**

```ts
// dto/video-category.dto.ts
import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoCategoryDto {
  @IsString() @MaxLength(64) name: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoCategoryDto {
  @IsOptional() @IsString() @MaxLength(64) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

```ts
// dto/video-tag.dto.ts（同构，name MaxLength(32)）
import { IsString, IsInt, IsBoolean, IsOptional, MaxLength } from 'class-validator';

export class CreateVideoTagDto {
  @IsString() @MaxLength(32) name: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateVideoTagDto {
  @IsOptional() @IsString() @MaxLength(32) name?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

video-work.service.ts 追加（注入 PrismaService——module providers 补 `PrismaService` 或用既有全局注入模式，与 home-banner.service 一致）：

```ts
// —— 类型（改类型/标签后删缓存，spec §4.2 categories 缓存失效） ——
private static readonly CATEGORY_CACHE_KEY = 'videoWork:categories';

//（第十一轮：删孤儿 listCategories()——公开端走 listCategoriesPublic（Task 3.2）、admin 端走 listAllCategories，全 plan 无第三调用者）
async listAllCategories() {
  return this.prisma.videoCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}
async createCategory(dto: { name: string; sortOrder?: number; active?: boolean }) {
  const row = await this.prisma.videoCategory.create({ data: dto });
  await this.invalidateCategoryCache();
  return row;
}
async updateCategory(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
  const row = await this.prisma.videoCategory.update({ where: { id }, data: dto });
  await this.invalidateCategoryCache();
  return row;
}
async deleteCategory(id: string) {
  await this.prisma.videoCategory.delete({ where: { id } }); // 作品侧 categoryId onDelete: SetNull
  await this.invalidateCategoryCache();
}

// —— 标签池（仅录入建议，删池不清洗作品 tags，spec §3.2） ——
async listAllTags() {
  return this.prisma.videoTag.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}
async createTag(dto: { name: string; sortOrder?: number; active?: boolean }) {
  return this.prisma.videoTag.create({ data: dto });
}
async updateTag(id: string, dto: { name?: string; sortOrder?: number; active?: boolean }) {
  return this.prisma.videoTag.update({ where: { id }, data: dto });
}
async deleteTag(id: string) {
  await this.prisma.videoTag.delete({ where: { id } });
}

private async invalidateCategoryCache() {
  await this.redis.del(VideoWorkService.CATEGORY_CACHE_KEY);
}
```

admin-video-work.controller.ts（**静态段路由必须在 `:id` 之前声明**——spec 红线；本 controller 的参数路由只有作品 `:id`，categories/tags 全静态段无冲突，但作品路由声明在文件末尾）：

```ts
import { Controller, Get, Post, Put, Delete, Body, Param, Inject, UsePipes, ValidationPipe } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { CreateVideoCategoryDto, UpdateVideoCategoryDto } from './dto/video-category.dto';
import { CreateVideoTagDto, UpdateVideoTagDto } from './dto/video-tag.dto';

@Controller('api/admin/video-works')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) // 类级挂载（C2 Task 2.1——仓库无全局 pipe，不挂则 {...dto} 把 publishedAt 等任意字段透传进 Prisma；先例 admin-home-banner.controller.ts:12）
export class AdminVideoWorkController {
  constructor(@Inject(VideoWorkService) private readonly service: VideoWorkService) {}

  // ==== 静态段子资源（声明在作品 :id 路由之前） ====
  @Get('categories') listCategories() { return this.service.listAllCategories(); }
  @Post('categories') createCategory(@Body() dto: CreateVideoCategoryDto) { return this.service.createCategory(dto); }
  @Put('categories/:id') updateCategory(@Param('id') id: string, @Body() dto: UpdateVideoCategoryDto) { return this.service.updateCategory(id, dto); }
  @Delete('categories/:id') deleteCategory(@Param('id') id: string) { return this.service.deleteCategory(id); }

  @Get('tags') listTags() { return this.service.listAllTags(); }
  @Post('tags') createTag(@Body() dto: CreateVideoTagDto) { return this.service.createTag(dto); }
  @Put('tags/:id') updateTag(@Param('id') id: string, @Body() dto: UpdateVideoTagDto) { return this.service.updateTag(id, dto); }
  @Delete('tags/:id') deleteTag(@Param('id') id: string) { return this.service.deleteTag(id); }

  // Task 2.2+ 追加：candidates / upload-cover / settings / 作品 :id CRUD（声明在全部静态段之后）
}
```

注意：admin 端 listCategories 返回**全部**（含 inactive，管理用）；公开端（Task 3.2）才过滤 active + 走缓存。

- [x] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @flowweb/api test -- admin-video-work.controller.spec`
Expected: PASS

- [x] **Step 5: 路由声明序断言——本任务不写（第六轮修正：引用尚不存在的方法名是必红占位，findIndex=-1 → toBeGreaterThan(-1) 失败）**

声明序断言**渐进式落在后续任务**：Task 2.4（作品 :id 首次出现，断言 categories/tags/candidates 在其前）→ Task 2.5 数组补 `uploadCover` → Task 2.6 补 `getSettings`（全部静态段到位后的终态断言）。本步骤无代码。

- [x] **Step 6: Commit**

```bash
```bash
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 类型/标签池 CRUD + 改动删缓存"
```

---

### Task 2.2: candidates 候选视频池（TDD）

**Files:**
- Modify: `video-work.service.ts`（追加 listCandidates）
- Modify: `admin-video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/video-work.service.spec.ts`

- [x] **Step 1: 写失败测试（video-work.service.spec.ts 新建）**

```ts
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 显式导入（同 Task 2.1 注）
// 第十轮（C1-5）：宿主文件异常类导入一次配齐——后续用例 toThrow(BadRequest 2.3/2.5/2.6、NotFound 3.3/4.2、
// Throttler 4.2/4.3、ServiceUnavailable 5.3)全靠它，缺任一即 TS2304、红因与 plan 声明不符
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { VideoWorkService } from './video-work.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';   // service 构造注入（Task 4.2 起）
import { CollabDocumentService } from '../collab/collab-document.service';        // service 构造注入（Task 5.3 起）
import { MinioService } from '../minio/minio.service';
import Redis from 'ioredis';

// 第九轮：替身提升为模块级 + any——后续任务（2.3/2.4/2.5/2.6/3.2/3.3/4.2/4.3/5.3）追加的是**同级** describe，
// 引用 describe 内声明是 TS2304；窄类型另挡后续赋值（prisma.videoWork.* / prisma.videoWorkSetting.* /
// prisma.videoCategory.* / prisma.$executeRaw / minio.delete/buildKey/upload 均 TS2339——api test 第一步是 tsc）。
// any 先例：media.service.spec.ts:10-12、video-work-clone.service.spec。vitest 文件级 beforeEach 对本文件全部 describe 生效。
let service: VideoWorkService;
let prisma: any;
let minio: any;

beforeEach(async () => {
    // 第十轮：命名空间一次配齐（与 providers"创建即完整"同思路）——any 只放宽了类型，命名空间缺失时
    // prisma.videoWork.create = vi.fn() 仍是运行时 TypeError: Cannot set properties of undefined（第九轮遗留：
    // 原 TS2339 编译红只是被搬进运行时，没有消失）。方法给空 vi.fn()，各用例用自己的 mockResolvedValue(Once) 覆盖。
    prisma = {
      media: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'm1', key: 'results/u1/p1/n1/d/v.mp4', projectId: 'p1', thumbnailKey: 'thumbnails/m1.webp',
          metadata: { durationSec: 12.6, width: 1280, height: 720 }, createdAt: new Date('2026-09-01'),
        }]),
        count: vi.fn().mockResolvedValue(1),
      },
      canvasProject: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]), findUnique: vi.fn() },
      videoWork: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      videoCategory: { findMany: vi.fn().mockResolvedValue([]) },
      videoWorkSetting: { findUnique: vi.fn(), upsert: vi.fn() },
      videoTag: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      $executeRaw: vi.fn(),
    };
    minio = { generatePresignedGetUrl: vi.fn().mockResolvedValue('http://minio/presigned'), buildKey: vi.fn(), upload: vi.fn(), delete: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkService,
        { provide: PrismaService, useValue: prisma },
        { provide: MinioService, useValue: minio },
        // 第六轮：service 构造注入随任务增长（4.2 rateLimiter / 5.3 collabDoc），Nest compile 时解析全部构造参数——
        // 不预置则后续任务一加注入本 spec 整文件编译红。两个 mock 一次配齐，后续任务直接用。
        { provide: RateLimiterService, useValue: { checkIpRateLimit: vi.fn().mockResolvedValue(true), checkUserRateLimit: vi.fn().mockResolvedValue(true), getClientIp: vi.fn().mockReturnValue('1.2.3.4') } },
        { provide: CollabDocumentService, useValue: { readCanvas: vi.fn() } },
        { provide: 'REDIS_CLIENT', useValue: { get: vi.fn(), set: vi.fn(), del: vi.fn() } },
      ],
    }).compile();
    service = moduleRef.get(VideoWorkService);
  });

// 第九轮：describe 开行移到文件级 beforeEach 之后（首任务用例从下一行开始；后续任务直接追加同级 describe 即可引用替身）
describe('VideoWorkService.listCandidates', () => {

  it('口径：type=generated + video/mp4 + completed + 未删除 + metadata.origin=video-project', async () => {
    await service.listCandidates(1, 20);
    const where = prisma.media.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('generated');
    expect(where.mimeType).toBe('video/mp4');
    expect(where.status).toBe('completed');
    expect(where.deletedAt).toBeNull();
    expect(where.metadata).toEqual({ path: ['origin'], equals: 'video-project' });
  });

  it('canvasExists 批量单查（findMany in，非逐条 findUnique）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledWith({ where: { id: { in: ['p1'] } }, select: { id: true } });
    expect(res.items[0].canvasExists).toBe(true);
    expect(prisma.canvasProject.findMany).toHaveBeenCalledTimes(1);
  });

  it('projectId 为空 → canvasExists=false', async () => {
    prisma.media.findMany.mockResolvedValue([{ id: 'm2', key: 'k', projectId: null, thumbnailKey: null, metadata: {}, createdAt: new Date() }]);
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].canvasExists).toBe(false);
  });

  it('durationSec 取整入库口径（12.6 → 13）', async () => {
    const res = await service.listCandidates(1, 20);
    expect(res.items[0].durationSec).toBe(13);
  });
});

// 第十一轮：补 invalidateCategoryCache 服务端覆盖——Task 2.1 的 category/tag CRUD 由 controller spec 的
// service mock 驱动、service 侧此前零用例，spec §4.2"admin 改类型时主动删缓存"无测试钉住（redis 即文件级
// providers 的 REDIS_CLIENT 替身，(service as any).redis 取同一实例）
describe('category CRUD 缓存失效', () => {
  it('createCategory → prisma.videoCategory.create + redis.del(videoWork:categories)', async () => {
    prisma.videoCategory.create = vi.fn().mockResolvedValue({ id: 'c1' });
    await service.createCategory({ name: 'AI真人影视' });
    expect(prisma.videoCategory.create).toHaveBeenCalledWith({ data: { name: 'AI真人影视' } });
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:categories');
  });

  it('deleteCategory → prisma.videoCategory.delete + redis.del', async () => {
    prisma.videoCategory.delete = vi.fn().mockResolvedValue({ id: 'c1' });
    await service.deleteCategory('c1');
    expect(prisma.videoCategory.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:categories');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @flowweb/api test -- video-work.service.spec`
Expected: FAIL（listCandidates 不存在）

- [x] **Step 3: 实现（service 追加）**

```ts
import type { CandidateMedia } from '@flowweb/shared'; // 裸包名——shared 无 exports map（package.json 只有 main/types→src/index.ts），子路径 '@flowweb/shared/types/video-work' 不可解析，api 侧 tsc 直接 TS2307（先例 content.service.ts:3）

/** 候选视频池（spec §4.4 口径，admin 策展全站——跨团队有意设计 D16/R10） */
async listCandidates(page: number, pageSize: number): Promise<{ items: CandidateMedia[]; total: number }> {
  const skip = (page - 1) * pageSize;
  const where = {
    status: 'completed' as const,
    deletedAt: null,
    type: 'generated' as const,
    mimeType: 'video/mp4',
    metadata: { path: ['origin'], equals: 'video-project' },
  };
  const [rows, total] = await Promise.all([
    this.prisma.media.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
    this.prisma.media.count({ where }),
  ]);
  const projectIds = [...new Set(rows.map(r => r.projectId).filter((p): p is string => !!p))];
  const existing = projectIds.length
    ? new Set((await this.prisma.canvasProject.findMany({ where: { id: { in: projectIds } }, select: { id: true } })).map(p => p.id))
    : new Set<string>();
  const items: CandidateMedia[] = await Promise.all(rows.map(async r => ({
    id: r.id,
    key: r.key,
    projectId: r.projectId,
    canvasExists: !!r.projectId && existing.has(r.projectId),
    thumbnailKey: r.thumbnailKey,
    durationSec: r.metadata && typeof (r.metadata as any).durationSec === 'number' ? Math.round((r.metadata as any).durationSec) : null,
    width: (r.metadata as any)?.width ?? null,
    height: (r.metadata as any)?.height ?? null,
    createdAt: r.createdAt.toISOString(),
    previewUrl: await this.presignWork(r.key).catch(() => null), // 第七轮 A5：走 presignWork 短缓存（与列表/详情/缩略图同纪律）——原逐行裸签名 50 次/页
  })));
  return { items, total };
}

// presign + 短缓存纪律（TTL < URL TTL，media.service.ts:16-31 同款）——本任务即定义（Task 3.2 列表/3.3 详情/5.2 缩略图复用；
// 第七轮前移：原定义在 Task 3.2 会造成本任务的前向引用 tsc 红）
private async presignWork(key: string): Promise<string> {
  const cacheKey = `videoWork:url:${key}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return cached;
  const url = await this.minio.generatePresignedGetUrl(key, 3600);
  await this.redis.set(cacheKey, url, 'EX', 3500);
  return url;
}
```

controller 追加（在 categories/tags 之后、作品 :id 之前）：

```ts
@Get('candidates')
listCandidates(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
  return this.service.listCandidates(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
}
```

- [x] **Step 4: 跑测试确认通过 + Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 candidates 候选池（口径+分页+canvasExists 批量+取整）"
```

### Task 2.3: 作品 CRUD service（TDD：保存校验/publishedAt/durationSec）

**Files:**
- Create: `dto/create-video-work.dto.ts`、`dto/update-video-work.dto.ts`
- Modify: `video-work.service.ts`

- [x] **Step 1: 写失败测试（video-work.service.spec.ts 追加 describe）**

```ts
describe('createWork/updateWork 保存校验与发布语义', () => {
  it('(allowViewProcess||allowClone)=true 且无 canvasProjectId → 400', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: true, allowClone: false, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k',
      allowViewProcess: false, allowClone: true, canvasProjectId: undefined } as any)).rejects.toThrow(BadRequestException);
  });

  it('allowClone=true 且 allowViewProcess=false → 400（第八轮裁定：克隆入口在创作过程视图顶栏——开关耦合，防前端不可达死开关；update 语义=合并现有值后判定）', async () => {
    await expect(service.createWork({ title: 't', authorName: 'a', videoKey: 'k', canvasProjectId: 'p1',
      allowViewProcess: false, allowClone: true } as any)).rejects.toThrow(BadRequestException);
    // 现有 allowViewProcess=true：单独开 allowClone 不 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: true, allowClone: false, canvasProjectId: 'p1' });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await expect(service.updateWork('w1', { allowClone: true } as any)).resolves.toBeTruthy();
    // 现有 allowViewProcess=false：开 allowClone → 400
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT', publishedAt: null, allowViewProcess: false, allowClone: false, canvasProjectId: 'p1' });
    await expect(service.updateWork('w1', { allowClone: true } as any)).rejects.toThrow(BadRequestException);
  });

  it('发布动作：status 转 PUBLISHED 且 publishedAt 为空 → 服务端设 now；请求体带 publishedAt 被忽略', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', status: 'PUBLISHED', publishedAt: new Date('2000-01-01') } as any);
    const data = (prisma.videoWork.create as Mock).mock.calls[0][0].data;
    expect(data.publishedAt.getFullYear()).toBeGreaterThan(2025); // now，非请求体的 2000
  });

  it('再次下架上架不重置 publishedAt（已有 publishedAt → update payload 不写该键）', async () => {
    // updateWork 签名是 (id, dto)——现有行由 service 内部 findUnique 查，此处必须 mock（文件级 videoWork.findUnique 是裸 vi.fn() 返回 undefined——第十一轮修正：原"桩不含 videoWork"表述已过期，第十轮已配齐命名空间）
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', publishedAt: new Date('2026-01-01'), allowViewProcess: false, allowClone: false, canvasProjectId: null });
    prisma.videoWork.update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.updateWork('w1', { status: 'PUBLISHED' } as any);
    const data = (prisma.videoWork.update as Mock).mock.calls[0][0].data;
    expect(data.publishedAt).toBeUndefined(); // 不动原值 = payload 不含该键（Prisma update 未设键即保留 DB 原值）
  });

  it('durationSec 小数取整（12.6 → 13）', async () => {
    prisma.videoWork.create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data }));
    await service.createWork({ title: 't', authorName: 'a', videoKey: 'k', durationSec: 12.6 } as any);
    expect((prisma.videoWork.create as Mock).mock.calls[0][0].data.durationSec).toBe(13);
  });
});
```

（updateWork 第二参数为 dto、第三参数为现有行——service 内先查现有行再合并判断，测试 mock prisma.videoWork.findUnique。）

- [x] **Step 2: 跑红 → Step 3: 实现**

```ts
// dto/create-video-work.dto.ts
import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsIn, MaxLength, ArrayMaxSize } from 'class-validator';

export class CreateVideoWorkDto {
  @IsString() @MaxLength(200) title: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MaxLength(64) authorName: string;
  @IsOptional() @IsString() categoryId?: string;

  @IsString() @MaxLength(512) videoKey: string;          // 取自 candidate.key
  @IsOptional() @IsString() videoMediaId?: string;        // 取自 candidate.id
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;
  @IsOptional() @IsString() canvasProjectId?: string;     // 取自 candidate.projectId（D16）

  @IsOptional() @IsInt() durationSec?: number;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;

  @IsOptional() @IsInt() viewCount?: number;              // 后台可调（覆盖式）
  @IsOptional() @IsInt() likeCount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'] as const) status?: 'DRAFT' | 'PUBLISHED'; // @IsIn 非 @IsEnum（C2 Task 2.3——按值匹配成立但文案为空，IsIn 更干净）
  @IsOptional() @IsBoolean() allowViewProcess?: boolean;
  @IsOptional() @IsBoolean() allowClone?: boolean;
  // 注意：无 publishedAt 字段——服务端专用（spec §4.3）
}
```

`update-video-work.dto.ts`（第七轮补类体——四个 DTO 唯它无代码，"同构但可选"配合 forbidNonWhitelisted 决定换源字段是 400 还是忽略，两种读法都通，必须定死：**不声明 videoKey/videoMediaId 字段 → 后台再提交即 400**（v1 不支持换源，换源=重建作品））：

```ts
import { IsString, IsInt, IsBoolean, IsOptional, IsArray, IsIn, MaxLength, ArrayMaxSize } from 'class-validator';

export class UpdateVideoWorkDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;          // 可选（仅改状态/计数等场景）
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(64) authorName?: string;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() @MaxLength(512) coverKey?: string;       // 封面可换（上传新图）
  @IsOptional() @IsString() canvasProjectId?: string | null;
  @IsOptional() @IsInt() durationSec?: number;
  @IsOptional() @IsInt() width?: number;
  @IsOptional() @IsInt() height?: number;
  @IsOptional() @IsInt() viewCount?: number;
  @IsOptional() @IsInt() likeCount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED'] as const) status?: 'DRAFT' | 'PUBLISHED';
  @IsOptional() @IsBoolean() allowViewProcess?: boolean;
  @IsOptional() @IsBoolean() allowClone?: boolean;
  // 无 videoKey/videoMediaId（换源=重建）、无 publishedAt（服务端专用）
}
```

service 实现：

```ts
async createWork(dto: CreateVideoWorkDto) {
  this.assertProcessFlags(dto as any);
  const published = dto.status === 'PUBLISHED';
  return this.prisma.videoWork.create({ data: {
    ...dto,
    durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined,
    publishedAt: published ? new Date() : null,   // 请求体无此字段，服务端设
  } });
}

async updateWork(id: string, dto: UpdateVideoWorkDto) {
  const existing = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!existing) throw new NotFoundException('作品不存在');
  const merged = {
    allowViewProcess: dto.allowViewProcess ?? existing.allowViewProcess,
    allowClone: dto.allowClone ?? existing.allowClone,
    canvasProjectId: dto.canvasProjectId !== undefined ? dto.canvasProjectId : existing.canvasProjectId,
    status: dto.status ?? existing.status,
  } as any;
  this.assertProcessFlags(merged);
  const data: any = { ...dto, durationSec: dto.durationSec != null ? Math.round(dto.durationSec) : undefined };
  // 发布语义：转 PUBLISHED 且原 publishedAt 为空 → 设 now；已有则不动
  if (merged.status === 'PUBLISHED' && !existing.publishedAt) data.publishedAt = new Date();
  const row = await this.prisma.videoWork.update({ where: { id }, data });
  await this.invalidateWorkCaches(id);
  return row;
}

// 第七轮：本任务就地定义（Task 2.4 removeWork 也调用——前向引用 Task 5.3 会让批次 2 的 tsc 编译红、
// 违反"每任务红-绿-提交"）。Task 5.3 仅把 key 收敛进 PROCESS_CACHE 常量，方法体不变。
private async invalidateWorkCaches(id: string) {
  await this.redis.del(`videoWork:process:${id}`);
}

private assertProcessFlags(w: { allowViewProcess?: boolean; allowClone?: boolean; canvasProjectId?: string | null }) {
  if ((w.allowViewProcess || w.allowClone) && !w.canvasProjectId) {
    throw new BadRequestException('开启创作过程/克隆需要画布来源（canvasProjectId）');
  }
  // 第八轮裁定（spec §4.3）：克隆入口在创作过程视图顶栏——允许克隆必须允许看过程，防"可克隆不可看过程"死开关
  if (w.allowClone && !w.allowViewProcess) {
    throw new BadRequestException('允许克隆必须同时允许查看创作过程（allowClone 依赖 allowViewProcess）');
  }
}
```

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 作品 CRUD service（保存校验/发布自动 publishedAt/取整）"
```

### Task 2.4: 作品 admin controller + 删除红线（TDD）

**Files:**
- Modify: `admin-video-work.controller.ts`（作品路由，声明在全部静态段之后）

- [x] **Step 1: 写失败测试（admin-video-work.controller.spec.ts 追加）**

```ts
it('GET / 作品列表分页透传', async () => {
  service.listAllWorks = vi.fn().mockResolvedValue({ items: [], total: 0 });
  await controller.listWorks('1', '20');
  expect(service.listAllWorks).toHaveBeenCalledWith(1, 20);
});

it('DELETE 只调 removeWork（service 内不调 minio.delete——红线在 service 测试断言）', async () => {
  service.removeWork = vi.fn().mockResolvedValue(undefined);
  await controller.deleteWork('w1');
  expect(service.removeWork).toHaveBeenCalledWith('w1');
});

it('路由声明序：静态段（categories/tags/candidates）先于作品 :id（渐进式——本任务 :id 首次出现；uploadCover 由 Task 2.5、getSettings 由 Task 2.6 各自追加进 staticRoutes 数组，追加前引用是 -1 恒红）', () => {
  const proto = AdminVideoWorkController.prototype;
  const names = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');
  const idRoutes = ['getWork', 'updateWork', 'deleteWork'].map(n => names.indexOf(n)).filter(i => i >= 0);
  const staticRoutes = ['listCategories', 'listTags', 'listCandidates']; // Task 2.5 += 'uploadCover'；Task 2.6 += 'getSettings'
  for (const s of staticRoutes) {
    expect(names.indexOf(s)).toBeGreaterThan(-1);
    expect(Math.min(...idRoutes)).toBeGreaterThan(names.indexOf(s)); // spec §4.2 红线
  }
});
```

- [x] **Step 2: 跑红 → Step 3: 实现**

service 追加：

```ts
async listAllWorks(page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    this.prisma.videoWork.findMany({ orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
    this.prisma.videoWork.count(),
  ]);
  return { items, total };
}
async getWorkById(id: string) { return this.prisma.videoWork.findUnique({ where: { id } }); }

/** 删除红线（spec §4.3）：只删 DB 行，禁止 minio.delete——videoKey 与源 Media 指向同一对象。
 *  HomeBanner "先删对象再删行"先例不可照抄；coverKey 自有上传对象 v1 也统一不删。 */
async removeWork(id: string) {
  await this.prisma.videoWork.delete({ where: { id } });
  await this.invalidateWorkCaches(id);
}
```

controller 追加（文件末尾，静态段全部之后）：

```ts
@Get() listWorks(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
  return this.service.listAllWorks(Math.max(1, Number(page) || 1), Math.min(50, Math.max(1, Number(pageSize) || 20)));
}
@Post() createWork(@Body() dto: CreateVideoWorkDto) { return this.service.createWork(dto); }
@Get(':id') getWork(@Param('id') id: string) { return this.service.getWorkById(id); }
@Put(':id') updateWork(@Param('id') id: string, @Body() dto: UpdateVideoWorkDto) { return this.service.updateWork(id, dto); }
@Delete(':id') deleteWork(@Param('id') id: string) { return this.service.removeWork(id); }
```

service 测试追加红线断言：

```ts
it('removeWork 不触碰 MinIO（删除红线——MinioService 的删除方法真名是 delete，minio.service.ts:117；全类无 removeObject，原断言恒真抓不到任何真实调用，第八轮修正）', async () => {
  prisma.videoWork.delete = vi.fn().mockResolvedValue({});
  minio.delete = vi.fn().mockResolvedValue(undefined);   // 替身显式提供 delete——实现真调用会让下方断言红
  await service.removeWork('w1');
  expect(minio.generatePresignedGetUrl).not.toHaveBeenCalled();
  expect(minio.delete).not.toHaveBeenCalled();           // 红线：只删 DB 行，禁删对象（spec §4.3）
});
```

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- admin-video-work.controller.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 作品 admin CRUD（删除红线：只删行禁删对象）"
```

### Task 2.5: upload-cover 封面上传（magic-number 校验）

**Files:**
- Modify: `admin-video-work.controller.ts` + `video-work.service.ts`

- [x] **Step 1: 写失败测试**（第八轮修正归属：magic-number 在 **service**——controller 只有 fileFilter 拦 mimetype（单测直调不经 multer）与 !file 检查；原 controller 用例把 service mock 掉后断言 400 是永红。magic-number/三参断言进 service spec，controller spec 只测转发与缺文件）

controller spec 追加：

```ts
it('uploadCover 转发 service（buffer/mimetype）', async () => {
  service.uploadCover = vi.fn().mockResolvedValue({ key: 'uploads/system/xxx.webp' });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'); // PNG 魔数头
  const res = await controller.uploadCover({ buffer: png, mimetype: 'image/png', originalname: 'x.png' } as any);
  expect(service.uploadCover).toHaveBeenCalledWith(png, 'image/png');
  expect(res.key).toContain('uploads/system/');
});
it('缺文件 → 400 file is required', async () => {
  await expect(controller.uploadCover(undefined as any)).rejects.toThrow(BadRequestException);
});
```

service spec（video-work.service.spec.ts）追加：

```ts
describe('uploadCover（magic-number + system 域）', () => {
  it('非图片字节 → 400（mimetype 伪装拦截）', async () => {
    await expect(service.uploadCover(Buffer.from('not an image'), 'image/png')).rejects.toThrow(BadRequestException);
  });
  it('合法 PNG → buildKey('uploaded','system') + upload(key, buffer, mimetype) 三参、key 匹配 ^uploads/system/', async () => {
    minio.buildKey = vi.fn().mockReturnValue('uploads/system/2026-09-16/abc.png');
    minio.upload = vi.fn().mockResolvedValue(undefined);
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const res = await service.uploadCover(png, 'image/png');
    expect(minio.upload).toHaveBeenCalledWith('uploads/system/2026-09-16/abc.png', png, 'image/png'); // 三参（C2 定稿断言，第八轮落进正文）
    expect(res.key).toMatch(/^uploads\/system\//);
  });
});
```

- [x] **Step 2: 跑红 → Step 3: 实现**

```ts
// controller
@Post('upload-cover')
@UseInterceptors(FileInterceptor('file', {
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) return cb(new BadRequestException('仅支持 jpg/png/webp'), false); // 显式抛——静默拒绝会让用户看到 'file is required'（banner 先例 admin-home-banner.controller.ts:45）
    cb(null, true);
  },
}))
uploadCover(@UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }) { // 仓库无 @types/multer——内联类型
  if (!file) throw new BadRequestException('file is required');
  return this.service.uploadCover(file.buffer, file.mimetype);
}

// service
async uploadCover(buffer: Buffer, mimetype: string): Promise<{ key: string }> {
  // magic-number（WebP 查 12 字节：RIFF(0-3) + 偏移 8-11 WEBP——banner 同款 admin-home-banner.controller.ts:54-57）
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  const ext = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
  if (!ext) throw new BadRequestException('仅支持 png/jpg/webp');
  const key = this.minio.buildKey('uploaded', 'system', { ext }); // uploads/system/{date}/{uuid}.{ext}——勿手拼 key 勿用 uuid 包（C1-4）
  await this.minio.upload(key, buffer, mimetype); // upload(key, buffer, contentType) 三参（minio.service.ts:105）
  return { key };
}
```

**实施注意（已核验，勿再探查）**：MinioService 写对象就是 `upload(key, buffer, contentType)`（minio.service.ts:105，无 putObject/uploadBuffer/presignedPut）；上传先例 = admin-home-banner.controller.ts:39-66（FileInterceptor + limits + fileFilter + magic-number + buildKey + upload 三参），上方代码即照抄该先例。
**跑绿前置（第八轮落实注释里的承诺）**：把 `'uploadCover'` 追加进 Task 2.4 的 staticRoutes 数组（渐进式断言——追加前 getOwnPropertyNames 对该键 -1 属预期红）。

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- admin-video-work.controller.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 封面上传（magic-number + system 公开域）"
```

### Task 2.6: settings 轮播设置端点（默认值兜底；跑绿前置：把 `'getSettings'` 追加进 Task 2.4 的 staticRoutes 数组——第八轮落实注释承诺）

**Files:**
- Modify: `admin-video-work.controller.ts` + `video-work.service.ts`

- [x] **Step 1: 写失败测试（service spec 追加）**

```ts
it('无行返回默认值（不依赖 DB 有行）', async () => {
  prisma.videoWorkSetting.findUnique = vi.fn().mockResolvedValue(null);
  const s = await service.getSettings();
  expect(s).toEqual({ carouselEnabled: true, carouselScope: 'all' });
});
it('PUT 走 upsert singleton 行', async () => {
  prisma.videoWorkSetting.upsert = vi.fn().mockResolvedValue({});
  await service.updateSettings({ carouselEnabled: false, carouselScope: 'category' });
  expect(prisma.videoWorkSetting.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'singleton' } }),
  );
});
it('carouselScope 非法值 → 400', async () => {
  await expect(service.updateSettings({ carouselEnabled: true, carouselScope: 'xx' as any })).rejects.toThrow(BadRequestException);
});
```

- [x] **Step 2: 跑红 → Step 3: 实现**

```ts
// service
async getSettings(): Promise<{ carouselEnabled: boolean; carouselScope: 'all' | 'category' }> {
  const row = await this.prisma.videoWorkSetting.findUnique({ where: { id: 'singleton' } });
  return { carouselEnabled: row?.carouselEnabled ?? true, carouselScope: (row?.carouselScope as 'all' | 'category') ?? 'all' };
}
async updateSettings(dto: { carouselEnabled: boolean; carouselScope: 'all' | 'category' }) {
  if (dto.carouselScope !== 'all' && dto.carouselScope !== 'category') throw new BadRequestException('carouselScope 仅 all|category');
  await this.prisma.videoWorkSetting.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
    update: { carouselEnabled: dto.carouselEnabled, carouselScope: dto.carouselScope },
  });
  return this.getSettings();
}
```

controller（静态段区）——**updateSettings 的 body 必须落 DTO class（第五轮：内联对象字面量的 metatype 是 Object，类级 ValidationPipe 对其整体跳过，forbidNonWhitelisted 失效）**：

```ts
// dto/update-video-work-settings.dto.ts（新建）
import { IsBoolean, IsIn } from 'class-validator';

export class UpdateVideoWorkSettingsDto {
  @IsBoolean() carouselEnabled: boolean;
  @IsIn(['all', 'category'] as const) carouselScope: 'all' | 'category';
}
```

```ts
@Get('settings') getSettings() { return this.service.getSettings(); }
@Put('settings') updateSettings(@Body() dto: UpdateVideoWorkSettingsDto) {
  return this.service.updateSettings(dto);
}
```

- [x] **Step 4: 跑绿 + 批次 2 全量回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次2 settings 端点（singleton upsert + 默认值兜底）"
```

> **批次 2 执行记录（2026-09-16）**：六任务 TDD 全链提交 8e51efae（2.1 类型/标签 CRUD）/00dba968（2.2 candidates）/e0a1fbf1（2.3 作品 CRUD service）/c0691ae0（2.4 admin controller+删除红线）/8712832b（2.5 upload-cover）/a5104217（2.6 settings），全量 **130 files / 1025 tests** 全绿（基线 999+26 吻合）。spec 合规审查 ✅（十红线全达标：删除禁 minio.delete 有钉子测试、五静态段路由序渐进断言、ValidationPipe 类级、保存校验双 400、publishedAt 服务端设、durationSec 取整、候选口径+canvasExists 批量单查、magic-number 三格式、settings 默认值兜底）；代码质量审查 ✅ Ready to merge（+注释修正 e99d6a49）。**已裁定机械偏差 3 处**（plan 代码块 strict 编译必要修复，均对齐仓库先例）：①DTO 必填属性加 `!`（TS2564，先例 create-home-banner.dto.ts:25）；②2.5 it 标题内层引号笔误改双引号（断言零改动）；③2.5 controller uploadCover 补 async（先例 admin-home-banner.controller.ts:50）。**登记未修 Minor**：updateWork `data: any` 类型收窄（plan 逐字，后续批次不动它）；上传 Content-Type 透传客户端 mimetype（与 banner 先例一致）；路由序白名单式断言无前向防护（plan 指定形态）。**批次 3 提醒**：公开 categories 缓存键复用 service 内 CATEGORY_CACHE_KEY 常量（勿复制字面量）；updateWork/removeWork 只 del process 缓存、公开列表残余 ≤60s 已裁定接受。

---

## 批次 3：公开列表/详情/categories

### Task 3.1: PUBLIC_PREFIXES 放行（+auth.guard.spec）

**Files:**
- Modify: `apps/api/src/auth/auth.guard.ts:3-15`（PUBLIC_PREFIXES 数组 +1 行）
- Modify: `apps/api/src/auth/auth.guard.spec.ts`（新增一条用例，既有 13 个用例不动——第九轮更正计数，spec:400 同口径）

- [x] **Step 1: 写失败测试（auth.guard.spec.ts 追加）**

```ts
it('/api/video-works 前缀公开放行', async () => {
  // 第七轮修正：switchToHttp 是方法不是对象——guard 内部调 context.switchToHttp().getRequest()，
  // 对象形态直接 TypeError（Step 2 红错位置错、Step 4 永不绿）。既有 spec 的正确形态：auth.guard.spec.ts:31
  const ctx = { switchToHttp: () => ({ getRequest: () => ({ path: '/api/video-works', headers: {} }) }) };
  await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
});
```

- [x] **Step 2: 跑红 → Step 3: 实现（数组加一行）**

```ts
const PUBLIC_PREFIXES = [
  // ...既有项不动...
  '/api/media/by-key',
  '/api/video-works',   // ← 新增（D4：前缀放行 + handler 自守，clone/like 在 handler 内验 req.user）
  // ...
];
```

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- auth.guard.spec
git add apps/api/src/auth/
git commit -m "feat(video-work): 批次3 PUBLIC_PREFIXES 放行 /api/video-works"
```

### Task 3.2: 公开列表 + categories 缓存（TDD）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`
- Create: `apps/api/src/modules/video-work/video-work.controller.spec.ts`

- [x] **Step 1: 写失败测试（controller spec 新建；service 查询逻辑在 service spec 追加）**

```ts
// video-work.controller.spec.ts
import { Test } from '@nestjs/testing';
import type { Mock } from 'vitest'; // 显式导入（同 Task 2.1 注）
import { UnauthorizedException } from '@nestjs/common'; // 第十轮（C1-5）：Task 4.3 like 401 / 6.2 clone 401 用例 toThrow 用
import { VideoWorkController } from './video-work.controller';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
// 第七轮：controller 构造签名自 Task 1.3 一次到位（service+rateLimiter+cloneService）——providers 创建即完整，
// 后续任务只往 service mock 补方法，providers 永不二次编辑（第六轮"各任务追加 provider"的补丁作废）

describe('VideoWorkController（公开）', () => {
  let controller: VideoWorkController;
  let service: Record<string, Mock>;
  // 第十一轮：moduleRef 提升 describe 作用域——Task 6.2 的 clone 用例要从它取 VideoWorkCloneService 实例断言，
  // 局部 const 到不了后续追加的用例（原只活在注释里，不提升是 TS2304）
  let moduleRef: any;
  // service mock 随任务补齐 controller 实际调用的方法：getDetail(3.3)/recordView(4.2)/toggleLike(4.3)/getProcess(5.3)/clone(6.2)/getSettings(3.2 本任务即加)

  beforeEach(async () => {
    service = {
      listPublished: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
      listCategoriesPublic: vi.fn().mockResolvedValue([]),
      getSettings: vi.fn().mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' }),
    };
    moduleRef = await Test.createTestingModule({
      controllers: [VideoWorkController],
      providers: [
        { provide: VideoWorkService, useValue: service },
        { provide: RateLimiterService, useValue: { getClientIp: vi.fn().mockReturnValue('1.2.3.4'), checkIpRateLimit: vi.fn().mockResolvedValue(true), checkUserRateLimit: vi.fn().mockResolvedValue(true) } },
        { provide: VideoWorkCloneService, useValue: { clone: vi.fn().mockResolvedValue({ projectId: 'new-p' }) } },
      ],
    }).compile();
    controller = moduleRef.get(VideoWorkController);
  });

  it('GET / 分页参数 clamp（pageSize=9999 → 50；page=0 → 1）', async () => {
    await controller.list(undefined, '0', '9999');
    expect(service.listPublished).toHaveBeenCalledWith(undefined, 1, 50);
  });

  it('GET /categories 已注册（声明顺序断言在 Task 3.3 首写 :id 路由时补——本任务 getDetail 尚不存在，indexOf=-1 恒红）', () => {
    const names = Object.getOwnPropertyNames(VideoWorkController.prototype).filter(n => n !== 'constructor');
    expect(names.indexOf('listCategories')).toBeGreaterThan(-1);
  });
});
```

service spec 追加：

```ts
describe('listPublished', () => {
  it('orderBy 含 id tiebreaker（spec §4.2）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.listPublished(undefined, 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' },
    ]);
  });

  it('categoryId 为 plain filter（不校验 active）', async () => {
    prisma.videoWork.findMany = vi.fn().mockResolvedValue([]);
    prisma.videoWork.count = vi.fn().mockResolvedValue(0);
    await service.listPublished('any-cat', 1, 20);
    expect(prisma.videoWork.findMany.mock.calls[0][0].where.categoryId).toBe('any-cat');
  });

  it('listCategoriesPublic 命中缓存第二次不查 DB', async () => {
    prisma.videoCategory.findMany = vi.fn().mockResolvedValue([]);
    const redisGet = (service as any).redis.get.mockResolvedValue('[]');
    await service.listCategoriesPublic();
    await service.listCategoriesPublic();
    expect(prisma.videoCategory.findMany).toHaveBeenCalledTimes(0); // 全部命中缓存
    redisGet.mockReset();
  });
});
```

- [x] **Step 2: 跑红 → Step 3: 实现**

service：

```ts
/** 公开列表（spec §4.2：item 只含 5 字段，无 videoUrl） */
async listPublished(categoryId: string | undefined, page: number, pageSize: number) {
  const where: any = { status: 'PUBLISHED' };
  if (categoryId) where.categoryId = categoryId; // plain filter
  const [rows, total] = await Promise.all([
    this.prisma.videoWork.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { id: 'asc' }], // id tiebreaker
      select: { id: true, title: true, coverKey: true, durationSec: true, tags: true },
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    this.prisma.videoWork.count({ where }),
  ]);
  const items = await Promise.all(rows.map(async r => ({
    id: r.id, title: r.title, durationSec: r.durationSec, tags: r.tags,
    coverUrl: r.coverKey ? await this.presignWork(r.coverKey) : null,
  })));
  return { items, total, page, pageSize };
}

// presignWork 已在 Task 2.2 定义（第七轮前移——本任务 listPublished 复用，勿重复定义）

/** 公开类型列表（active + 30-60s 缓存；admin 改动时 Task 2.1 已删缓存） */
async listCategoriesPublic() {
  const cached = await this.redis.get(VideoWorkService.CATEGORY_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const rows = await this.prisma.videoCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, sortOrder: true },
  });
  await this.redis.set(VideoWorkService.CATEGORY_CACHE_KEY, JSON.stringify(rows), 'EX', 60);
  return rows;
}
```

controller：

```ts
// video-work.controller.ts（categories/settings 静态段在最前；settings 第七轮自 Task 8.3 前移——后端端点不留在前端批次）
import { Controller, Get, Query, Param, Post, Req, Inject, NotFoundException } from '@nestjs/common';
import { VideoWorkService } from './video-work.service';
import { VideoWorkCloneService } from './video-work-clone.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

@Controller('api/video-works')
export class VideoWorkController {
  // 第八轮：三参与 Task 1.3 骨架完全一致（整块粘贴不会丢注入——Task 4.2 recordView 用 rateLimiter、6.2 用 cloneService）
  constructor(
    @Inject(VideoWorkService) private readonly service: VideoWorkService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
    @Inject(VideoWorkCloneService) private readonly cloneService: VideoWorkCloneService,
  ) {}

  @Get('categories')
  listCategories() { return this.service.listCategoriesPublic(); }

  @Get('settings') // 公开轮播设置（service.getSettings() Task 2.6 已定义——admin/公开共用）
  getSettings() { return this.service.getSettings(); }

  @Get()
  list(@Query('categoryId') categoryId: string | undefined,
       @Query('page') page = '1',
       @Query('pageSize') pageSize = '20') {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(50, Math.max(1, Number(pageSize) || 20)); // 手写 clamp（X12）
    return this.service.listPublished(categoryId, p, ps);
  }

  // Task 3.3 getDetail / Task 4.x view/like / Task 5.3 process / Task 6.2 clone 追加
}
```

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次3 公开列表（tiebreaker/clamp/字段裁剪/URL 缓存）+ categories 缓存"
```

### Task 3.3: 详情端点（liked/canViewProcess/canClone/禁 readCanvas）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [x] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('getDetail', () => {
  const work = {
    id: 'w1', title: 't', description: 'd', authorName: 'a', categoryId: 'c1',
    videoKey: 'vk', coverKey: 'ck', canvasProjectId: 'p1',
    viewCount: 10, likeCount: 5, tags: ['x'], publishedAt: new Date(), durationSec: 100, width: 16, height: 9,
    allowViewProcess: true, allowClone: true, status: 'PUBLISHED',
  };

  it('DRAFT → 404', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ ...work, status: 'DRAFT' });
    await expect(service.getDetail('w1', null)).rejects.toThrow(NotFoundException);
  });

  it('画布不存在（findUnique null）→ canViewProcess/canClone=false 且不抛', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    const d = await service.getDetail('w1', null);
    expect(d.canViewProcess).toBe(false);
    expect(d.canClone).toBe(false);
  });

  it('liked 初始态：匿名 false 且未查询 like 键（匿名短路——C2 Task 3.3 收窄版：presignWork 的 URL 缓存也会 redis.get，全量 not.toHaveBeenCalled 必红）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    const redisGet = (service as any).redis.get;
    const d = await service.getDetail('w1', null);
    expect(d.liked).toBe(false);
    expect(redisGet.mock.calls.flat().some((k: any) => String(k).startsWith('videoWork:like:'))).toBe(false); // 只断言 like 键未查
  });

  it('路由声明序：categories/settings 静态段先于 :id（Task 3.2 移入——本任务首写 getDetail；settings 端点第七轮已前移至 Task 3.2，此处一并断言）', () => {
    const names = Object.getOwnPropertyNames(VideoWorkController.prototype).filter(n => n !== 'constructor');
    expect(names.indexOf('listCategories')).toBeLessThan(names.indexOf('getDetail'));
    expect(names.indexOf('getSettings')).toBeLessThan(names.indexOf('getDetail'));
  });

  it('liked 初始态：已登录读同一 like key（videoWork:like:{workId}:{userId}）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    (service as any).redis.get.mockResolvedValue('1');
    const d = await service.getDetail('w1', 'user9');
    expect(d.liked).toBe(true);
    expect((service as any).redis.get).toHaveBeenCalledWith('videoWork:like:w1:user9');
  });

  it('详情端点不触发 readCanvas（canvasProject 校验只 findUnique）——第七轮改无条件断言（spec §7.6 红线：条件式 `if (collabDoc)` 在实现改字段名/漏注入时静默变绿）', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue(work);
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    await service.getDetail('w1', null);
    const readCanvas = (service as any).collabDoc.readCanvas; // Task 1.3 签名一次到位——构造注入必然存在（Task 2.2 spec providers 已提供）
    expect(readCanvas).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 跑红 → Step 3: 实现**

```ts
// service
async getDetail(id: string, userId: string | null) {
  const w = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const canvasExists = w.canvasProjectId
    ? !!(await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } }))
    : false;
  const [videoUrl, coverUrl] = await Promise.all([
    this.presignWork(w.videoKey),
    w.coverKey ? this.presignWork(w.coverKey) : Promise.resolve(null),
  ]);
  const liked = userId ? await this.redis.get(`videoWork:like:${id}:${userId}`).then(v => v === '1') : false; // 匿名短路，同 key（§4.2 约束）
  return {
    id: w.id, title: w.title, description: w.description, authorName: w.authorName,
    categoryId: w.categoryId, videoUrl, coverUrl,
    viewCount: w.viewCount, likeCount: w.likeCount, liked, tags: w.tags,
    publishedAt: w.publishedAt?.toISOString() ?? null,
    durationSec: w.durationSec, width: w.width, height: w.height,
    canViewProcess: w.allowViewProcess && canvasExists,  // 详情禁 readCanvas（§4.2）
    canClone: w.allowClone && canvasExists,               // 原始开关值 + 画布存在
  };
}
```

controller：

```ts
@Get(':id')
getDetail(@Param('id') id: string, @Req() req: any) {
  return this.service.getDetail(id, req.user?.id ?? null);
}
```

- [x] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次3 详情端点（liked 初始态/两开关/禁 readCanvas）"
```

> **批次 3 执行记录（2026-09-16）**：三任务提交 6784fc8c（3.1 PUBLIC_PREFIXES +`/api/video-works`，guard 仅 +1 行含 D4 注释，auth.guard.spec 14 绿）/f572aae7（3.2 listPublished——id tiebreaker 三元组/select 5 字段**无 videoUrl**/clamp；listCategoriesPublic 复用 CATEGORY_CACHE_KEY TTL 60s；公开 controller 静态段先于 :id）/06e8ddf4（3.3 getDetail——PUBLISHED 404/liked 匿名短路零 Redis·登录读 like 键/两开关单次 canvasProject.findUnique 同源/禁 readCanvas 无条件断言）。全量 **131 files / 1037 tests** 全绿（基线 1025+12）。spec 合规审查 ✅（逐字对齐、关键断言无弱化）；代码质量审查 ✅ Ready to merge。**已裁定偏差 1 处**：service.spec 补 `import { VideoWorkController }`（plan 测试块漏 import 行，机械必要）。**登记未修 Minor（批次 4 落点）**：①like 键模板 `videoWork:like:${id}:${userId}` 内联——Task 4.3 实现时收敛为 `likeKey(workId, userId)` 私有方法（届时 getDetail 与 toggleLike 两构造点归一）；②listCategoriesPublic 缓存 miss 路径（findMany 1 次 + set EX 60）无测试覆盖——plan 级缺口，批次 4 追加用例时补；③controller.spec 的 UnauthorizedException 为批次 4 预埋导入（C1-5 前移，落地即消化）。索引核对：列表 orderBy 走 [status,sortOrder,publishedAt desc] 索引序 + id tiebreaker 增量排序（plan 有意取舍）。

---

## 批次 4：计数（view/like + checkUserRateLimit）

### Task 4.1: RateLimiterService.checkUserRateLimit（TDD）

**Files:**
- Modify: `apps/api/src/common/services/rate-limiter.service.ts`
- Modify: `apps/api/src/common/services/rate-limiter.service.spec.ts`（已存在，追加）

- [ ] **Step 1: 写失败测试**

```ts
// 第七轮：变量名对齐既有文件——rate-limiter.service.spec.ts 的替身叫 mockRedis、实例叫 service
// （裸写 redis/limiter 是 TS2304 编译红，错误信息与业务无关易误判环境问题）
describe('checkUserRateLimit', () => {
  it('用户维度固定窗口：window 内超 max → false', async () => {
    mockRedis.incr = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(11);
    mockRedis.expire = vi.fn();
    expect(await service.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(true);
    expect(await service.checkUserRateLimit('u1', 'video-work:clone', 3600, 10)).toBe(false);
  });
  it('key 形如 ratelimit:user:{action}:{userId}', async () => {
    mockRedis.incr = vi.fn().mockResolvedValue(1); mockRedis.expire = vi.fn();
    await service.checkUserRateLimit('u1', 'act', 60, 5);
    expect(mockRedis.incr).toHaveBeenCalledWith('ratelimit:user:act:u1');
  });
  it('不走 IP_WHITELIST（用户维度与 IP 无关）', async () => {
    mockRedis.incr = vi.fn().mockResolvedValue(1); mockRedis.expire = vi.fn();
    expect(await service.checkUserRateLimit('u1', 'act', 60, 5)).toBe(true); // 本地 127.0.0.1 请求也照常计数
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（service 追加方法）**

```ts
/** 用户维度固定窗口限流（不走 IP 白名单——与来源 IP 无关，spec §4.5） */
async checkUserRateLimit(userId: string, action: string, windowSec: number, max: number): Promise<boolean> {
  const key = `ratelimit:user:${action}:${userId}`;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, windowSec);
  return count <= max;
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- rate-limiter
git add apps/api/src/common/services/
git commit -m "feat(video-work): 批次4 checkUserRateLimit（用户维度限流）"
```

### Task 4.2: view 计数端点（IP 去重 + 限流 + StrictMode）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('recordView', () => {
  // 第十一轮：实现第一行就是 findUnique + status 校验——文件级 findUnique 是裸 vi.fn()（undefined），
  // 不补桩则①②在首个 await 抛 NotFoundException（update 计数=0）、③期望 Throttler 实得 NotFound，三条全红。
  // describe 级 beforeEach 在文件级之后执行，DRAFT 用例自带覆盖不受影响。
  beforeEach(() => { prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED' }); });

  it('同 IP 1h 内重复请求只 +1（Redis 去重）', async () => {
    prisma.videoWork.update = vi.fn().mockResolvedValue({});
    (service as any).redis.set = vi.fn().mockResolvedValue('OK');      // 第一次 NX 成功
    await service.recordView('w1', '1.2.3.4');
    (service as any).redis.set = vi.fn().mockResolvedValue(null);      // 第二次 NX 失败
    await service.recordView('w1', '1.2.3.4');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
    expect(prisma.videoWork.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { viewCount: { increment: 1 } } });
  });

  it('StrictMode 双发（同 IP 连续两次）计数仍 1 —— spec §7.4', async () => {
    let call = 0;
    (service as any).redis.set = vi.fn().mockImplementation(() => Promise.resolve(call++ === 0 ? 'OK' : null));
    prisma.videoWork.update = vi.fn().mockResolvedValue({});
    await service.recordView('w9', '5.5.5.5');
    await service.recordView('w9', '5.5.5.5');
    expect(prisma.videoWork.update).toHaveBeenCalledTimes(1);
  });

  it('限流超限 → 429（ThrottlerException 语义）', async () => {
    (service as any).rateLimiter.checkIpRateLimit = vi.fn().mockResolvedValue(false);
    await expect(service.recordView('w1', '9.9.9.9')).rejects.toThrow(ThrottlerException);
  });

  it('DRAFT 作品 → 404', async () => {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'DRAFT' });
    await expect(service.recordView('w1', '1.1.1.1')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service（注入 RateLimiterService——module 已 provide）：

```ts
import { ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';

async recordView(id: string, ip: string) {
  const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const allowed = await this.rateLimiter.checkIpRateLimit(ip, 'video-work:view', 60, 30);
  if (!allowed) throw new ThrottlerException();
  // SET NX 原子去重（1h）——key 存哈希不存明文 IP（spec §4.5 写的就是 ipHash：Redis 内长期驻留客户端明文 IP 是刻意规避的 PII 留存，第七轮对齐）
  const ipHash = createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const ok = await this.redis.set(`videoWork:view:${id}:${ipHash}`, '1', 'EX', 3600, 'NX');
  if (ok !== 'OK') return { counted: false };
  await this.prisma.videoWork.update({ where: { id }, data: { viewCount: { increment: 1 } } });
  return { counted: true };
}
```

controller：

```ts
@Post(':id/view')
recordView(@Param('id') id: string, @Req() req: any) {
  return this.service.recordView(id, this.rateLimiter.getClientIp(req));
}
```

（controller 构造签名自 Task 1.3 一次到位（含 rateLimiter/cloneService），controller spec 的 providers 创建即完整——**本任务只需往 service mock 补 `recordView: vi.fn().mockResolvedValue({ counted: true })` 并加下述用例**；第七轮：第六轮"追加 provider"补丁作废。）

**controller spec 追加**：

```ts
it('POST :id/view 传 getClientIp 结果给 service', async () => {
  await controller.recordView('w1', { headers: {} });
  expect(service.recordView).toHaveBeenCalledWith('w1', '1.2.3.4');
});
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次4 view 计数（IP 去重 NX + 限流 + StrictMode 兜底）"
```

### Task 4.3: like 端点（登录 + SET NX + GREATEST 下界）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('toggleLike', () => {
  // 未登录 401 在 controller spec 断言（本文件只测登录路径；第六轮删除空体占位用例——恒绿假覆盖）
  it('限流：checkUserRateLimit 拒绝 → 429（spec §7.5"限流 429"——view/clone 均已限流，like 第八轮补齐）', async () => {
    (service as any).rateLimiter.checkUserRateLimit = vi.fn().mockResolvedValue(false);
    await expect(service.toggleLike('w1', 'u1')).rejects.toThrow(ThrottlerException);
    expect((service as any).rateLimiter.checkUserRateLimit).toHaveBeenCalledWith('u1', 'video-work:like', 60, 30);
  });

  it('首次点赞：NX 成功 → +1 且返回 liked:true', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue('OK');
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1)); // tagged template mock
    // findUnique 被调两次（先查 status、后回读 likeCount）——$executeRaw 是 mock 不真改库，须序列化给值（第六轮）
    prisma.videoWork.findUnique = vi.fn()
      .mockResolvedValueOnce({ status: 'PUBLISHED' })
      .mockResolvedValueOnce({ likeCount: 5 });
    const res = await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)'); // SQL 模板拼接（C2 Task 4.3 统一式）
    expect(call.slice(1)).toEqual([1, 'w1']);                            // 值序 (delta, id)，字面量
    expect(res).toEqual({ liked: true, likeCount: 5 });
  });

  it('再点取消：NX 失败 → -1 删键', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue(null); // NX 失败=已赞
    (service as any).redis.del = vi.fn();
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1));
    prisma.videoWork.findUnique = vi.fn()
      .mockResolvedValueOnce({ status: 'PUBLISHED' })
      .mockResolvedValueOnce({ likeCount: 4 });
    const res = await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)');
    expect(call.slice(1)).toEqual([-1, 'w1']);
    expect((service as any).redis.del).toHaveBeenCalledWith('videoWork:like:w1:u1');
    expect(res).toEqual({ liked: false, likeCount: 4 });
  });

  it('GREATEST 下界：likeCount=0 时取消不再减（SQL 层保护）', async () => {
    (service as any).redis.set = vi.fn().mockResolvedValue(null);
    prisma.$executeRaw = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(1));
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ id: 'w1', status: 'PUBLISHED', likeCount: 0 });
    await service.toggleLike('w1', 'u1');
    const call = (prisma.$executeRaw as any).mock.calls[0];
    expect(call[0].join('?')).toContain('GREATEST("likeCount" + ?, 0)');
    expect(call.slice(1)).toEqual([-1, 'w1']);
  });
});
```

controller spec 追加：

```ts
it('POST like 未登录 req.user 为空 → 401', async () => {
  await expect(controller.toggleLike('w1', { /* req 无 user */ } as any)).rejects.toThrow(UnauthorizedException);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service：

```ts
async toggleLike(id: string, userId: string): Promise<{ liked: boolean; likeCount: number }> {
  const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:like', 60, 30); // spec §7.5 限流（第八轮补）
  if (!allowed) throw new ThrottlerException();
  const w = await this.prisma.videoWork.findUnique({ where: { id }, select: { status: true } });
  if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
  const key = `videoWork:like:${id}:${userId}`;
  const nx = await this.redis.set(key, '1', 'EX', 7776000, 'NX'); // 90 天（§4.5）
  let delta: number;
  if (nx === 'OK') delta = 1;
  else { await this.redis.del(key); delta = -1; } // NX 原子判断，勿 GET-再-SET（并发双击 +2）
  await this.prisma.$executeRaw`UPDATE "VideoWork" SET "likeCount" = GREATEST("likeCount" + ${delta}, 0) WHERE id = ${id}`;
  const row = await this.prisma.videoWork.findUnique({ where: { id }, select: { likeCount: true } });
  return { liked: delta === 1, likeCount: row?.likeCount ?? 0 };
}
```

controller：

```ts
@Post(':id/like')
toggleLike(@Param('id') id: string, @Req() req: any) {
  if (!req.user?.id) throw new UnauthorizedException(); // D15：登录才能点赞
  return this.service.toggleLike(id, req.user.id);
}
```

- [ ] **Step 4: 跑绿 + 批次 3-4 回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次4 like 端点（登录 userId 去重/SET NX 原子/GREATEST 下界/返回 liked）"
```

---

## 批次 5：创作过程快照（白名单纯函数 + 缩略图 + 端点）

### Task 5.1: snapshot-filter.util 纯函数（核心安全件，多步 TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/snapshot-filter.util.ts`
- Create: `apps/api/src/modules/video-work/snapshot-filter.util.spec.ts`

纯函数、零依赖（Prisma/Minio 均不注入）——快照与克隆共用（D9），选项参数区分差异。

- [ ] **Step 1: 写失败测试（骨架 + 白名单键级行为）**

```ts
import {
  buildFilteredSnapshot, WHITELIST, stripHtmlToText, ensureParentFirst,
  type RawCanvasData, type FilterOptions,
} from './snapshot-filter.util';
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared'; // api 侧首个值导入（既有 4 处 shared 导入均为 import type 且全在 src 源码——spec 值导入是首例）——仅测试文件、由 vitest/Vite 转译不走 Node 运行时（admin.guard.ts:3-5 注释同款判断；tsconfig exclude **/*.spec.ts，永不进 dist），不违反 C2 Task 7.1 的"API 源码禁值导入"；勿当违规删掉（删了就退回自指清单）。第十一轮留意：属仓内首例，Step 4 跑绿若见 ERR_UNKNOWN_FILE_EXTENSION / Unexpected token 'export'（vite-node 未 inline TS 入口），把清单改为本文件本地常量数组即可（零逻辑改动）

const rawNode = (id: string, type: string, data: Record<string, unknown>, extra: any = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data, ...extra });

describe('snapshot-filter 白名单（spec §4.6 表，键以 CanvasView nodeTypes 8 键为真值、shared VIDEO_WORK_NODE_TYPES 锚定——第八轮更正）', () => {
  // 两个口径（第八轮裁定，spec:228/D9）：快照【不】剥 videoEdit——保留节点、data 全剥（WHITELIST['videoEdit']=[]）；
  // 剥除是克隆独有差异。下方白名单用例走快照口径 base；剥除行为用例走克隆口径 cloneOpts。
  const base: FilterOptions = { dropTypes: [], dropIdPrefixes: ['shadow-'], resetStatusIdle: false, injectThumbnails: false };       // 快照口径（getProcessSnapshot 实参）
  const cloneOpts: FilterOptions = { dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'], resetStatusIdle: false, injectThumbnails: false }; // 剥除口径——仅 dropXxx 维度与 clone 一致（clone 真实实参另传 resetStatusIdle:true；本组用例只测剥除行为，第十轮注）

  it('textInput：content HTML→纯文本、prompt（string）直保留', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'textInput', { content: '<p>一只猫在窗台上</p>', prompt: '副提示词' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('一只猫在窗台上');
    expect(out.nodes[0].data.prompt).toBe('副提示词');
  });

  it('imageGen：prompt.text 保留；html/fileId/mediaUrl/allImages/referenceImage/mediaName/generationBatchId/extConfig 全剥', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'imageGen', {
        prompt: { text: '一只猫', html: '<p>一只猫</p>', referencedImageIds: ['r1'] },
        style: 's', model: 'm', quality: 'q', ratio: '1:1', resolution: '2k', aspectRatio: 1,
        fileId: 'f1', mediaUrl: 'http://x', referenceImage: 'ri', mediaName: 'cat.png',
        allImages: [{ id: 'i1', url: 'http://y', name: 'a.png', status: 'success' }],
        generationBatchId: 'g1', extConfig: { model: 'm2', prompt: { text: 't', html: '<p>x</p>' } }, status: 'done',
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.prompt).toBe('一只猫');           // PromptValue → .text 字符串化
    expect(d.style).toBe('s'); expect(d.model).toBe('m'); expect(d.aspectRatio).toBe(1); // aiTool 是 imageExtGen 根级专属（nodeStore.ts:126），不在 imageGen 白名单（C2 Task 5.1 第五轮）
    const keys = Object.keys(d);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'allImages', 'referenceImage', 'mediaName', 'generationBatchId', 'extConfig', 'referencedImageIds', 'status']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('imageExtGen：aiTool/aspectRatio 保留（根级专属）；extConfig 整体剥离、style/prompt 不外显（第五轮 C2 独立用例——第八轮回写正文）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'imageExtGen', {
        aiTool: 'grid_25', aspectRatio: 1, style: 's',
        extConfig: { model: 'm2', prompt: { text: 't', html: '<x>' } },
      })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.aiTool).toBe('grid_25');
    expect(d.aspectRatio).toBe(1);
    expect(Object.keys(d).sort()).toEqual(['aiTool', 'aspectRatio']); // 无 extConfig 无 html 无 style 无 prompt（ext 节点提示词在 extConfig 内随整体剥离）
  });

  it('videoGen：label/model/ratio/prompt.text/trim 保留；origin/videoProjectId/fileId 剥离', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'videoGen', { origin: 'video-edit', videoProjectId: 'vp1', fileId: 'f1', label: '末班地铁 · 导出 1', model: 'video-01', ratio: '16:9', prompt: { text: 'p', html: 'h' }, trimStart: 0, trimEnd: 5, status: 'done' })],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.label).toBe('末班地铁 · 导出 1');
    expect(d.origin).toBeUndefined(); expect(d.videoProjectId).toBeUndefined(); expect(d.fileId).toBeUndefined();
  });

  it('audioGen：model/content 保留（类型键是 audioGen 非 audio）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'audioGen', { model: 'tts', content: '旁白文字', fileId: 'f', status: 'done' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('旁白文字');
    expect(out.nodes[0].data.fileId).toBeUndefined();
  });

  it('multiImageGen：prompt（string）/label 保留；images/generationBatchId/nodeStatus 剥离', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'multiImageGen', { prompt: '分镜提示', label: 'L', images: [{ url: 'u' }], generationBatchId: 'g', nodeStatus: 'done', mainImageIndex: 0, expanded: false })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.prompt).toBe('分镜提示');
    expect(out.nodes[0].data.images).toBeUndefined();
  });

  it('group：groupType/cells/name 保留；collapsed/storyboard 剥离；cells 悬空 id 原样返回', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'group', { groupType: 'storyboard', cells: ['ghost-id', null], name: '分镜1', collapsed: false, storyboard: { x: 1 } })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    const d = out.nodes[0].data;
    expect(d.groupType).toBe('storyboard');
    expect(d.cells).toEqual(['ghost-id', null]); // 原样返回（§7.6 断言口径）
    expect(d.name).toBe('分镜1');
    expect(d.collapsed).toBeUndefined(); expect(d.storyboard).toBeUndefined();
  });

  it('克隆口径：videoEdit 与 shadow- 前缀节点及相连边剥除；__ephemeral 标记节点（无前缀）同样剥除（spec §4.6 字面）', () => {
    const input: RawCanvasData = {
      nodes: [
        rawNode('n1', 'videoGen', { model: 'm' }),
        rawNode('n2', 'videoEdit', { timeline: [1] }),
        rawNode('shadow-tmp', 'imageGen', { prompt: { text: 'x', html: 'y' } }),
        rawNode('n3', 'videoGen', { model: 'm', __ephemeral: true }), // 无 shadow- 前缀、带标记
      ],
      edges: [
        { id: 'e1', sourceId: 'n1', targetId: 'n2' },
        { id: 'e2', sourceId: 'n1', targetId: 'shadow-tmp' },
        { id: 'e3', sourceId: 'n1', targetId: 'n3' },
      ],
    };
    const out = buildFilteredSnapshot(input, cloneOpts);
    expect(out.nodes.map(n => n.id)).toEqual(['n1']);
    expect(out.edges).toEqual([]);
  });

  it('快照口径：videoEdit 节点保留、data 全剥为 {}、连线保留（spec:228"仅结构字段→全部 data"——剥除仅是克隆差异 D9，第八轮裁定）', () => {
    const input: RawCanvasData = {
      nodes: [rawNode('n1', 'videoGen', { model: 'm' }), rawNode('n2', 'videoEdit', { timeline: [1], draft: '内部时间轴' })],
      edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2' }],
    };
    const out = buildFilteredSnapshot(input, base);
    const edit = out.nodes.find(n => n.id === 'n2')!;
    expect(edit).toBeTruthy();          // 节点保留（前端 TYPE_LABEL 有"视频剪辑"）
    expect(edit.data).toEqual({});      // data 全剥
    expect(out.edges).toHaveLength(1);  // 连线保留
  });

  it('剥离范围收口（第七轮）：audioGen.content 是纯文本旁白——含尖括号的正常文本原样保留；PromptValue.text 不做二次 strip', () => {
    const input: RawCanvasData = {
      nodes: [
        rawNode('a1', 'audioGen', { model: 'tts', content: '若 3 < 5 且 6 > 4 则对', fileId: 'f', status: 'done' }),
        rawNode('i1', 'imageGen', { prompt: { text: '数量 2 < 10 的猫', html: '<p>x</p>' }, style: 's' }),
      ],
      edges: [],
    };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data.content).toBe('若 3 < 5 且 6 > 4 则对'); // 不剥——audioGen content 非 HTML
    expect(out.nodes[1].data.prompt).toBe('数量 2 < 10 的猫');        // .text 原文，不再 strip
  });

  it('未知类型默认全剥 data（仅结构字段）', () => {
    const input: RawCanvasData = { nodes: [rawNode('n1', 'futureType', { secret: 'x', nice: 'y' })], edges: [] };
    const out = buildFilteredSnapshot(input, base);
    expect(out.nodes[0].data).toEqual({});
  });

  it('nodeTypes 注册表全覆盖：WHITELIST keys ⊇ VIDEO_WORK_NODE_TYPES（shared 锚定，第八轮裁定——替代本文件硬编码清单的自指断言；配套 web 侧锚定见 Task 9.3）', () => {
    for (const t of VIDEO_WORK_NODE_TYPES) expect(Object.keys(WHITELIST)).toContain(t);
  });

  // 第十二轮 T1/补强：两处"因缺陷而生"的防御分支此前零用例（违反本 plan TDD 铁律）——readCanvas 的
  // position/data 均为 ?.toJSON()（collab-document.service.ts:70-71）可为 undefined、互指 parentId 会爆栈，
  // 都是 readCanvas 真实可达形态。顺带消费 import 的 ensureParentFirst/stripHtmlToText（原未用导入）。
  it('ensureParentFirst 互指 parentId（A↔B）不死循环不爆栈，两节点均保留（visiting 环守卫——C2-B7）', () => {
    const a = rawNode('a', 'group', { groupType: 'normal' }, { parentId: 'b' });
    const b = rawNode('b', 'group', { groupType: 'normal' }, { parentId: 'a' });
    const out = ensureParentFirst([a, b]);
    expect(out.map(n => n.id).sort()).toEqual(['a', 'b']);
    // 第十三轮补：钉 visiting 提前返回的输出序——visit(a) 先递归父 b、b 先 emit（父先子后），out=[b,a]
    expect(out.map(n => n.id)).toEqual(['b', 'a']);
  });

  it('节点缺 data/position（readCanvas 两个 ?.toJSON() 可为 undefined）→ 兜底不抛、输出空 data 与原点', () => {
    const out = buildFilteredSnapshot({ nodes: [{ id: 'n1', type: 'imageGen' } as any], edges: [] }, base);
    expect(out.nodes[0].data).toEqual({});
    expect(out.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  // 第十三轮补：width/height 归一（TDD 缺口——第十一轮加了实现 ?? undefined 但无用例，违反本 plan TDD 铁律）
  it('width/height 为 null（readCanvas 的 m.get(...) ?? null，collab-document.service.ts:68-69）→ 归一为 undefined', () => {
    const out = buildFilteredSnapshot({ nodes: [{ id: 'n1', type: 'imageGen', width: null, height: null } as any], edges: [] }, base);
    expect(out.nodes[0].width).toBeUndefined();
    expect(out.nodes[0].height).toBeUndefined();
  });

  it('stripHtmlToText 剥标签并解码基础实体（同实体多次亦被 /g 全替换）', () => {
    // 夹具含两个 &nbsp;（第十三轮修：原夹具仅一个，期望串 "猫 & <狗>" 的 & 与 < 之间空格无处可来——必红）
    expect(stripHtmlToText('<p>猫&nbsp;&amp;&nbsp;&lt;狗&gt;</p>')).toBe('猫 & <狗>');
  });
});
```

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/api test -- snapshot-filter`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 snapshot-filter.util.ts**

```ts
/** 快照/克隆共用白名单纯函数（spec §4.6/§4.7，D9）。
 *  type 键真值来源 = CanvasView.tsx:42-51 的 nodeTypes 注册表（8 键，含 videoEdit/group——
 *  nodeStore NODE_TYPES 只有 6 键不是全集；API 无法 import web 源码，静态照抄；
 *  全覆盖测试是唯一防线——新增节点类型时必须同步本表）。
 *  isTextNode 用 'text' 判断是既有不一致，勿参照。 */

export interface RawNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string | null;
  data: Record<string, unknown>;
}
export interface RawEdge { id: string; sourceId: string; targetId: string }
export interface RawCanvasData { nodes: RawNode[]; edges: RawEdge[] }

export interface FilterOptions {
  dropTypes: string[];        // 克隆传 ['videoEdit']；快照传 []（videoEdit 保留节点、data 全剥——spec:228/D9，第八轮裁定）
  dropIdPrefixes: string[];
  resetStatusIdle: boolean;   // 克隆 true（防"已完成却无产物"）
  injectThumbnails: boolean;  // 快照 true（由调用方在过滤前注入 data.thumbnailUrl，见 Task 5.2）
}

export interface FilteredNode extends RawNode {}
export interface FilteredEdge { id: string; source: string; target: string }

/** data 白名单表（C2 Task 5.1 第五轮定稿——按 nodeStore.ts:101-127 注释分组的字段实际分布）：
 *  aspectRatio 根级通用（两类都有）；aiTool 仅 imageExtGen 根级；style/model/quality/ratio/resolution/prompt
 *  仅 imageGen 根级（ext 节点的这些值在 extConfig 内、随整体剥离）。缺失字段由 applyWhitelist 的
 *  `field in node.data` 检查 no-op——与 spec §4.6 合并行语义等价。 */
export const WHITELIST: Record<string, string[]> = {
  textInput: ['content', 'prompt'],                                  // content=HTML→纯文本；prompt=string
  imageGen: ['prompt', 'style', 'model', 'quality', 'ratio', 'resolution', 'aspectRatio'],
  imageExtGen: ['prompt', 'aspectRatio', 'aiTool'],                  // prompt 通常在 extConfig 内随整体剥离——保留为 no-op 兜底
  videoGen: ['model', 'ratio', 'prompt', 'trimStart', 'trimEnd', 'label'],
  audioGen: ['model', 'content'],
  multiImageGen: ['prompt', 'label'],
  videoEdit: [],   // 仅结构字段
  group: ['groupType', 'cells', 'name'],
};

/** HTML → 纯文本（红线 2 的服务端半边）：剥全部标签，解码基础实体。
 *  已知边界（第十三轮登记，勿修）：顺序替换存在二次解码——源码字面 `&amp;lt;`（用户想显示 "&lt;"）
 *  先解出 & 得 "&lt;"、随即被 &lt; 规则命中变 "<"，仅显示层差异；输出走 JSON → React 文本节点渲染，
 *  无 HTML 解析、不构成 XSS 面。改一次性回调解码反而破坏 &amp; 正常语义，得不偿失。 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}

export function ensureParentFirst(nodes: RawNode[]): RawNode[] {
  // 依赖序输出（spec §4.6：RF v12 要求父先子后；"先有子后建组"的 Y.Map 插入序不保证）
  const byId = new Map(nodes.map(n => [n.id, n]));
  const emitted = new Set<string>();
  const visiting = new Set<string>();  // 环守卫：A↔B 互指命中即跳过（nodeOrder.ts:4,11,15 仓内同款先例，"不抛栈溢出"）
  const out: RawNode[] = [];
  const visit = (n: RawNode) => {
    if (emitted.has(n.id) || visiting.has(n.id)) return;  // visiting 命中=环，跳过不爆栈
    visiting.add(n.id);
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    if (p) visit(p);                                       // 悬空 parentId：byId 未命中 → 安全跳过
    emitted.add(n.id); out.push(n);
    visiting.delete(n.id);
  };
  for (const n of nodes) visit(n);
  return out;
}

function applyWhitelist(node: RawNode, opts: FilterOptions): FilteredNode {
  const allowed = WHITELIST[node.type] ?? []; // 未知类型默认全剥
  // 第十一轮：readCanvas 的 data 可为 undefined（collab-document.service.ts:71 ?.toJSON()，节点无 data map 时），
  // `field in undefined` 是 TypeError → /process 500——与 position 兜底（下行）同款归一
  const src: Record<string, unknown> = node.data ?? {};
  const data: Record<string, unknown> = {};
  for (const field of allowed) {
    if (!(field in src)) continue;
    const v = src[field];
    if (field === 'content' && node.type === 'textInput' && typeof v === 'string') {
      data.content = stripHtmlToText(v);           // 仅 textInput.content 是 tiptap HTML；audioGen.content 是纯文本旁白——误剥会把 "3 < 5" 吃成 "3 5"（第七轮收口）
    } else if (field === 'prompt') {
      data.prompt = (v && typeof v === 'object')
        ? String((v as any).text ?? '')            // PromptValue → 只取 .text 原文（红线 1：永不返回 .html；.text 本身是纯文本，勿再 strip——防正常尖括号文本被吃）
        : v;                                       // textInput/multiImageGen 的 string prompt
    } else {
      data[field] = v;
    }
  }
  if (opts.injectThumbnails && typeof src.thumbnailUrl === 'string') {
    data.thumbnailUrl = src.thumbnailUrl;   // Task 5.2 注入字段（快照侧）
  }
  // 克隆：白名单外强制重置（§4.7）——multiImageGen 的态字段是 nodeStatus（nodeStore.ts:158 必填），
  // 且限定到声明了态字段的类型（给 textInput/group 塞 status 是无害噪音，勿加）
  if (opts.resetStatusIdle) {
    if (node.type === 'multiImageGen') data.nodeStatus = 'idle';
    else if (['imageGen', 'imageExtGen', 'videoGen', 'audioGen'].includes(node.type)) data.status = 'idle';
  }
  // position 兜底：readCanvas 的 position 可 undefined（collab-document.service.ts:70 ?.toJSON()），shared SnapshotNode.position 必填；
  // width/height 归一：readCanvas 是 m.get('width') ?? null（:68-69）→ 实际 number|null，而 RawNode/shared 声明 number|undefined——
  // 在边界把 null 折成 undefined（第十二轮：类型不撒谎，下游 RF 拿到一致的 undefined=未测量）
  return { ...node, width: node.width ?? undefined, height: node.height ?? undefined, position: node.position ?? { x: 0, y: 0 }, data };
}

export function buildFilteredSnapshot(raw: RawCanvasData, opts: FilterOptions): { nodes: FilteredNode[]; edges: FilteredEdge[] } {
  const dropped = new Set<string>();
  const kept = raw.nodes.filter(n => {
    if (opts.dropTypes.includes(n.type)) { dropped.add(n.id); return false; }
    if (opts.dropIdPrefixes.some(p => n.id.startsWith(p))) { dropped.add(n.id); return false; }
    if ((n.data as { __ephemeral?: unknown })?.__ephemeral === true) { dropped.add(n.id); return false; } // 第七轮：spec §4.6 字面要求的 __ephemeral 标记过滤——当前仓库该标记与 shadow- 前缀共生（node-doc.util.ts 不变量），但白名单不依赖命名约定
    return true;
  });
  const edges = raw.edges
    .filter(e => !dropped.has(e.sourceId) && !dropped.has(e.targetId))
    .map(e => ({ id: e.id, source: e.sourceId, target: e.targetId })); // readCanvas sourceId/targetId → source/target 显式映射
  const nodes = ensureParentFirst(kept).map(n => applyWhitelist(n, opts));
  return { nodes, edges };
}
```

注意 `ensureParentFirst` 对悬空 parentId（指向已删节点）天然安全：`byId.get` 未命中 → 跳过父，自身正常输出。

- [ ] **Step 4: 跑绿（补父先子后与悬空 parentId 专项用例）**

spec 文件追加：

```ts
describe('ensureParentFirst（spec §4.6 排序）', () => {
  it('子先父后的输入 → 输出父在前（index(parent) < index(child)）', () => {
    const child = rawNode('c1', 'videoGen', {}, { parentId: 'g1' });
    const parent = rawNode('g1', 'group', { groupType: 'normal', cells: ['c1'] });
    const out = buildFilteredSnapshot({ nodes: [child, parent], edges: [] }, base);
    expect(out.nodes.findIndex(n => n.id === 'g1')).toBeLessThan(out.nodes.findIndex(n => n.id === 'c1'));
  });
  it('悬空 parentId 不死循环不报错', () => {
    const out = buildFilteredSnapshot({ nodes: [rawNode('c1', 'videoGen', {}, { parentId: 'ghost' })], edges: [] }, base);
    expect(out.nodes).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @flowweb/api test -- snapshot-filter`
Expected: PASS 全绿

- [ ] **Step 5: 危险夹具用例（XSS 红线终验）**

```ts
it('危险夹具：content 嵌 <img onerror> → 输出纯文本无标签残留', () => {
  const input: RawCanvasData = { nodes: [rawNode('n1', 'textInput', { content: '<p>ok</p><img src=x onerror=alert(1)>' })], edges: [] };
  const out = buildFilteredSnapshot(input, base);
  expect(out.nodes[0].data.content).not.toContain('<');
  expect(out.nodes[0].data.content).toBe('ok');
});
```

Run 确认 PASS → **Step 6: Commit**

```bash
git add apps/api/src/modules/video-work/snapshot-filter.util.ts apps/api/src/modules/video-work/snapshot-filter.util.spec.ts
git commit -m "feat(video-work): 批次5 快照/克隆共用白名单纯函数（NODE_TYPES 键/HTML→纯文本/父先子后/edges 映射/未知全剥）"
```

### Task 5.2: 缩略图注入（fileId 批量查 → presign → 注入后剥 fileId）

**Files:**
- Modify: `video-work.service.ts`

- [ ] **Step 1: 写失败测试（service spec 追加）**

```ts
describe('injectThumbnails', () => {
  it('收集 fileId 批量查 Media.thumbnailKey → presign 注入 data.thumbnailUrl，响应不含 fileId', async () => {
    prisma.media.findMany = vi.fn().mockResolvedValue([
      { id: 'f1', thumbnailKey: 'thumbnails/f1.webp' },
      { id: 'f2', thumbnailKey: null },
    ]);
    minio.generatePresignedGetUrl = vi.fn().mockResolvedValue('http://minio/thumbs');
    const raw = {
      nodes: [
        { id: 'n1', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'a', html: 'b' }, fileId: 'f1' } },
        { id: 'n2', type: 'videoGen', position: { x: 0, y: 0 }, data: { model: 'm', fileId: 'f2' } },
      ],
      edges: [],
    };
    const out = await service.injectThumbnails(raw as any);
    expect(prisma.media.findMany).toHaveBeenCalledWith({ where: { id: { in: ['f1', 'f2'] } }, select: { id: true, thumbnailKey: true } });
    expect(out.nodes[0].data.thumbnailUrl).toBe('http://minio/thumbs'); // 有 thumbnail 的注入
    expect(out.nodes[1].data.thumbnailUrl).toBeUndefined();             // 无 thumbnail 不注入（前端占位）
    expect(out.nodes[0].data.fileId).toBe('f1');                        // 注入阶段保留 fileId，过滤阶段剥（管线顺序）
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
/** 产物缩略图注入（spec §4.6）：收集 fileId → 批量查 thumbnailKey → presign 注入 → 下游白名单剥 fileId */
async injectThumbnails(raw: RawCanvasData): Promise<RawCanvasData> {
  const fileIds = [...new Set(raw.nodes.map(n => (n.data as any)?.fileId).filter((f): f is string => !!f))];
  if (fileIds.length === 0) return raw;
  const medias = await this.prisma.media.findMany({ where: { id: { in: fileIds } }, select: { id: true, thumbnailKey: true } });
  const urlById = new Map<string, string>();
  await Promise.all(medias.filter(m => m.thumbnailKey).map(async m => {
    urlById.set(m.id, await this.presignWork(m.thumbnailKey!)); // presign 3600s + 短缓存复用
  }));
  for (const n of raw.nodes) {
    const fid = (n.data as any)?.fileId;
    if (typeof fid === 'string' && urlById.has(fid)) (n.data as any).thumbnailUrl = urlById.get(fid)!;
  }
  return raw;
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test -- video-work.service.spec
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次5 缩略图注入（批量单查/presign/无 thumbnail 占位）"
```

### Task 5.3: GET /:id/process 端点（404/503 超时/缓存/键级安全验收）

**Files:**
- Modify: `video-work.service.ts` + `video-work.controller.ts`

- [ ] **Step 1: 写失败测试（service spec 追加，含安全验收键级+正向）**

```ts
describe('getProcessSnapshot（安全验收）', () => {
  const work = { id: 'w1', title: 't', canvasProjectId: 'p1', allowViewProcess: true, status: 'PUBLISHED' };
  const rawCanvas = {
    nodes: [
      { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '<p>一只猫在窗台上</p>', prompt: 'p' } },
      { id: 'n2', type: 'imageGen', position: { x: 0, y: 0 }, data: { prompt: { text: 'cat', html: '<p>evil</p>' }, fileId: 'f1', mediaUrl: 'http://secret', mediaName: 'a.png' } },
      { id: 'n3', type: 'videoGen', position: { x: 0, y: 0 }, data: { label: '末班地铁 · 导出 1', model: 'video-01', origin: 'video-edit', videoProjectId: 'vp1', fileId: 'f3' } },
      { id: 'n35', type: 'videoEdit', position: { x: 0, y: 0 }, data: { timeline: [1], draft: '内部时间轴' } }, // 第八轮：快照保留 videoEdit（仅结构字段，spec:228）
      { id: 'n4', type: 'multiImageGen', position: { x: 0, y: 0 }, data: { prompt: '分镜提示', images: [{ url: 'u' }], generationBatchId: 'g4', nodeStatus: 'done' } },
      { id: 'g1', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['n1', 'ghost-id', null], name: '分镜1', collapsed: false } },
    ],
    edges: [{ id: 'e1', sourceId: 'n1', targetId: 'n2' }],
  };

  function setup(over: any = {}) {
    prisma.videoWork.findUnique = vi.fn().mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue({ id: 'p1' });
    prisma.media.findMany = vi.fn().mockResolvedValue([]);
    (service as any).collabDoc = { readCanvas: vi.fn().mockResolvedValue(rawCanvas) };
    // 第十轮：Map 支撑的 get/set——原 get 恒 null + set 空 vi.fn()，"缓存命中第二次不触 readCanvas"必红
    //（第二次 get 仍 null → 重算 → readCanvas 被调 2 次）。对照 Task 3.2 命中用例（mockResolvedValue('[]')）。
    const cache = new Map<string, string>();
    (service as any).redis.get = vi.fn(async (k: string) => cache.get(k) ?? null); // 未写过 → null（首调无缓存）
    (service as any).redis.set = vi.fn(async (k: string, v: string) => { cache.set(k, v); return 'OK'; });
  }

  it('键级断言：响应全 key 不含敏感字段（递归收集）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const collectKeys = (o: any): string[] =>
      Array.isArray(o) ? o.flatMap(collectKeys) :
      o && typeof o === 'object' ? [...Object.keys(o), ...Object.values(o).flatMap(collectKeys)] : [];
    const keys = collectKeys(out);
    for (const banned of ['html', 'fileId', 'mediaUrl', 'referencedImageIds', 'allImages', 'referenceImage', 'referenceVideo', 'referenceAudio', 'trimmedFileId', 'generationBatchId', 'mediaName', 'videoProjectId', 'origin', 'sourceId']) {
      expect(keys).not.toContain(banned);
    }
  });

  it('正向断言：textInput 纯文本 / imageGen prompt.text / videoGen label / multiImageGen prompt / group groupType+cells 原样（防 key 写错全绿——spec §7.6 全五类配对）', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    const n1 = out.nodes.find((n: any) => n.id === 'n1')!;
    const n2 = out.nodes.find((n: any) => n.id === 'n2')!;
    const n3 = out.nodes.find((n: any) => n.id === 'n3')!;
    const n4 = out.nodes.find((n: any) => n.id === 'n4')!;
    const g = out.nodes.find((n: any) => n.id === 'g1')!;
    expect(n1.data.content).toBe('一只猫在窗台上');
    expect(n2.data.prompt).toBe('cat');
    expect(n3.data.label).toBe('末班地铁 · 导出 1');
    expect(n4.data.prompt).toBe('分镜提示');
    expect(g.data.groupType).toBe('storyboard');
    expect(g.data.cells).toEqual(['n1', 'ghost-id', null]); // 原样返回逐项比对（含悬空 id/null——勿写"全项可在 nodes 中找到"，悬空 id 是已接受行为会红在已知项上）
    const edit = out.nodes.find((n: any) => n.id === 'n35')!;
    expect(edit).toBeTruthy();      // videoEdit 节点保留（spec:228，第八轮）
    expect(edit.data).toEqual({});  // data 全剥（timeline/draft 不外泄）
  });

  it('edges 有 source/target 无 sourceId；缓存命中第二次不触 readCanvas', async () => {
    setup();
    const out = await service.getProcessSnapshot('w1');
    expect(out.edges[0]).toEqual({ id: 'e1', source: 'n1', target: 'n2' }); // 第十轮补：edges 正向断言（原只覆盖"无 sourceId"半边，与用例标题不符）
    await service.getProcessSnapshot('w1');
    const readCanvas = (service as any).collabDoc.readCanvas;
    expect(readCanvas).toHaveBeenCalledTimes(1);
  });

  it('DRAFT 或 allowViewProcess=false 或画布不存在 → 404', async () => {
    setup({ status: 'DRAFT' });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    setup({ allowViewProcess: false });
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
    setup();  // 第十一轮：mockResolvedValue 是替换语义——不复位则 allowViewProcess:false 残留，下一断言在第一守卫就 404，"画布不存在"分支零覆盖（假绿）
    prisma.canvasProject.findUnique = vi.fn().mockResolvedValue(null);
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(NotFoundException);
  });

  it('readCanvas 挂起 → 有界超时 503', async () => {
    setup();
    (service as any).collabDoc.readCanvas = vi.fn().mockImplementation(() => new Promise(() => {})); // 永不 resolve
    await expect(service.getProcessSnapshot('w1')).rejects.toThrow(ServiceUnavailableException);
  }, 10000);
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

service（注入 CollabDocumentService——module 已 import CollabModule）：

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { buildFilteredSnapshot, type RawCanvasData } from './snapshot-filter.util';

private static readonly PROCESS_CACHE = (id: string) => `videoWork:process:${id}`;

async getProcessSnapshot(id: string) {
  const w = await this.prisma.videoWork.findUnique({ where: { id } });
  if (!w || w.status !== 'PUBLISHED' || !w.allowViewProcess || !w.canvasProjectId) throw new NotFoundException();
  const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
  if (!canvas) throw new NotFoundException(); // gateway 空 doc 坑前置校验（§4.6）

  const cacheKey = VideoWorkService.PROCESS_CACHE(id);
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const raw = await this.withTimeout(this.collabDoc.readCanvas(w.canvasProjectId), 5000) as RawCanvasData;
  const withThumbs = await this.injectThumbnails(raw);
  const filtered = buildFilteredSnapshot(withThumbs, {
    dropTypes: [], dropIdPrefixes: ['shadow-'],   // 快照不剥 videoEdit（spec:228 保留节点/data 全剥；剥除仅克隆差异 D9）——第八轮裁定
    resetStatusIdle: false, injectThumbnails: true,
  });
  const result = { workId: id, title: w.title, ...filtered };
  await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 300); // TTL 300s（§4.6）
  return result;
}

/** 有界等待（readCanvas 无读取超时——内部只有 SV 等待 3s；Promise.race 外套）。finally 清 timer——
 *  否则每次调用悬挂一个 5s 定时器，拖慢测试收尾/进程退出（第八轮） */
private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ServiceUnavailableException('画布读取超时')), ms); })])
    .finally(() => clearTimeout(t));
}

/** invalidateWorkCaches 已在 Task 2.3 就地定义（第七轮消前向引用）——本任务仅把字面量 key 收敛为
 *  PROCESS_CACHE 常量（方法签名/调用点不变，勿重复定义） */
```

（若 Task 2.3/2.4 的 `invalidateWorkCaches` 当时是空实现/不存在，本步补齐并被既有调用引用。）

controller：

```ts
@Get(':id/process')
getProcess(@Param('id') id: string) {
  return this.service.getProcessSnapshot(id);
}
```

注意声明位置：`process` 也是静态段风格但带 `:id` 前缀（`/:id/process` 与 `/:id` 不冲突——参数+静态混合段，NestJS 不会吞），仍建议声明在 `getDetail` 之后无碍；`categories` 已在文件最前。

- [ ] **Step 4: 跑绿 + 批次 5 回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次5 process 端点（404 前置/5s 超时 503/300s 缓存/安全验收全绿）"
```

---

## 批次 6：克隆（四元重映射 + 整体超时 + 限流）

### Task 6.1: VideoWorkCloneService（核心编排，多步 TDD）

**Files:**
- Create: `apps/api/src/modules/video-work/video-work-clone.service.ts`
- Create: `apps/api/src/modules/video-work/video-work-clone.service.spec.ts`
- Modify: `video-work.module.ts`（providers + VideoWorkCloneService）

- [ ] **Step 1: 写失败测试（四元重映射 fixture——spec §7.7 核心）**

```ts
import { Test } from '@nestjs/testing';
// 第十轮（C1-5）：校验/限流/超时用例 toThrow 用的四个异常类——原块头零 @nestjs 导入
import { NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { VideoWorkCloneService } from './video-work-clone.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';

describe('VideoWorkCloneService.clone', () => {
  let svc: VideoWorkCloneService;
  let prisma: any; let collabDoc: any; let projectService: any; let rateLimiter: any;

  const work = { id: 'w1', title: '春天的背面', canvasProjectId: 'p1', allowClone: true, status: 'PUBLISHED' };

  /** fixture：分镜组（cells 含 存活子/被剥槽位/null/悬空 id）+ 组外节点 + videoEdit + shadow- */
  const rawCanvas = () => ({
    nodes: [
      { id: 'child1', type: 'videoGen', parentId: 'grp', position: { x: 1, y: 1 }, width: 320, height: 240, data: { model: 'm', fileId: 'f1', status: 'done', label: 'L' } }, // width/height——spec §7 后端7 透传断言（第十一轮补）
      { id: 'grp', type: 'group', position: { x: 0, y: 0 }, data: { groupType: 'storyboard', cells: ['child1', 'edit1', null, 'ghost'] } },
      { id: 'child2', type: 'imageGen', position: { x: 2, y: 2 }, data: { prompt: { text: 'p', html: 'h' }, allImages: [{ url: 'u' }], __fromMulti: 'x' } }, // 组外节点；__fromMulti 清单外字段，克隆不得带走（spec:385）。第十一轮删 parentId:'grp'——原值与 cells 不含 child2 自相矛盾，测试不变量会把 child2 计入 aliveChildren 而"不在 cells"假红
      { id: 'edit1', type: 'videoEdit', parentId: 'grp', position: { x: 3, y: 3 }, data: { timeline: [] } },
      { id: 'shadow-x', type: 'imageGen', position: { x: 4, y: 4 }, data: {} },
    ],
    edges: [
      { id: 'e1', sourceId: 'child1', targetId: 'child2' },
      { id: 'e2', sourceId: 'child1', targetId: 'edit1' },   // 连向被剥节点 → 边剥除
      { id: 'e3', sourceId: 'shadow-x', targetId: 'child2' }, // 同上
    ],
  });

  beforeEach(async () => {
    prisma = { videoWork: { findUnique: vi.fn() }, canvasProject: { findUnique: vi.fn() }, template: { count: vi.fn() } }; // template 供"Template 不参与"断言（第八轮）
    collabDoc = { readCanvas: vi.fn() };
    projectService = { create: vi.fn() };
    rateLimiter = { checkUserRateLimit: vi.fn().mockResolvedValue(true) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoWorkCloneService,
        { provide: PrismaService, useValue: prisma },
        { provide: CollabDocumentService, useValue: collabDoc },
        { provide: ProjectService, useValue: projectService },
        { provide: RateLimiterService, useValue: rateLimiter },
      ],
    }).compile();
    svc = moduleRef.get(VideoWorkCloneService);
  });

  function setup(over: any = {}) {
    prisma.videoWork.findUnique.mockResolvedValue({ ...work, ...over });
    prisma.canvasProject.findUnique.mockResolvedValue({ id: 'p1' });
    collabDoc.readCanvas.mockResolvedValue(rawCanvas());
    projectService.create.mockImplementation((_n: string, _u: string, nodes: any[], edges: any[]) =>
      Promise.resolve({ id: 'new-p', nodes, edges }));
  }

  it('校验：未发布/不允许克隆/无画布/画布不存在 → 404/403', async () => {
    setup({ status: 'DRAFT' });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
    setup({ allowClone: false });
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ForbiddenException);
    setup({ canvasProjectId: null });  // spec §7.7"canvasProjectId 空 → 404"——第十一轮补（原 plan 缺此分支用例）
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
    setup();                           // 第十一轮：mockResolvedValue 是替换语义——不复位则 allowClone:false 残留，下一断言在 !w.allowClone 抛 Forbidden 而非 NotFound
    prisma.canvasProject.findUnique.mockResolvedValue(null);  // 必须后置：setup() 内部会重置 canvasProject.findUnique
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('克隆限流：每用户 10 次/h 超限 → 429', async () => {
    setup();
    rateLimiter.checkUserRateLimit.mockResolvedValue(false);
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ThrottlerException);
    expect(rateLimiter.checkUserRateLimit).toHaveBeenCalledWith('u1', 'video-work:clone', 3600, 10);
  });

  it('四元重映射：videoEdit/shadow- 剥除；parentId/cells 换新 id；悬空与被剥槽位 → null 且长度不变', async () => {
    setup();
    await svc.clone('w1', 'u1');                                  // 返回 { projectId }——断言走 create 收参（第六轮：clone 不返回 nodes，旧解构是 TS2339 + undefined.find）
    const passedNodes = projectService.create.mock.calls[0][2];   // create(title, userId, nodes, edges) 的第 3 参
    const grp = passedNodes.find((n: any) => n.type === 'group');
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(passedNodes.map((n: any) => n.type)).not.toContain('videoEdit');
    expect(passedNodes.map((n: any) => n.id)).not.toContain('shadow-x');
    expect(grp.data.cells).toHaveLength(4);                       // 长度不变
    expect(grp.data.cells[0]).toBe(child1.id);                    // 存活子 → 新 id
    expect(grp.data.cells[1]).toBeNull();                          // edit1 被剥 → null
    expect(grp.data.cells[2]).toBeNull();                          // 原 null 保持
    expect(grp.data.cells[3]).toBeNull();                          // 悬空 ghost → null
    expect(child1.parentId).toBe(grp.id);                          // parentId → 新组 id
    expect(child1.width).toBe(320);                                // width/height 透传（spec §7 后端7——第十一轮补，原夹具无此二字段、断言缺口）
    expect(child1.height).toBe(240);
    // 测试不变量：所有存活子节点新 id 均出现在新 cells 中
    const aliveChildren = passedNodes.filter((n: any) => n.parentId === grp.id);
    for (const c of aliveChildren) expect(grp.data.cells).toContain(c.id);
  });

  it('白名单共用：克隆体 data 不含 fileId/allImages/html/status(done)——status 重置 idle；不注入 thumbnailUrl', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2];
    const child1 = passedNodes.find((n: any) => n.data?.label === 'L');
    expect(child1.data.fileId).toBeUndefined();
    expect(child1.data.status).toBe('idle');
    const child2 = passedNodes.find((n: any) => n.type === 'imageGen' && n.id !== 'shadow-x');
    expect(JSON.stringify(passedNodes)).not.toContain('allImages');
    expect(JSON.stringify(passedNodes)).not.toContain('thumbnailUrl');
    expect(JSON.stringify(passedNodes)).not.toContain('__fromMulti'); // spec:385 清单外字段不带走（fixture 已造）
    expect(JSON.stringify(passedNodes)).not.toContain('__ephemeral');
    expect(prisma.template.count).not.toHaveBeenCalled();              // spec §7.7：Template 行数/importCount 不变——clone 不触 template
  });

  it('边：相连被剥节点的边一并剥除；存活边 source/target 已重映射', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const passedNodes = projectService.create.mock.calls[0][2];
    const passedEdges = projectService.create.mock.calls[0][3];   // 第 4 参
    expect(passedEdges).toHaveLength(1);
    const ids = new Set((passedNodes as any[]).map((n: any) => n.id));
    expect(ids.has(passedEdges[0].source)).toBe(true);
    expect(ids.has(passedEdges[0].target)).toBe(true);
  });

  it('无旧 id 残留：新 nodes/edges 不含任何源 id', async () => {
    setup();
    await svc.clone('w1', 'u1');
    const { nodes, edges } = { nodes: projectService.create.mock.calls[0][2], edges: projectService.create.mock.calls[0][3] };
    const oldIds = ['child1', 'grp', 'child2', 'edit1', 'shadow-x'];
    const serialized = JSON.stringify({ nodes, edges });
    for (const oid of oldIds) expect(serialized).not.toContain(`"${oid}"`);
  });

  it('create 阶段挂起 → 整体有界超时 503（read+create 同一等待）', async () => {
    setup();
    projectService.create.mockImplementation(() => new Promise(() => {}));
    await expect(svc.clone('w1', 'u1')).rejects.toThrow(ServiceUnavailableException);
  }, 15000); // 第九轮：测试超时必须 > CLONE_TIMEOUT_MS(10s)——同值时谁先到点取决于调度，flaky（Task 5.3 的 5000/10000 组合无此问题）

  it('标题加 (副本) 后缀；归属 ProjectService.create（不传 teamId）', async () => {
    setup();
    await svc.clone('w1', 'u1');
    expect(projectService.create.mock.calls[0][0]).toBe('春天的背面 (副本)');
    expect(projectService.create.mock.calls[0][1]).toBe('u1');
  });
});
```

（svc.clone 返回 `{ projectId }`——上方四条用例的断言已全部改为经 `projectService.create.mock.calls[0]` 取 create 收到的 nodes/edges，第六轮已落地、勿再改回解构 clone 返回值的写法。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
// video-work-clone.service.ts
import { Injectable, Inject, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabDocumentService } from '../collab/collab-document.service';
import { ProjectService } from '../project/project.service';
import { RateLimiterService } from '../../common/services/rate-limiter.service';
import { buildFilteredSnapshot, type RawCanvasData, type RawNode, type FilteredNode, type FilteredEdge } from './snapshot-filter.util';

const CLONE_TIMEOUT_MS = 10_000; // read + create 同一有界等待（create 内部 withDoc 同样会挂起）

@Injectable()
export class VideoWorkCloneService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CollabDocumentService) private readonly collabDoc: CollabDocumentService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
    @Inject(RateLimiterService) private readonly rateLimiter: RateLimiterService,
  ) {}

  async clone(workId: string, userId: string): Promise<{ projectId: string }> {
    const allowed = await this.rateLimiter.checkUserRateLimit(userId, 'video-work:clone', 3600, 10);
    if (!allowed) throw new ThrottlerException();
    const w = await this.prisma.videoWork.findUnique({ where: { id: workId } });
    if (!w || w.status !== 'PUBLISHED') throw new NotFoundException();
    if (!w.allowClone) throw new ForbiddenException();
    if (!w.canvasProjectId) throw new NotFoundException();
    const canvas = await this.prisma.canvasProject.findUnique({ where: { id: w.canvasProjectId }, select: { id: true } });
    if (!canvas) throw new NotFoundException();

    const run = async () => {
      const raw = await this.collabDoc.readCanvas(w.canvasProjectId!) as RawCanvasData;
      // 与快照共用白名单（D9）：克隆分支 resetStatusIdle + 不注入缩略图 + 剥 videoEdit/shadow-
      // （剥 videoEdit 是克隆独有差异——快照保留该节点类型只剥 data，spec:228/D9 第八轮归一）
      const filtered = buildFilteredSnapshot(raw, {
        dropTypes: ['videoEdit'], dropIdPrefixes: ['shadow-'],
        resetStatusIdle: true, injectThumbnails: false,
      });
      const { nodes, edges } = this.remapIds(filtered.nodes, filtered.edges, raw.nodes);
      const project = await this.projectService.create(`${w.title} (副本)`, userId, nodes, edges);
      return { projectId: project.id };
    };
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      run(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new ServiceUnavailableException('克隆超时')), CLONE_TIMEOUT_MS); }),
    ]).finally(() => clearTimeout(timer)); // 第八轮：与 withTimeout 同款清理，防悬挂定时器
  }

  /** 四元重映射（spec §4.7 红线）：id / parentId / edges source+target / group.data.cells。
   *  cells 三分支一律不抛（悬空 id 是可达真实状态）；禁止 idMap.get(id) || id 兜底。 */
  private remapIds(nodes: FilteredNode[], edges: FilteredEdge[], rawNodes: RawNode[]): { nodes: any[]; edges: FilteredEdge[] } {
    const droppedIds = new Set(
      rawNodes
        .filter(n => n.type === 'videoEdit' || n.id.startsWith('shadow-'))
        .map(n => n.id),
    );
    const idMap = new Map<string, string>();
    let seq = 0;
    const newId = () => `vw${Date.now().toString(36)}_${seq++}`;
    for (const n of nodes) idMap.set(n.id, newId());

    const remapped = nodes.map(n => ({ ...n, id: idMap.get(n.id)!, parentId: n.parentId ? (idMap.get(n.parentId) ?? null) : n.parentId }));
    // parentId 指向被剥/悬空 → null（与 cells 同语义降级，勿一条抛一条兜）
    const remappedEdges = edges
      .filter(e => idMap.has(e.source) && idMap.has(e.target))
      .map(e => ({ ...e, source: idMap.get(e.source)!, target: idMap.get(e.target)! }));

    for (const n of remapped) {
      if (n.type !== 'group' || !Array.isArray(n.data.cells)) continue;
      n.data.cells = (n.data.cells as (string | null)[]).map(c => {
        if (c === null || c === undefined) return null;      // 空宫格占位保持 null
        if (droppedIds.has(c)) return null;                   // 被剥槽位 → null
        const mapped = idMap.get(c);
        return mapped ?? null;                                // 悬空 id → null（禁 || c 兜底）；数组长度不变
      });
    }
    return { nodes: remapped, edges: remappedEdges };
  }
}
```

（`RawNode` 类型从 snapshot-filter.util 导入；module providers 追加 VideoWorkCloneService。）

- [ ] **Step 4: 跑绿（全部四元/白名单/超时/限流断言通过）**

Run: `pnpm --filter @flowweb/api test -- video-work-clone`
Expected: PASS

- [ ] **Step 5: Clone 端点 + 未登录 401**

controller（video-work.controller.ts）：

```ts
@Post(':id/clone')
clone(@Param('id') id: string, @Req() req: any) {
  if (!req.user?.id) throw new UnauthorizedException(); // 公开前缀下 optional auth（D4）
  return this.cloneService.clone(id, req.user.id);
}
```

controller spec 追加（providers 自 Task 3.2 创建即含 cloneService mock（签名一次到位，第七轮）——从 moduleRef 取实例断言）：

```ts
it('POST :id/clone 未登录 req 无 user → 401', async () => {
  await expect(controller.clone('w1', { /* req 无 user */ } as any)).rejects.toThrow(UnauthorizedException);
});

it('POST :id/clone 登录 → 调 cloneService.clone(id, userId)', async () => {
  const cloneSvc = moduleRef.get(VideoWorkCloneService); // moduleRef 已在 Task 3.2 提升到 describe 作用域（第十一轮落实——原"提升即可"只活在注释，局部 const 到不了本用例是 TS2304）
  await controller.clone('w1', { user: { id: 'u1' } } as any);
  expect(cloneSvc.clone).toHaveBeenCalledWith('w1', 'u1');
});
```

Template 不参与（上方用例已断言 `prisma.template.count` 未被调用——比"静态检查 import"强，满足 spec §7.7"Template 行数与 importCount 不变"；第八轮升级）。

- [ ] **Step 6: 批次 5-6 全量回归 + Commit**

```bash
pnpm --filter @flowweb/api test
git add apps/api/src/modules/video-work/
git commit -m "feat(video-work): 批次6 克隆（共用白名单/四元重映射禁兜底/status idle/整体超时/每用户限流）"
```

---

## 批次 7：前端列表页（/videos）

### Task 7.1: videoWorkApi.ts（含 /flowai 改写）

**Files:**
- Create: `apps/web/src/api/videoWorkApi.ts`

- [ ] **Step 1: 实现（api 封装无独立测试对象——由页面测试覆盖；/flowai 改写函数在本文件复制同款正则，**不**从 mediaApi 提取共用——第八轮裁定=C2 原案：提取会动 mediaApi/批次 0 改动面，D2 孤岛原则；全仓 54 处改写均为各文件自持同款正则）**

照 `apps/web/src/api/mediaApi.ts:6` 的改写正则在本文件复制同一行：

```ts
import { apiFetch } from './client';
import type {
  VideoWorkListResult, VideoWorkDetail, VideoCategoryItem, ProcessSnapshotData, VideoWorkSettings,
} from '@flowweb/shared'; // 以 web 侧 shared 导入别名为准（grep 既有 import 方式）

/** /flowai 同源改写（视频 seek 依赖同源拿 Content-Range、img 避 CORS——mediaApi.ts:6 同款） */
export const toFlowaiUrl = (url: string) => url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai');

export async function fetchVideoWorks(params: { categoryId?: string; page?: number; pageSize?: number } = {}): Promise<VideoWorkListResult> {
  const q = new URLSearchParams();
  if (params.categoryId) q.set('categoryId', params.categoryId);
  q.set('page', String(params.page ?? 1));
  q.set('pageSize', String(params.pageSize ?? 20));
  const r = await apiFetch<VideoWorkListResult>(`/video-works?${q.toString()}`); // 第九轮：显式类型参——apiFetch<T> 无推断位，裸调用 T=unknown，下方 r.items 是 TS2571
  // 列表封面也过 /flowai（spec §5.4"沿用同一改写函数"——dev 下 MINIO_ENDPOINT=127.0.0.1:9000 直连碰巧能显示，
  // 生产 presign URL 是内网地址不可达、列表封面全裂；第八轮补，原只改写了详情/快照）
  return { ...r, items: r.items.map(it => ({ ...it, coverUrl: it.coverUrl ? toFlowaiUrl(it.coverUrl) : null })) };
}

export async function fetchVideoCategories(): Promise<VideoCategoryItem[]> {
  return apiFetch('/video-works/categories');
}

export async function fetchVideoWorkDetail(id: string): Promise<VideoWorkDetail> {
  const d = await apiFetch<VideoWorkDetail>(`/video-works/${id}`); // 显式类型参（同上，第九轮）
  return { ...d, videoUrl: toFlowaiUrl(d.videoUrl), coverUrl: d.coverUrl ? toFlowaiUrl(d.coverUrl) : null };
}

export async function recordView(id: string): Promise<void> {
  apiFetch(`/video-works/${id}/view`, { method: 'POST' }).catch(() => {}); // 计数失败静默
}

export async function toggleLike(id: string): Promise<{ liked: boolean; likeCount: number }> {
  return apiFetch(`/video-works/${id}/like`, { method: 'POST' });
}

export async function fetchProcessSnapshot(id: string): Promise<ProcessSnapshotData> {
  const snap = await apiFetch<ProcessSnapshotData>(`/video-works/${id}/process`); // 显式类型参（同上，第九轮）
  for (const n of snap.nodes) {
    if (typeof n.data.thumbnailUrl === 'string') n.data.thumbnailUrl = toFlowaiUrl(n.data.thumbnailUrl);
  }
  return snap;
}

export async function cloneWork(id: string): Promise<{ projectId: string }> {
  return apiFetch(`/video-works/${id}/clone`, { method: 'POST' });
}

/** 公开轮播设置（第八轮自 Task 8.3 前移至此——Task 7.3 测试已 mock 该导出，automock 下缺失导出是同步 TypeError） */
export async function getPublicSettings(): Promise<VideoWorkSettings> {
  return apiFetch('/video-works/settings');
}
```

- [ ] **Step 2: 编译验证 + Commit**

```bash
pnpm --filter @flowweb/web exec tsc -b   # 第九轮：原 "tsc -b --dry || build" 是空跑——--dry 只列工程不做检查且退出 0；第十轮统一为 tsc -b（build 的类型半边）
git add apps/web/src/api/videoWorkApi.ts
git commit -m "feat(video-work): 批次7 videoWorkApi（/flowai 改写同款复制）"
```

### Task 7.2: VideoCard + VideosPage 列表（TDD）

**Files:**
- Create: `apps/web/src/pages/videos/VideoCard.tsx`、`VideosPage.tsx`
- Test: `apps/web/src/pages/videos/__tests__/VideosPage.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideosPage } from '../VideosPage';
import * as api from '@/api/videoWorkApi';
import type { VideoWorkListResult } from '@flowweb/shared';

vi.mock('@/api/videoWorkApi');

const listResult: VideoWorkListResult = {
  items: [
    { id: 'w1', title: '末班地铁', coverUrl: '/flowai/c.webp', durationSec: 204, tags: ['悬疑', 'AI真人'] },
    { id: 'w2', title: 'THE TURN', coverUrl: null, durationSec: null, tags: [] },
  ],
  total: 2, page: 1, pageSize: 20,
};

describe('VideosPage（D13 卡片裁剪）', () => {
  beforeEach(() => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue(listResult);
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0 }]);
  });

  it('卡片只含 封面/时长/标题/标签——不含作者/日期/计数', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('末班地铁'));
    expect(screen.getByText('03:24')).toBeInTheDocument();      // 204s → mm:ss 角标
    expect(screen.getByText('悬疑')).toBeInTheDocument();
    // D13：不渲染作者/日期/观看/喜欢
    expect(screen.queryByText(/404_STUDIO/)).toBeNull();
    expect(screen.queryByText(/\d+月\d+/)).toBeNull();
    expect(screen.queryByText(/观看/)).toBeNull();
    expect(screen.queryByText(/♥/)).toBeNull();
  });

  it('无封面占位、null 时长无角标', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByText('THE TURN'));
    expect(screen.queryByText('00:00')).toBeNull();
  });

  it('类型 tab 含"全部"+数据项', async () => {
    render(<MemoryRouter><VideosPage /></MemoryRouter>);
    await waitFor(() => screen.getByRole('tab', { name: 'AI真人影视' }));
    expect(screen.getByRole('tab', { name: '全部' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑红**

Run: `pnpm --filter @flowweb/web test -- VideosPage`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

```tsx
// VideoCard.tsx（D13：只有封面+时长+标题+标签）
import { Link } from 'react-router';
import type { VideoWorkListItem } from '@flowweb/shared';

const fmtDuration = (sec: number | null) => {
  if (sec == null) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export function VideoCard({ work }: { work: VideoWorkListItem }) {
  const duration = fmtDuration(work.durationSec);
  return (
    <Link to={`/videos/${work.id}`} state={{ fromList: true }} data-card className="block rounded-lg overflow-hidden border border-[var(--vw-card-border)] hover:border-[var(--vw-card-border-hover)] transition-colors bg-[var(--vw-card-bg)] box-border">
      {/* 第七轮：补 state:{fromList:true}（C2 M4——否则关闭算法死代码）+ 改用 Task 7.3 登记的 --vw-* token（原硬编码使 token 成死变量） */}
      <div className="relative aspect-video bg-[#262626]">
        {work.coverUrl
          ? <img src={work.coverUrl} alt={work.title} className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-white/30 text-sm">暂无封面</div>}
        {duration && (
          <span className="absolute right-1.5 bottom-1.5 bg-black/70 text-white text-[11px] rounded px-1 py-px" data-testid="duration">
            {duration}
          </span>
        )}
      </div>
      <div className="p-2.5 box-border">
        <div className="text-[13px] font-medium text-white truncate">{work.title}</div>
        {work.tags.length > 0 && (
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            {work.tags.map(t => (
              <span key={t} className="text-[11px] px-1.5 py-px rounded bg-white/10 text-white/70">{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
```

```tsx
// VideosPage.tsx（列表 + 类型 tab + 分页 + :id? 驱动 Modal——Modal 在批次 8 挂载）
import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { Pagination, Tabs } from 'antd';
// EmptyState/CardGridSkeleton 是 workspace 私有组件不复用（C1-4/C2 Task 7.2）——骨架/空态内联
import { fetchVideoWorks, fetchVideoCategories } from '@/api/videoWorkApi';
import type { VideoWorkListItem, VideoCategoryItem } from '@flowweb/shared';
import { VideoCard } from './VideoCard';

export function VideosPage() {
  const { id: activeWorkId } = useParams();           // 单路由 /videos/:id? 驱动 Modal（Task 8.1 挂载 <VideoPlayerModal /> 后此解构删除——组件内部自取）
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryId = searchParams.get('categoryId') ?? undefined;
  const page = Number(searchParams.get('page') ?? 1);

  const [items, setItems] = useState<VideoWorkListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<VideoCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchVideoCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    fetchVideoWorks({ categoryId, page, pageSize: 20 })
      .then(r => { setItems(r.items); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [categoryId, page]);

  const onTabChange = useCallback((key: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (key === 'all') next.delete('categoryId'); else next.set('categoryId', key);
      next.delete('page');
      return next;
    });
  }, [setSearchParams]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto box-border">
      <Tabs
        activeKey={categoryId ?? 'all'}
        onChange={onTabChange}
        items={[{ key: 'all', label: '全部' }, ...categories.map(c => ({ key: c.id, label: c.name }))]}
      />
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-video rounded-lg bg-white/5 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center text-white/40 text-sm">暂无作品</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {items.map(w => <VideoCard key={w.id} work={w} />)}
        </div>
      )}
      {!loading && total > 20 && (
        <div className="flex justify-center mt-6">
          <Pagination current={page} total={total} pageSize={20}
            onChange={p => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('page', String(p)); return n; })} />
        </div>
      )}
      {/* 批次 8：<VideoPlayerModal workId={activeWorkId} /> 在此挂载 */}
    </div>
  );
}
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideosPage
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次7 列表页（D13 卡片裁剪/tab/分页/骨架屏）"
```

### Task 7.3: 路由 + Sidebar + token + 不重挂用例

**Files:**
- Modify: `apps/web/src/router.tsx`（公开组 + lazy）、`apps/web/src/components/layout/Sidebar.tsx:12-17`、`apps/web/src/index.css`（新 token）
- Test: `apps/web/src/pages/videos/__tests__/route.integration.test.tsx`

- [ ] **Step 1: 写失败测试（单路由不重挂——D5 承重墙 + admin 路由存在性）**

```tsx
import { render, waitFor, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, it, expect, vi } from 'vitest';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 真实页面（第六轮：VideosPageStub 全文未定义是 TS2304/ReferenceError——本任务页面尚无 Modal，断言照样成立；批次 8 挂载 Modal 后本用例回归仍须保持绿）

vi.mock('@/api/videoWorkApi');
// 第十一轮（B4）：批次 8 挂载 Modal 后 navigate('/videos/w1') 渲染真实 PlayView，其首行 useAuth() 解构
// createContext(null!)（AuthProvider.tsx:25）裸值即 TypeError——本文件注释自称"批次 8 后回归须保持绿"却缺 C5 模板
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));

// 路由不重挂：Modal 开关前后列表 API 只调 1 次
it('Modal 开关前后 fetchVideoWorks 仅调用 1 次（断言点在动画后）', async () => {
  vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [{ id: 'w1', title: 'T', coverUrl: null, durationSec: 1, tags: [] }], total: 1, page: 1, pageSize: 20 });
  vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue({ id: 'w1', title: 'T', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null, viewCount: 0, likeCount: 0, liked: false, description: null, authorName: 'a', publishedAt: '2026-09-01', width: null, height: null, canViewProcess: false, canClone: false, durationSec: 1, tags: [] } as any);
  // 第七轮 F2：批次 8 挂载 Modal 后这两项必须 mock——getPublicSettings 返回 undefined 是同步 TypeError
  // （automock 无实现）；且必须关轮播（enabled:false）——否则 CarouselBar 复用列表端点（pageSize=11）
  // 第二次调用 fetchVideoWorks 会击穿 toHaveBeenCalledTimes(1)
  vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: false, carouselScope: 'all' });
  vi.mocked(api.recordView).mockResolvedValue(undefined);

  const router = createMemoryRouter([
    { path: '/videos/:id?', element: <VideosPage /> },
  ], { initialEntries: ['/videos'] });
  render(<RouterProvider router={router} />);

  await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1));
  await act(async () => { router.navigate('/videos/w1'); });
  await act(async () => { router.navigate('/videos'); });
  expect(api.fetchVideoWorks).toHaveBeenCalledTimes(1); // 不重挂 → 不重取
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

router.tsx 公开组追加（**lazy**，spec §5.1；与既有 lazy 页面写法一致——grep `lazy(` 参照）：

```tsx
const VideosPage = lazy(() => import('./pages/videos/VideosPage').then(m => ({ default: m.VideosPage })));
// 公开组 children 追加（第七轮：lazy 元素必须自带 Suspense 边界——AppLayout 无 Suspense、公开组现有 3 条路由全是
// 静态 import、react-router 7 SPA 不提供隐式边界 → 不包则 /videos 直链首屏 chunk 加载期间整个 root 无 fallback 白屏；
// 照抄 router.tsx:22-24 AdminLazy 同款）：
{ path: '/videos/:id?', element: <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}><VideosPage /></Suspense> },   // 可选参数单路由（防两条平级路由整页重挂）
```

Sidebar.tsx NAV_ITEMS 在「模板广场」后插入（D14）：

```tsx
{ label: '视频作品', href: '/videos', icon: <VideoCameraOutlined /> }, // icon 从 @ant-design/icons 导入
```

index.css 追加本功能 token（§6：显式定义并登记）：

```css
:root {
  --vw-card-bg: #1e1e1e;        /* 作品卡面 */
  --vw-card-border: rgba(255,255,255,0.10);
  --vw-card-border-hover: rgba(255,255,255,0.25);
}
```

- [ ] **Step 4: 跑绿 + 既有路由/Sidebar 测试回归（Sidebar.test 无计数断言应全绿）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
pnpm --filter @flowweb/web exec tsc -b   # 批次收尾类型门禁（build 的类型半边，第十轮减负；11.1 跑全量 build）
git add apps/web/src/router.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/index.css apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次7 路由 /videos/:id?（lazy）+ Sidebar 模板广场后插入 + token + 不重挂用例"
```

---

## 批次 8：播放 Modal（外壳/播放视图/轮播/页内登录）

### Task 8.1: VideoPlayerModal 外壳（关闭算法 模式 A，TDD 四场景）

**Files:**
- Create: `apps/web/src/pages/videos/VideoPlayerModal.tsx`
- Modify: `apps/web/src/pages/videos/VideosPage.tsx`（挂载 Modal + 删 activeWorkId——第八轮把 C2 的执行序步骤落进本任务 Files/Steps，原只在勘误层）
- Test: `apps/web/src/pages/videos/__tests__/VideoPlayerModal.test.tsx`

- [ ] **Step 1: 写失败测试（关闭算法四场景——spec §7 前端 2）**

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 真实页面——Modal 由其内部挂载（C2 Task 8.x 执行序：本任务在 8.2/8.3/9.1/9.2 之后执行，全部真实子组件就位）。第十一轮：原 '../../VideosPage' 多一级——本文件在 pages/videos/__tests__/ 下，解析到 pages/VideosPage 不存在（同目录先例全部 ../X）

vi.mock('@/api/videoWorkApi');
vi.mock('@/components/BaseFullscreenModal', () => ({
  BaseFullscreenModal: ({ open, children }: any) => open ? <div data-testid="modal">{children}</div> : null,
}));
vi.mock('@/components/AuthProvider', () => {  // C5 模板——渲染链含 useAuth（PlayView）
  const ctx = { user: null, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() };
  return { useAuth: () => ctx };
});

const detail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };
const detailW2 = { ...detail, id: 'w2', title: '第二作品' };
const listItems = [ // 列表含 w1/w2 两卡（场景 1/4 点真实卡片进入——VideoCard 的 Link 自带 state:{fromList:true}）
  { id: 'w1', title: '末班地铁', coverUrl: null, durationSec: 100, tags: [] },
  { id: 'w2', title: '第二作品', coverUrl: null, durationSec: 90, tags: [] },
];

function renderAt(initial: string, state?: any) {
  const router = createMemoryRouter([{ path: '/videos/:id?', element: <VideosPage /> }],
    { initialEntries: initial === '/videos/w1' ? [{ pathname: '/videos/w1', state }] : [initial] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('关闭算法（模式 A：state.fromList）', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // 第十二轮 C1-6：仓内未开 clearMocks，调用历史跨用例累积——场景1 已产生 1 次 recordView，不清则场景2 的 toHaveBeenCalledTimes(1) 拿到 2（clearAllMocks 只清记录，下方 mockResolvedValue 随即重新声明）
    vi.mocked(api.fetchVideoWorkDetail).mockImplementation(async (id: string) => (id === 'w2' ? detailW2 : detail) as any);
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: listItems, total: 2, page: 1, pageSize: 20 }); // 列表+轮播同源（轮播 pageSize=11 同端点）
    vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
    vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' }); // 轮播渲染依赖（Task 8.3）
    vi.mocked(api.recordView).mockResolvedValue(undefined);
  });

  it('场景1 列表进入 → 关闭 navigate(-1) 回列表', async () => {
    const router = renderAt('/videos');
    fireEvent.click(await screen.findByText('末班地铁')); // 真实卡片 Link（state:{fromList:true}）
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景2 直链进入（无 state）→ 关闭 replace 到 /videos；view 埋点仅打开时 1 次（spec §7 前端8——第十一轮补断言）', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('modal'));
    expect(api.recordView).toHaveBeenCalledTimes(1); // 单点埋点（打开 Modal 时）；effect 依赖写错（缺 id/每 render 重跑）会变 2+ → 红
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
    expect(api.recordView).toHaveBeenCalledTimes(1); // 关闭不再触发
  });

  it('场景3 直链→轮播(继承 null state)→关闭 → 落 /videos 不退出站点', async () => {
    const router = renderAt('/videos/w1');
    await waitFor(() => screen.getByTestId('carousel-item-w2')); // 轮播出现（列表过滤掉 w1 后剩 w2）
    fireEvent.click(screen.getByTestId('carousel-item-w2')); // 轮播切换 replace+location.state 继承
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景4 列表→轮播(继承 fromList)→关闭 → 回列表而非上一作品', async () => {
    const router = renderAt('/videos');
    fireEvent.click(await screen.findByText('末班地铁'));
    await waitFor(() => screen.getByTestId('carousel-item-w2'));
    fireEvent.click(screen.getByTestId('carousel-item-w2'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/w2'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
  });

  it('场景5 列表带 ?page=2&categoryId=x 进入 → 关闭后查询串仍在（模式 A 与朴素 replace 的唯一可测差异）', async () => {
    const router = renderAt('/videos?page=2&categoryId=x');
    fireEvent.click(await screen.findByText('末班地铁'));
    await waitFor(() => screen.getByTestId('modal'));
    fireEvent.click(screen.getByTestId('close-btn'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/videos'));
    expect(router.state.location.search).toBe('?page=2&categoryId=x'); // navigate(-1) 保留查询串；replace 会丢
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现外壳**

```tsx
// VideoPlayerModal.tsx（外壳：路由驱动开关 + 关闭算法 + 视图切换）
import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ConfigProvider, App as AntdApp } from 'antd';
import { BaseFullscreenModal } from '@/components/BaseFullscreenModal';
import { LoginModal } from '@/components/auth/LoginModal';
import { fetchVideoWorkDetail, recordView } from '@/api/videoWorkApi';
import type { VideoWorkDetail } from '@flowweb/shared';
import { PlayView } from './PlayView';          // Task 8.2
import { ProcessView } from './ProcessView';    // Task 9.2
import { CarouselBar } from './CarouselBar';    // Task 8.3

/** 弹层 z 基座（第十一轮 S2 引入、第十二轮口径修正）：token 与 data-zprovider 锚点同源——Task 8.4 断言锚点值为
 *  字面量 '100000'，**改本常量即红**（值耦合，这是该断言真正钉住的东西）。ConfigProvider/AntdApp 均为 context
 *  组件无 DOM 痕迹，"Provider 包裹存在"那半边 jsdom 不可测（删层重写时若保留锚点 div，断言仍绿）——层叠正确性
 *  由浏览器手工验收 #6 兜底（C7-B5"注释+手工验收"防线），勿声称"删层即红" */
const VIDEO_MODAL_Z_BASE = 100000;

export function VideoPlayerModal() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<VideoWorkDetail | null>(null);
  const [view, setView] = useState<'play' | 'process'>('play');
  const [showLogin, setShowLogin] = useState(false);   // Task 8.4 页内登录（D18）
  const shellRef = useRef<HTMLDivElement | null>(null); // 弹层容器（getPopupContainer，C1-3 两层配方）

  useEffect(() => {
    if (!id) { setDetail(null); setView('play'); return; }   // id 消失 → 关闭并复位
    setDetail(null); setView('play');
    fetchVideoWorkDetail(id).then(setDetail).catch(() => navigate('/videos', { replace: true })); // 404 → 回列表
    recordView(id);                                          // view 单点埋点（打开时，D15）
  }, [id]);

  /** 关闭算法（模式 A）：fromList → navigate(-1)；否则 replace /videos。
   *  首行 Esc 守卫是承重机制（C1-3 第七轮措辞修正）：焦点不在登录框内时 Esc 事件不经 rc-dialog 的
   *  wrapper 节点、直达 document 触发壳关闭——无守卫时关掉的是整个播放 Modal；守卫使该场景只关登录层 */
  const close = useCallback(() => {
    if (showLogin) { setShowLogin(false); return; } // 登录层开着 → 只关登录层（Task 8.4 接入 state）
    if ((location.state as any)?.fromList) navigate(-1);
    else navigate('/videos', { replace: true });
  }, [location.state, navigate, showLogin]);

  if (!id || !detail) return null;

  return (
    <BaseFullscreenModal open onClose={close} label="视频作品预览" closeOnBackdrop={false}>
      {/* 弹层作用域两层配方（C1-3 第七轮措辞修正）：getPopupContainer 进壳 + AntdApp component={false}
          照抄 VideoEditorShell.tsx:136-141 结构；⚠ zIndexPopupBase:100000 是本 plan 新增层（先例没有——其弹层从不落
          body 故不需要），勿删：shellRef 未挂载首帧 getPopupContainer 回退 body 时，它是登录框可见性
          （100100 > 壳 100000）的唯一保障（删掉则 11100 < 100000 被壳盖住，jsdom 测不出、手工验收 #6 才暴露）。
          PlayView/ProcessView 的 useApp() toast 依赖内层 AntdApp（holder 渲染在壳 DOM 内） */}
      <div ref={shellRef} className="fixed inset-0 bg-black text-white">
      {/* 第六轮：fixed inset-0（VideoEditorShell.tsx:132 同款）——BaseFullscreenModal 的 dialog 包装 div 无尺寸类，
          relative h-full 的百分比在 auto 高度父级上解析为 auto → 壳内容塌成 0 高度（jsdom 无布局测不出，手工验收 #3 才暴露；
          壳内 PlayView/CarouselBar/关闭钮全是绝对定位不贡献静态高度，必须由视口尺寸的内含块撑起） */}
        <ConfigProvider theme={{ token: { zIndexPopupBase: VIDEO_MODAL_Z_BASE } }} getPopupContainer={() => shellRef.current ?? document.body}>
          <AntdApp component={false}>
            {/* 第十一轮 S2：data-zprovider 锚点从壳根挪进 Provider 内层并绑定 token 常量（断言钉住**值耦合**：改
                VIDEO_MODAL_Z_BASE 即红；"Provider 包裹存在"jsdom 不可测——context 组件无 DOM，层叠正确性走手工验收 #6）；
                display:contents 使锚点 div 不产生布局盒（壳内绝对定位元素的参照物仍是壳根 fixed）。 */}
            <div data-zprovider={String(VIDEO_MODAL_Z_BASE)} style={{ display: 'contents' }}>
              {view === 'play'
                ? <PlayView detail={detail} onViewProcess={() => setView('process')} onNeedLogin={() => setShowLogin(true)} onDetailRefresh={() => fetchVideoWorkDetail(detail.id).then(setDetail)} />
                : <ProcessView workId={detail.id} title={detail.title} canClone={detail.canClone} onBack={() => setView('play')} onNeedLogin={() => setShowLogin(true)} />}
              <CarouselBar currentId={detail.id} categoryId={detail.categoryId} onSwitch={(wid) =>
                navigate(`/videos/${wid}`, { replace: true, state: location.state })} />  {/* 继承 state 原值透传（§5.1） */}
              {showLogin && <LoginModal onClose={() => setShowLogin(false)} />} {/* 读最近 Provider token → z=100100；D18 */}
              <button data-testid="close-btn" onClick={close} className="absolute top-3 right-3 z-10 rounded-lg bg-[rgba(50,50,50,0.45)] px-3 py-1.5 text-sm backdrop-blur-[6px]">✕ 关闭</button>
            </div>
          </AntdApp>
        </ConfigProvider>
      </div>
    </BaseFullscreenModal>
  );
}
```

- [ ] **Step 3b: 接线 VideosPage（必做——本任务测试渲染真实 VideosPage 找 `data-testid="modal"`，不接线四场景全红；第八轮把该步骤从勘误层落进正文）**：把 Task 7.2 留下的 `{/* 批次 8：<VideoPlayerModal workId={activeWorkId} /> 在此挂载 */}` 占位注释替换为 `<VideoPlayerModal />`（组件内部自取 `useParams().id`），并删除随之无用的 `const { id: activeWorkId } = useParams();` 解构。

- [ ] **Step 4: 跑绿（按 C2 Task 8.x 执行序，本任务在 8.2/8.3/9.1/9.2 之后执行——直接集成全部真实子组件，四场景+场景5 全绿）+ 批次中段类型门禁 `pnpm --filter @flowweb/web exec tsc -b`（见下方命令块与头部铁律）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideoPlayerModal
pnpm --filter @flowweb/web exec tsc -b   # 批次 8 中段类型门禁（批次收尾在 8.4；第十轮起用 tsc -b）
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 Modal 外壳（模式A关闭算法四场景/state 原值透传）"
```

### Task 8.2: PlayView 播放视图（播放器/顶栏/喜欢/分享/onError 自愈）

**Files:**
- Create: `apps/web/src/pages/videos/PlayView.tsx`
- Test: `apps/web/src/pages/videos/__tests__/PlayView.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// 文件顶部装配（第七轮补全——原块无 harness，renderPlay/detail 全程未定义即 ReferenceError）：
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { PlayView } from '../PlayView';

vi.mock('@/api/videoWorkApi');
// C5 模板（PlayView 链上 useAuth）——vi.hoisted 与 vi.mock 平级声明
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));

const detail = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };

function renderPlay(d = detail, onDetailRefresh: Mock = vi.fn()) {
  // onError 自愈回调由外壳注入（PlayView 自身不拉详情——旧断言 fetchVideoWorkDetail 计数无法成立，第七轮改断言回调）
  render(<AntdApp><PlayView detail={d} onViewProcess={() => {}} onNeedLogin={() => {}} onDetailRefresh={onDetailRefresh} /></AntdApp>);
  return { onDetailRefresh };
}

describe('PlayView', () => {
  beforeEach(() => { vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detail as any); });

  it('顶栏：作者名 + 发布于 {publishedAt}（D13 日期定案）', async () => {
    renderPlay(detail);
    expect(screen.getByText('作者')).toBeInTheDocument();
    expect(screen.getByText(/发布于/)).toBeInTheDocument();
  });

  it('canViewProcess=false → 无「查看制作过程」按钮', () => {
    renderPlay(detail); // detail.canViewProcess=false
    expect(screen.queryByRole('button', { name: /制作过程/ })).toBeNull();
  });

  it('喜欢：liked=true 初始高亮；点击 toggle 调 API 且以响应为准', async () => {
    vi.mocked(api.toggleLike).mockResolvedValue({ liked: false, likeCount: 4 });
    renderPlay({ ...detail, liked: true });
    const btn = screen.getByRole('button', { name: /喜欢/ });
    expect(btn).toHaveAttribute('data-liked', 'true');
    fireEvent.click(btn);
    await waitFor(() => expect(api.toggleLike).toHaveBeenCalledWith('w1'));
    await waitFor(() => expect(btn).toHaveAttribute('data-liked', 'false')); // 响应为准
  });

  it('分享：clipboard 写入当前 URL + message', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); // 第七轮修语法错（原少右括号）
    renderPlay(detail);
    fireEvent.click(screen.getByRole('button', { name: /分享/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
  });

  it('视频 onError → 触发一次 onDetailRefresh 自愈（TTL 过期换新 URL；第二次 error 不再重试——第七轮加重试上限防对象已删的无限循环）', async () => {
    const { onDetailRefresh } = renderPlay(detail);
    fireEvent.click(screen.getByRole('button', { name: /立即观看/ })); // 先进入播放态——idle 态无 video 元素（C2 Task 8.2 ②）
    fireEvent.error(screen.getByTestId('video'));
    expect(onDetailRefresh).toHaveBeenCalledTimes(1);
    fireEvent.error(screen.getByTestId('video')); // 同一实例再次 error（对象已删场景）
    expect(onDetailRefresh).toHaveBeenCalledTimes(1); // retriedRef 一次性守卫
  });

  it('viewCount/likeCount 展示收进 desc-panel（C2 Task 8.2 ③——裸 /10/ 会误中无关文本）', () => {
    renderPlay(detail); // viewCount:10 likeCount:5
    const panel = screen.getByTestId('desc-panel');
    expect(panel).toHaveTextContent('10');   // 观看数
    expect(screen.getByRole('button', { name: /喜欢/ })).toHaveTextContent('5');
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// PlayView.tsx
import { useState, useCallback, useRef } from 'react';
import { App as AntdApp } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { toggleLike } from '@/api/videoWorkApi'; // fetchVideoWorkDetail 不 import——PlayView 自身不拉详情（onError 自愈由外壳 onDetailRefresh 回调注入；勿留未用导入，第八轮删）
import type { VideoWorkDetail } from '@flowweb/shared';

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function PlayView({ detail, onViewProcess, onNeedLogin, onDetailRefresh }: {
  detail: VideoWorkDetail;
  onViewProcess: () => void;
  onNeedLogin: () => void;
  onDetailRefresh: () => void; // onError 自愈回调
}) {
  const [liked, setLiked] = useState(detail.liked);
  const [likeCount, setLikeCount] = useState(detail.likeCount);
  const [playing, setPlaying] = useState(false);
  const retriedRef = useRef(false);       // 第七轮：onError 一次性自愈守卫——对象已从 MinIO 删除时防 错误→重取→新URL→再错误 无限循环
  const { message } = AntdApp.useApp();   // 壳内上下文实例（C1-3——静态 message 落 body z≈2010 被壳盖）
  const { user } = useAuth();             // isLoggedIn() 不存在（C1-4）

  const onLike = useCallback(async () => {
    if (!user) { onNeedLogin(); return; }   // D15/D18：未登录 → 页内 LoginModal（Task 8.4 接入）
    try {
      const res = await toggleLike(detail.id);      // 以响应为准
      setLiked(res.liked); setLikeCount(res.likeCount);
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else message.error('操作失败');
    }
  }, [detail.id]);

  const onShare = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    message.success('链接已复制');
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* 顶栏：作者 | 标题 …… 发布于（D13）+含 AI 生成内容 */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 md:py-6 bg-gradient-to-b from-black/60 to-transparent">
        <span className="w-7 h-7 rounded-full bg-white/20 shrink-0" />
        <span className="text-sm md:text-base">{detail.authorName}</span>
        <span className="w-px h-4 bg-white/20" />
        <span className="flex-1 truncate text-sm md:text-base">{detail.title}</span>
        <span className="hidden sm:block text-sm text-white/90">发布于 {fmtDate(detail.publishedAt)}</span>
        <span className="text-xs text-white/60">含 AI 生成内容</span>
      </div>

      {/* 视频区 */}
      <div className="flex-1 relative flex items-center justify-center">
        {playing ? (
          <video data-testid="video" src={detail.videoUrl} controls autoPlay playsInline
            className="h-full w-full object-contain"
            onError={() => { if (!retriedRef.current) { retriedRef.current = true; onDetailRefresh(); } }} />
        ) : (
          <div className="flex items-center gap-3">
            <button onClick={() => setPlaying(true)} aria-label="立即观看"
              className="h-9 md:h-10 rounded-full bg-white text-[#171717] px-5 text-sm font-semibold hover:bg-white/90">▶ 立即观看</button>
            {detail.canViewProcess && (
              <button onClick={onViewProcess} aria-label="查看制作过程"
                className="h-9 md:h-10 rounded-full bg-[rgba(50,50,50,0.45)] px-4 text-sm backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)]">⌗ 查看制作过程</button>
            )}
            <button onClick={onLike} aria-label="喜欢" data-liked={liked}
              className={`h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px] hover:bg-[rgba(30,30,30,0.45)] ${liked ? 'text-[#4ade80]' : ''}`}>
              ♥<span className="ml-1 text-xs">{likeCount}</span>
            </button>
            <button onClick={onShare} aria-label="分享"
              className="h-9 w-9 md:h-10 md:w-10 rounded-full bg-[rgba(50,50,50,0.45)] backdrop-blur-[6px]">⇪</button>
          </div>
        )}
      </div>

      {/* 简介浮层（常显，§6）：简介 + 标签 + 观看数。data-testid 供计数断言收窄（C2 Task 8.2 ③——`/10/` 会误中无关文本） */}
      <div data-testid="desc-panel" className="px-4 md:px-8 pb-2 max-w-[420px] text-xs text-white/75 leading-relaxed">
        {detail.description}
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {detail.tags.map(t => <span key={t} className="px-1.5 py-px rounded bg-white/15 text-[11px]">{t}</span>)}
          <span className="text-white/50">观看 {detail.viewCount}</span>
        </div>
      </div>
    </div>
  );
}
```

（onLike 判登录用 `const { user } = useAuth()`（C1-4，isLoggedIn 不存在）；Modal 外壳的 onDetailRefresh 重新 fetch 详情并 setDetail；PlayView 渲染在外壳内层 AntdApp 之下，useApp() toast 可见（C1-3）。）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- PlayView
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 播放视图（发布于 publishedAt/喜欢响应为准/分享/onError 自愈）"
```

### Task 8.3: CarouselBar（设置驱动 + replace 切换）

**Files:**
- Create: `apps/web/src/pages/videos/CarouselBar.tsx`
- Test: `apps/web/src/pages/videos/__tests__/CarouselBar.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// 第八轮补 harness（原块无 import 头——照抄即 ReferenceError；CarouselBar 不用 useAuth，无需 AuthProvider mock）：
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest'; // 第十二轮：删未用的 beforeEach 导入（本文件靠 renderBar 首行清理）
import * as api from '@/api/videoWorkApi';
import { CarouselBar } from '../CarouselBar';

vi.mock('@/api/videoWorkApi');

// renderBar helper 必须显式 mock getPublicSettings——组件内部自取设置，漏 mock 时 auto-mock 返回
// undefined → getPublicSettings() 返回 undefined、.then 是同步 TypeError（.catch 接不到同步 throw）→ 用例以 unhandled error 红
function renderBar(settings: { carouselEnabled: boolean; carouselScope: 'all' | 'category' }, currentId = 'w0', categoryId: string | null = null) {
  vi.clearAllMocks(); // 第十二轮 C1-6/S1：未清记录时 null 降级用例的 mock.calls[0] 是上一用例（scope=all）留下的调用——断言恒绿（假防线）。清记录保实现，下方 getPublicSettings 随即重新声明
  vi.mocked(api.getPublicSettings).mockResolvedValue(settings as any);
  const onSwitch = vi.fn();
  render(<CarouselBar currentId={currentId} categoryId={categoryId} onSwitch={onSwitch} />);
  return { onSwitch };
}

describe('CarouselBar', () => {
  it('carouselEnabled=false → 不渲染', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: false, carouselScope: 'all' });
    await waitFor(() => expect(screen.queryByTestId('carousel')).toBeNull());
  });
  it('scope=all：请求不带 categoryId；过滤当前作品；最多 10 条', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: Array.from({ length: 11 }, (_, i) => ({ id: `w${i}`, title: `t${i}`, coverUrl: null, durationSec: 1, tags: [] })), total: 11, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    await waitFor(() => screen.getByTestId('carousel'));
    expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 11 })); // 11 条再过滤（§4.2）
    expect(screen.getAllByTestId(/^carousel-item-/)).toHaveLength(10);
  });
  it('scope=category：带当前作品 categoryId', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'category' }, 'w1', 'cat9');
    await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat9' })));
  });

  it('scope=category 且当前作品 categoryId=null → 降级 all（不带 categoryId——第十一轮补：原标题声称覆盖 null 分支但用例只传了 cat9）', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 11 });
    renderBar({ carouselEnabled: true, carouselScope: 'category' }, 'w1', null);
    await waitFor(() => expect(api.fetchVideoWorks).toHaveBeenCalled());
    expect(api.fetchVideoWorks.mock.calls[0][0].categoryId).toBeUndefined(); // 实现 categoryId ?? undefined——降级全量
  });
  it('点击切换调 onSwitch（第六轮落地——原为空壳用例）', async () => {
    vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [
      { id: 'w0', title: 't0', coverUrl: null, durationSec: 1, tags: [] },
      { id: 'w2', title: 't2', coverUrl: null, durationSec: 1, tags: [] },
    ], total: 2, page: 1, pageSize: 11 });
    const { onSwitch } = renderBar({ carouselEnabled: true, carouselScope: 'all' }, 'w0');
    fireEvent.click(await screen.findByTestId('carousel-item-w2'));
    expect(onSwitch).toHaveBeenCalledWith('w2');
  });
});
```

（设置来自 admin settings 的公开读取——**公开端点需返回轮播设置**：在 GET /api/video-works/categories 同域追加或在列表响应附 settings。**实施决定**：公开端点 `GET /api/video-works/settings`（无需鉴权的两个运营开关，非敏感）——service 复用 getSettings()，controller 静态段追加一行，测试一条。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// CarouselBar.tsx
import { useEffect, useState } from 'react';
import { fetchVideoWorks } from '@/api/videoWorkApi';
import { getPublicSettings } from '@/api/videoWorkApi'; // 新增：GET /api/video-works/settings
import type { VideoWorkListItem, VideoWorkSettings } from '@flowweb/shared';

export function CarouselBar({ currentId, categoryId, onSwitch }: {
  currentId: string; categoryId: string | null; onSwitch: (workId: string) => void;
}) {
  const [settings, setSettings] = useState<VideoWorkSettings | null>(null);
  const [all, setAll] = useState<VideoWorkListItem[]>([]); // 存全量——渲染期派生过滤（C2 Task 8.3 第五轮：勿把 currentId 放请求依赖也勿用 ref，取数/筛选分离）

  useEffect(() => { getPublicSettings().then(setSettings).catch(() => setSettings({ carouselEnabled: true, carouselScope: 'all' })); }, []);
  useEffect(() => {
    if (!settings?.carouselEnabled) return;
    fetchVideoWorks({
      categoryId: settings.carouselScope === 'category' ? (categoryId ?? undefined) : undefined, // null → 降级 all
      page: 1, pageSize: 11,
    }).then(r => setAll(r.items)); // 11 条取回，不在此时过滤
  }, [settings, categoryId]);

  const items = all.filter(w => w.id !== currentId).slice(0, 10); // 渲染期派生：恒排除当前作品（轮播切换 currentId 变化即重算，无残留）

  if (!settings?.carouselEnabled || items.length === 0) return null;
  return (
    <div data-testid="carousel" className="absolute bottom-0 inset-x-0 flex gap-2 px-4 py-3 overflow-x-auto z-10">
      {items.map(w => (
        <button key={w.id} data-testid={`carousel-item-${w.id}`} onClick={() => onSwitch(w.id)}
          className="relative shrink-0 w-[110px] aspect-video rounded-md overflow-hidden ring-1 ring-white/20 hover:ring-white/60 transition-all">
          {w.coverUrl ? <img src={w.coverUrl} alt={w.title} className="w-full h-full object-cover" loading="lazy" />
                       : <div className="w-full h-full bg-white/10" />}
        </button>
      ))}
    </div>
  );
}
```

**API 前置已就绪（第八轮）**：`getPublicSettings()` 已在 Task 7.1 定义（Task 7.3 测试即依赖该导出——前移避免 automock 缺导出的同步 TypeError），本任务无 API 改动。后端端点第七轮已前移至 Task 3.2（公开 controller 静态段 `@Get('settings')`；声明序断言 Task 3.3 已含 getSettings），本任务纯前端。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- CarouselBar
git add apps/web/src/
git commit -m "feat(video-work): 批次8 底部轮播（设置驱动/11取10/replace 切换/降级 all）"
```

### Task 8.4: 页内 LoginModal 集成（嵌套 ConfigProvider 抬 z）

**Files:**
- Modify: `apps/web/src/pages/videos/VideoPlayerModal.tsx`（onNeedLogin 落地）
- Test: `apps/web/src/pages/videos/__tests__/LoginInModal.test.tsx`

- [ ] **Step 1: 写失败测试（jsdom 结构断言——z-index 层叠效果走浏览器手工验收，§7.5）**

```tsx
// 第八轮补 harness（原块无 import 头；渲染链经 VideosPage 含 useAuth → 需 C5 模板 AuthProvider mock。
// 若下文用例块已含相同声明则勿重复 vi.mock 同模块两次）：
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import * as api from '@/api/videoWorkApi';
import { VideosPage } from '../VideosPage'; // 第十一轮：原 '../../VideosPage' 多一级（__tests__/ 下应为 ../X，同仓全部先例）；第十二轮删未用的 AntdApp 导入（本文件 render 不包 App 组件）

vi.mock('@/api/videoWorkApi');
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
// 第九轮：automock 无 mockResolvedValue → fetchVideoWorks/fetchVideoWorkDetail 返回 undefined、.then 是同步
// TypeError（C7-F2 为 8.3 诊断的同款形态）→ Modal 永不渲染、getByRole('喜欢') 抛错。照 Task 8.1 补四件套；
// getPublicSettings 关轮播防 CarouselBar 二次调列表。
const detailFixture = { id: 'w1', title: '末班地铁', videoUrl: '/flowai/v.mp4', coverUrl: null, categoryId: null,
  viewCount: 10, likeCount: 5, liked: false, description: '简介', authorName: '作者', publishedAt: '2026-09-01T00:00:00Z',
  width: null, height: null, canViewProcess: false, canClone: false, durationSec: 100, tags: ['悬疑'] };
beforeEach(() => {
  authCtx.user = null;
  vi.mocked(api.fetchVideoWorks).mockResolvedValue({ items: [{ id: 'w1', title: '末班地铁', coverUrl: null, durationSec: 100, tags: [] }], total: 1, page: 1, pageSize: 20 });
  vi.mocked(api.fetchVideoCategories).mockResolvedValue([]);
  vi.mocked(api.fetchVideoWorkDetail).mockResolvedValue(detailFixture as any);
  vi.mocked(api.getPublicSettings).mockResolvedValue({ carouselEnabled: false, carouselScope: 'all' });
  vi.mocked(api.recordView).mockResolvedValue(undefined);
});

// 第九轮：BaseFullscreenModal 落成真 mock——原只在 Esc 用例的注释里：onCloseRef 未定义是 ReferenceError/TS2304、
// getByTestId('modal') 无来源必红。vi.hoisted 捕获 onClose（vi.mock 工厂被提升，工厂内引用外部变量必须经 vi.hoisted——C5 同款）。
const onCloseRef = vi.hoisted(() => ({ current: undefined as undefined | (() => void) }));
vi.mock('@/components/BaseFullscreenModal', () => ({
  BaseFullscreenModal: ({ open, onClose, children }: any) => {
    onCloseRef.current = onClose;
    return open ? <div data-testid="modal">{children}</div> : null;
  },
}));

// 第六轮：login-modal-root 由 mock 提供（真实 LoginModal 无此 testid——直接断言会 getByTestId 抛错）。
// mock 渲染在 JSX 原位（非 portal），closest 到 Provider 内层 data-zprovider 锚点在 DOM 上可达（第十一轮 S2）。
vi.mock('@/components/auth/LoginModal', () => ({
  LoginModal: () => <div data-testid="login-modal-root" />,
}));
// 第七轮：renderModalWithNeedLogin 在本文件内定义（原写"复用 Task 8.1 的 renderAt"——那是另一测试文件的
// 局部函数，跨文件复用不可能；本文件自建同款装配）：
function renderModalWithNeedLogin() {
  const router = createMemoryRouter([{ path: '/videos/:id?', element: <VideosPage /> }], { initialEntries: ['/videos/w1'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('播放 Modal 内页内登录', () => {
  it('onNeedLogin → 渲染 LoginModal 且在 Provider 内层（data-zprovider 锚点带 token 值）', async () => {
    renderModalWithNeedLogin(); // 本文件自建装配（真实 VideosPage）+ AuthProvider mock（user:null）
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ })); // 未登录触发
    await waitFor(() => screen.getByTestId('login-modal-root'));
    // 第十一轮 S2 引入、第十二轮口径修正：断言钉住**值耦合**——VIDEO_MODAL_Z_BASE 改值即 String(值) ≠ '100000' 红；
    // "Provider 包裹存在"jsdom 不可测（ConfigProvider/AntdApp 是 context 组件无 DOM 痕迹，删层重写保留锚点 div 仍绿），
    // 层叠正确性走浏览器手工验收 #6（spec §7 前端5 已同步此口径）。原 closest('[data-zprovider="true"]') 挂壳根，
    // 连值耦合都没有，是假防线。
    const anchor = screen.getByTestId('login-modal-root').closest('[data-zprovider]');
    expect(anchor?.getAttribute('data-zprovider')).toBe('100000');
  });

  it('Esc 守卫（承重）：登录层开着时触发壳 onClose → 只关登录层、播放 Modal 仍在（第六轮新增——否则守卫永远没有测试；第九轮：mock 从注释落成文件顶部真代码）', async () => {
    renderModalWithNeedLogin();
    fireEvent.click(screen.getByRole('button', { name: /喜欢/ }));
    await waitFor(() => screen.getByTestId('login-modal-root'));
    act(() => onCloseRef.current!()); // 壳的 Esc 路径（焦点不在登录框内时事件直达 document 的场景）
    await waitFor(() => expect(screen.queryByTestId('login-modal-root')).toBeNull()); // 登录层关
    expect(screen.getByTestId('modal')).toBeInTheDocument(); // 播放 Modal 不关
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（Modal 内登录层——第五轮：登录层不再自带 Provider，外壳已在壳根包两层 ConfigProvider+AntdApp，见 C1-3/Task 8.1 修正后的实现片段）**

```tsx
// VideoPlayerModal 内（Task 8.1 骨架已含 showLogin state/shellRef/Esc 守卫；本任务只需渲染行已就位 + 本测试）
{showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
// LoginModal 是 antd Modal：读最近 ConfigProvider token → z=100100 > 壳 100000（D18）。
// Esc 守卫在 close 回调首行（Task 8.1 已写）。（第十轮删"其内部 useApp() 解析到内层 App → toast 可见"——LoginModal 不调用 useApp/message，C1-3 第九轮已纠正同款说法）
```

- [ ] **Step 4: 跑绿；浏览器手工验收登记（批次 11 清单项）：未登录 → 播放 Modal 内点喜欢 → 登录框可见可点、Esc 先关登录框不误关播放 Modal → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- LoginInModal
pnpm --filter @flowweb/web exec tsc -b   # 批次收尾类型门禁（build 的类型半边，第十轮减负；11.1 跑全量 build）
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次8 页内登录（嵌套 ConfigProvider 抬 z，D18）"
```

---

## 批次 9：创作过程视图（ProcessSnapshot 只读渲染）

### Task 9.1: ProcessSnapshot 组件（Handle 红线/组框/纯文本，TDD）

**Files:**
- Create: `apps/web/src/pages/videos/ProcessSnapshot.tsx`
- Test: `apps/web/src/pages/videos/__tests__/ProcessSnapshot.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProcessSnapshot } from '../ProcessSnapshot';
import type { ProcessSnapshotData } from '@flowweb/shared';

const snap: ProcessSnapshotData = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫在窗台上' } },
    { id: 'n2', type: 'imageGen', position: { x: 300, y: 0 }, data: { prompt: 'cat', thumbnailUrl: '/flowai/th.webp' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n3'] } },
    { id: 'n3', type: 'videoGen', position: { x: 520, y: 20 }, parentId: 'g1', data: { label: '导出 1' } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
};

describe('ProcessSnapshot（spec §5.3 红线）', () => {
  it('每个节点渲染默认 Handle×2：.react-flow__handle 数 === nodes×2', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    const handles = container.querySelectorAll('.react-flow__handle');
    expect(handles.length).toBe(snap.nodes.length * 2);   // 缺 Handle → 边全丢（isNodeInitialized 早退静默丢弃、不报 error008——spec §5.3 第八轮措辞，plan 第九轮对齐）
  });

  it('纯文本渲染：content 含 XSS 载荷时以字面文本显示、不产生 img（第八轮：真喂载荷——旧夹具无任何 HTML 是恒真断言，"XSS 夹具"名不副实）', () => {
    const withXssPayload = { ...snap, nodes: [{ ...snap.nodes[0], data: { content: '<img src=x onerror=alert(1)>一只猫在窗台上' } }] };
    const { container, getByText } = render(<ProcessSnapshot snapshot={withXssPayload} />);
    expect(getByText('<img src=x onerror=alert(1)>一只猫在窗台上')).toBeInTheDocument(); // 字面文本整串（React 文本节点自动转义）
    expect(container.querySelectorAll('img')).toHaveLength(0); // 该 fixture 无 thumbnailUrl——出现任何 img 即 dangerouslySetInnerHTML 侧漏
  });

  it('缩略图展示：thumbnailUrl 渲染为 img', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('img[src="/flowai/th.webp"]')).toBeTruthy();
  });

  it('组框：groupType=storyboard 渲染分镜样式（data-group-type 标记）', () => {
    const { container } = render(<ProcessSnapshot snapshot={snap} />);
    expect(container.querySelector('[data-group-type="storyboard"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// ProcessSnapshot.tsx —— 零 store 依赖（§5.3 禁复用 CanvasView），只依赖 @xyflow/react + 静态数据
import { useMemo } from 'react';
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProcessSnapshotData, SnapshotNode } from '@flowweb/shared';

const TYPE_LABEL: Record<string, string> = {
  textInput: '剧本文本', imageGen: '图片生成', imageExtGen: '图片生成', videoGen: '视频生成',
  audioGen: '语音合成', multiImageGen: '分镜宫格', group: '分组', videoEdit: '视频剪辑',
};

/** 简版节点：类型图标+类型名+序号+白名单文本；Handle 红线——每节点默认 target 左 / source 右（无 id） */
function SimpleNode({ data, selected }: any) {
  const d = data as { __type: string; __label: string; content?: string; prompt?: string; thumbnailUrl?: string };
  return (
    <div className="w-[160px] rounded-lg border border-white/15 bg-[#1e1e1e] px-2.5 py-2 box-border" data-node-type={d.__type}>
      <div className="text-[11px] font-semibold text-white/80">{d.__label}</div>
      {d.thumbnailUrl && <img src={d.thumbnailUrl} alt="" className="mt-1 w-full aspect-video object-cover rounded" loading="lazy" />}
      {typeof d.content === 'string' && d.content && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.content}</div>}
      {typeof d.prompt === 'string' && d.prompt && <div className="mt-1 text-[11px] text-white/60 line-clamp-3">{d.prompt}</div>}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

// 第六轮（C2 Task 9.1 定案落地）：group **不走 RF 内置 group 类型**——内置 GroupNode 渲染 null、无 Handle，
// handles===nodes×2 断言必红且连组边静默消失。自定义 GroupFrame 注册覆盖（v12 允许）。
function GroupFrame({ data }: any) {
  return (
    <div data-group-type={String((data as any).__groupType ?? 'normal')}
      className="w-full h-full min-h-[120px] rounded-xl border border-dashed border-white/25 bg-white/5 box-border">
      <div className="px-2 py-1 text-[11px] text-white/50">{String((data as any).__name ?? '')}</div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { simple: SimpleNode, group: GroupFrame };

export function ProcessSnapshot({ snapshot }: { snapshot: ProcessSnapshotData }) {
  const { nodes, edges } = useMemo(() => {
    const seqByType: Record<string, number> = {};
    const ns: Node[] = snapshot.nodes.map((n: SnapshotNode) => {
      const seq = (seqByType[n.type] = (seqByType[n.type] ?? 0) + 1);
      const isGroup = n.type === 'group';
      return {
        id: n.id,
        type: isGroup ? 'group' : 'simple',
        position: n.position,
        width: n.width, height: n.height,
        parentId: n.parentId ?? undefined,
        // 白名单字段名是 groupType/name——不会自己变成 __groupType/__name，必须显式映射（漏映射则 data-group-type 恒 'normal'）
        data: isGroup
          ? { __groupType: n.data.groupType, __name: n.data.name, __label: `${TYPE_LABEL[n.type] ?? n.type} ${seq}` }
          : { ...n.data, __type: n.type, __label: `${TYPE_LABEL[n.type] ?? n.type} ${seq}` },
      } as Node;
    });
    const es: Edge[] = snapshot.edges.map(e => ({ id: e.id, source: e.source, target: e.target }));
    return { nodes: ns, edges: es };
  }, [snapshot]);

  return (
    <div className="h-full w-full" data-testid="process-snapshot">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnDrag zoomOnScroll fitView fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#3a3a3a" />
      </ReactFlow>
    </div>
  );
}
```

（组框定案见上方实现与 C2 Task 9.1：自定义 GroupFrame（含双 Handle + data-group-type + __name 标题）覆盖内置 group——内置渲染 null 无 Handle。若覆盖内置类型后行为异常，类型名换非保留名 'vwGroup'（nodes 映射同步），测试断言的是 data-group-type 而非类型字符串、零测试改动。jsdom 边界：勿断言 `.react-flow__edge` 路径/handle bounds——test-setup 的 ResizeObserver 是空实现、jsdom 25 无 DOMMatrix，测量路径不跑；Handle 计数 + data-group-type 结构断言 + 浏览器手工验收 #8 的分工不变。）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- ProcessSnapshot
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次9 只读快照渲染（Handle 红线×2/组框/纯文本/缩略图）"
```

### Task 9.2: ProcessView 集成（顶栏/复制项目/打开画布）

**Files:**
- Create: `apps/web/src/pages/videos/ProcessView.tsx`
- Test: `apps/web/src/pages/videos/__tests__/ProcessView.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// 文件顶部装配（第八轮补全 harness）：import 头 + api mock + AuthProvider mock（C5 模板）+
// 本文件自有 snap fixture（原引用 Task 9.1 测试文件的局部 fixture，跨文件不存在）。
// ProcessView 用 useNavigate——所有 render 必须包 Router（原三处裸 render 是 invariant 抛错）。
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router';
import { App as AntdApp } from 'antd';
import * as api from '@/api/videoWorkApi';
import { ProcessView } from '../ProcessView';

vi.mock('@/api/videoWorkApi');
const authCtx = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, logout: vi.fn(), refresh: vi.fn(), updateUser: vi.fn() }));
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authCtx }));
beforeEach(() => { vi.clearAllMocks(); authCtx.user = null; }); // 第十二轮 C1-6：未清记录时"未登录克隆"用例的 not.toHaveBeenCalled() 撞上一用例（克隆成功已真实调 cloneWork）残留——clearAllMocks 只清记录，各用例体内自声明 mockResolvedValue

const snap = {
  workId: 'w1', title: 't',
  nodes: [
    { id: 'n1', type: 'textInput', position: { x: 0, y: 0 }, data: { content: '一只猫' } },
    { id: 'g1', type: 'group', position: { x: 500, y: 0 }, data: { groupType: 'storyboard', cells: ['n1'] } },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'g1' }],
} as any;

describe('ProcessView', () => {
  it('顶栏：作品标题 + 返回 + 复制项目按钮（canClone=false 不渲染）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={false} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    expect(screen.queryByRole('button', { name: /复制项目/ })).toBeNull();
  });

  it('克隆成功 → toast + 「打开画布」跳 /canvas?projectId=（先例 WorkspaceDimension.tsx:93）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any); // 第十一轮：原靠上一用例的 mock 实现残留才绿（Vitest 默认不 reset 实现）——-t 单跑/换序即 .then undefined 同步 TypeError
    vi.mocked(api.cloneWork).mockResolvedValue({ projectId: 'new-p' });
    const router = createMemoryRouter([{ path: '/', element: <ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /> }], { initialEntries: ['/'] });
    render(<AntdApp><RouterProvider router={router} /></AntdApp>); // AntdApp 必包——克隆成功路径 message.success 走 useApp()，antd 默认 context 是 {message:{}} → TypeError 成 unhandled rejection（第八轮）
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ }));
    await waitFor(() => screen.getByRole('button', { name: /打开画布/ }));
    fireEvent.click(screen.getByRole('button', { name: /打开画布/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/canvas'));
    expect(router.state.location.search).toBe('?projectId=new-p'); // navigate 断言落地（第六轮，原为注释占位）
  });

  it('未登录克隆 → onNeedLogin 被调（页内 LoginModal，不跳转）（第六轮落地）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockResolvedValue(snap as any);
    const onNeedLogin = vi.fn();
    render(<MemoryRouter><AntdApp><ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={onNeedLogin} /></AntdApp></MemoryRouter>);
    await waitFor(() => screen.getByTestId('process-snapshot'));
    fireEvent.click(screen.getByRole('button', { name: /复制项目/ }));
    expect(onNeedLogin).toHaveBeenCalled();     // ctx.user=null（顶部 mock 默认）
    expect(api.cloneWork).not.toHaveBeenCalled();
  });

  it('快照 503/404 → 错误态 + 返回按钮（不白屏）', async () => {
    vi.mocked(api.fetchProcessSnapshot).mockRejectedValue(new Error('x'));
    render(<MemoryRouter><ProcessView workId="w1" title="t" canClone={true} onBack={() => {}} onNeedLogin={() => {}} /></MemoryRouter>);
    await waitFor(() => screen.getByText(/暂时无法加载/));
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```tsx
// ProcessView.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { App as AntdApp } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { fetchProcessSnapshot, cloneWork } from '@/api/videoWorkApi';
import type { ProcessSnapshotData } from '@flowweb/shared';
import { ProcessSnapshot } from './ProcessSnapshot';

export function ProcessView({ workId, title, canClone, onBack, onNeedLogin }: {
  workId: string; title: string; canClone: boolean; onBack: () => void; onNeedLogin: () => void;
}) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ProcessSnapshotData | null>(null);
  const [error, setError] = useState(false);
  const [cloned, setCloned] = useState<{ projectId: string } | null>(null);
  const { message } = AntdApp.useApp();   // 壳内上下文实例（C1-3）
  const { user } = useAuth();

  useEffect(() => {
    fetchProcessSnapshot(workId).then(setSnap).catch(() => setError(true));
  }, [workId]);

  const onClone = async () => {
    if (!user) { onNeedLogin(); return; }   // D18（isLoggedIn 不存在，C1-4）
    try {
      const res = await cloneWork(workId);
      setCloned(res);
      message.success('已克隆工作流（产物需重新生成）');
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else if (e.status === 429) message.warning('克隆太频繁，请稍后再试');
      else message.error('克隆失败');
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[#141414]">
      <div className="flex items-center gap-3 px-4 py-2 bg-[#1e1e1e] border-b border-white/10 shrink-0">
        <button onClick={onBack} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">‹ 返回</button>
        <span className="flex-1 truncate text-sm">{title} · 创作过程</span>
        {canClone && !cloned && (
          <button onClick={onClone} className="rounded-lg bg-[#4ade80] text-[#111] px-3.5 py-1.5 text-sm font-semibold hover:opacity-90">复制项目</button>
        )}
        {cloned && (
          <button onClick={() => navigate(`/canvas?projectId=${cloned.projectId}`)}
            className="rounded-lg bg-[#4ade80] text-[#111] px-3.5 py-1.5 text-sm font-semibold">打开画布</button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white/60">
            <span>暂时无法加载创作过程</span>
            <button onClick={onBack} className="rounded-lg bg-white/10 px-4 py-1.5 text-sm">返回</button>
          </div>
        ) : snap ? <ProcessSnapshot snapshot={snap} /> : <div className="h-full flex items-center justify-center text-white/40">加载中…</div>}
      </div>
    </div>
  );
}
```

（VideoPlayerModal 外壳的 ProcessView 调用补上 onNeedLogin（Task 8.1 修正版已传）；判登录与 PlayView 同源 useAuth。）

- [ ] **Step 4: 跑绿（批次 7-9 联动：外壳测试中的 ProcessView 占位换真实实现后全绿）→ Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
git add apps/web/src/pages/videos/
git commit -m "feat(video-work): 批次9 创作过程视图（复制项目/打开画布/503 容错）"
```

### Task 9.3: nodeTypes 覆盖锚定测试（shared，第八轮新增——真防线替代自指清单，裁决 B6）

**Files:**
- Create: `apps/web/src/pages/canvas/components/nodeTypes.coverage.test.tsx`（与 CanvasView.test.tsx 同级——第九轮修正路径：CanvasView 真身在 `pages/canvas/components/` 而非 `pages/canvas/`，glob 全仓仅此一处）
- Modify: `apps/web/src/pages/canvas/components/CanvasView.tsx`（nodeTypes 声明加 `export`——仅 1 词，不改任何渲染逻辑）

- [ ] **Step 1: 写失败测试**

```ts
import { it, expect } from 'vitest'; // 第九轮补：web 侧显式导入 vitest——vite-env.d.ts 只有 vite/client、无 vitest/globals 类型声明，tsc -b 门禁下 it/expect 是 TS2304（vitest run 因 globals:true 反而能过，典型"只被 build 门禁抓到"）；全仓 244 个 web 测试文件同款惯例（CanvasView.test.tsx:1）
import { nodeTypes } from './CanvasView'; // 同目录 import（先例 CanvasView.test.tsx:3）。模块级 import 无渲染副作用——canvasCollabRuntime 顶层仅 import + let（连接惰性建），CanvasView.test.tsx 已有整图 import 先例；本测试仅 import 不渲染
import { VIDEO_WORK_NODE_TYPES } from '@flowweb/shared';

it('CanvasView nodeTypes 注册表键 ⊆ shared VIDEO_WORK_NODE_TYPES（快照白名单防演进遗漏——新增节点类型未同步清单时本测试红）', () => {
  const keys = Object.keys(nodeTypes);
  expect(keys.length).toBeGreaterThanOrEqual(8); // 现状 8 键
  for (const key of keys) expect(VIDEO_WORK_NODE_TYPES).toContain(key);
});
```

- [ ] **Step 2: 跑红（nodeTypes 未导出 → TS2305 "Module has no exported member"——第十轮更正，原写 TS2306 是"文件不是模块"）→ Step 3: 实现（CanvasView.tsx 的 nodeTypes 声明加 export）**

- [ ] **Step 4: 跑绿 + web 回归（`pnpm --filter @flowweb/web test` + `pnpm --filter @flowweb/web exec tsc -b`）→ Step 5: Commit**

```bash
git add apps/web/src/pages/canvas/
git commit -m "feat(video-work): 批次9 nodeTypes 覆盖锚定（shared 清单，CanvasView/WHITELIST 双侧红线）"
```

（配套 api 侧锚定 = Task 5.1 覆盖测试已改为 import `VIDEO_WORK_NODE_TYPES` 断言 WHITELIST ⊇ 清单。防线语义：CanvasView 新增类型而 shared 未同步 → 本测试红（web 侧）；shared 有而 WHITELIST 缺 → Task 5.1 红（api 侧）。）

---

## 批次 10：Admin 前端

### Task 10.1: VideoWorksPage 作品管理（ProTable + ModalForm）

**Files:**
- Create: `apps/web/src/pages/admin/pages/VideoWorksPage.tsx`
- Modify: `apps/web/src/pages/admin/AdminLayout.tsx`（菜单项——AdminLayout 实际只有 模型管理/会员订阅/首页配置/参数配置 四项、无"内容管理"分组（AdminLayout.tsx:13-32），**直接新建顶级菜单项「视频作品」**（/admin/content/video-works））
- Modify: `apps/web/src/router.tsx`（admin 子路由追加 lazy 叶子 `content/video-works`——第十一轮补 Files 漏项：下方路由存在性断言用 `router.routes`，Files 无此项则断言红且无对应动作；照既有 admin 叶子写法：相对路径 + Suspense 包裹（router.tsx:61-68 全是相对路径，AdminLazy 边界先例 :22-24））
- Modify: `apps/web/src/api/adminApi.ts`（追加 videoWork 系列）
- Test: `apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`

- [ ] **Step 1: 写失败测试（含 admin 路由存在性——router.admin.test 覆盖缺口的自我补偿，spec §7 触点）**

```tsx
// 第八轮补 harness + renderWithProviders 定义（原块用而未定义；包装照 HomeBannersPage.test.tsx:17 内联三行）：
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'; // within——Task 10.2 tabpanel 撞名用（第十二轮 P1）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { App as AntdApp } from 'antd';
import type { ReactElement } from 'react';
import { router } from '@/router';
import { VideoWorksPage } from '../VideoWorksPage';
import { adminVideoWorkApi } from '@/api/adminApi';

vi.mock('@/api/adminApi');
const renderWithProviders = (ui: ReactElement) => render(<MemoryRouter><AntdApp>{ui}</AntdApp></MemoryRouter>);

// 第十轮：文件级 mock 复位 + 默认四件套——原各用例 mock"越界存活"且无复位（Vitest 默认不 reset），
// 调换用例顺序或 -t 单跑即露。clearAllMocks 只清调用记录不清实现；默认值供未显式 mock 的用例兜底，用例可再覆盖。
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [], total: 0 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([] as any);
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [], total: 0 } as any);
  // 第十一轮加、第十二轮修正理由：antd Tabs 懒渲染——非激活过的 pane 不挂载，未点「播放页设置」tab 时
  // CarouselSettingsCard 不存在、不调 getSettings（原"页面会拉设置"不成立）。默认值是纯防御（防实现改页面级
  // 预取、或本文件用例点过设置 tab 后其他 tab 用例回归时残留调用拿到 undefined），保留无害。
  vi.mocked(adminVideoWorkApi.getSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' });
});

// flatten 内联（router.admin.test.tsx:19-21 同款局部函数——勿 import 测试文件：连带其 vi.mock 副作用）
const flatten = (routes: any[]): any[] =>
  routes.flatMap((r) => [r, ...(r.children ? flatten(r.children) : [])]);

it('/admin/content/video-works 路由存在（router.admin.test 过滤器不覆盖 content/，自建断言；admin 子路由是相对路径——router.tsx:61-68）', () => {
  expect(flatten(router.routes).some((r: any) => r.path === 'content/video-works')).toBe(true); // 相对路径，非 '/admin/...'
});

it('作品表格列：标题/类型/状态/观看/喜欢/排序（第六轮落地——原为空壳用例）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [{
    id: 'w1', title: '末班地铁', categoryId: 'c1', status: 'PUBLISHED',
    viewCount: 10, likeCount: 5, sortOrder: 0, updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1 } as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  for (const col of ['标题', '类型', '状态', '观看', '喜欢', '排序']) expect(screen.getByText(col)).toBeInTheDocument();
  expect(screen.getByText('10')).toBeInTheDocument();  // 观看数
});

it('ModalForm 含候选下拉（candidates）/两开关/标签 tags 模式/封面控件（第六轮落地）', async () => {
  vi.mocked(adminVideoWorkApi.listCandidates).mockResolvedValue({ items: [{ id: 'm1', key: 'k', projectId: 'p1', canvasExists: true, thumbnailKey: null, durationSec: 10, width: 16, height: 9, createdAt: '2026-09-01', previewUrl: null }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('button', { name: /新增/ })); // 按钮文案钉死「新增作品」（第十一轮：≥3 字不触发 antd 两字插空格坑——写"新增"两字会变"新 增"致 /新增/ 不匹配；写"新建作品"则不含"新增"子串同样不匹配，实现侧 toolBarRender 必须用「新增作品」）
  await waitFor(() => screen.getByText(/候选视频/));
  expect(screen.getByText(/允许查看创作过程|查看制作过程/)).toBeInTheDocument(); // 两开关（allowViewProcess/allowClone）
  expect(screen.getByText(/标签/)).toBeInTheDocument();
});

it('开关联动（裁决：allowClone 依赖 allowViewProcess）——编辑已有画布作品：关 allowViewProcess → allowClone 被强制关并禁用（第九轮修正：原断言挂在"新增"空表单下——无 canvasProjectId 时两开关本来 disabled、click 是 no-op、断言恒真）', async () => {
  vi.mocked(adminVideoWorkApi.listWorks).mockResolvedValue({ items: [{
    id: 'w1', title: '末班地铁', categoryId: 'c1', status: 'PUBLISHED', canvasProjectId: 'p1',
    allowViewProcess: true, allowClone: true,
    viewCount: 10, likeCount: 5, sortOrder: 0, updatedAt: '2026-09-01T00:00:00Z',
  }], total: 1 } as any);
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([{ id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }] as any);
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([] as any);
  renderWithProviders(<VideoWorksPage />);
  await waitFor(() => screen.getByText('末班地铁'));
  fireEvent.click(screen.getByText('编辑')); // 编辑入口——role 无关查询（先例 HomeBannersPage.tsx:39 的编辑 trigger 是 <a>、role=link 非 button，第十轮更正）；ModalForm initialValues 带 canvasProjectId，两开关初始可点
  await waitFor(() => screen.getByText(/允许查看创作过程|查看制作过程/));
  expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeEnabled(); // 前置：有画布 → 初始可点（防再写空转断言）
  fireEvent.click(screen.getByRole('switch', { name: /允许查看创作过程|查看制作过程/ })); // 关闭
  expect(screen.getByRole('switch', { name: /允许克隆/ }) as HTMLButtonElement).toBeDisabled(); // 联动禁用（后端 400 校验的前端半边）
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（adminApi + 页面）**

adminApi.ts 追加（沿用该文件既有 fetch 封装风格）：

```ts
export const adminVideoWorkApi = {
  // admin 路径不带 /api（adminApi.ts:29 先例 apiFetch('/admin/node-types')）；adminFetch 不存在，一律 apiFetch（C1-1）
  listWorks: (page = 1, pageSize = 20) => apiFetch(`/admin/video-works?page=${page}&pageSize=${pageSize}`),
  createWork: (data: unknown) => apiFetch('/admin/video-works', { method: 'POST', body: JSON.stringify(data) }),
  updateWork: (id: string, data: unknown) => apiFetch(`/admin/video-works/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWork: (id: string) => apiFetch(`/admin/video-works/${id}`, { method: 'DELETE' }),
  listCandidates: (page = 1) => apiFetch(`/admin/video-works/candidates?page=${page}&pageSize=20`),
  // 唯一例外：multipart 走裸 fetch 且必须带 /api（apiFetch 硬编码 JSON Content-Type 冲掉 boundary；C1-1，先例 adminApi.ts:133-144）
  uploadCover: async (file: File): Promise<{ key: string }> => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch('/api/admin/video-works/upload-cover', { method: 'POST', body: fd, credentials: 'include' });
    const body = await res.json();
    return body.data ?? body;
  },
  listCategories: () => apiFetch('/admin/video-works/categories'),
  createCategory: (d: unknown) => apiFetch('/admin/video-works/categories', { method: 'POST', body: JSON.stringify(d) }),
  updateCategory: (id: string, d: unknown) => apiFetch(`/admin/video-works/categories/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteCategory: (id: string) => apiFetch(`/admin/video-works/categories/${id}`, { method: 'DELETE' }),
  listTags: () => apiFetch('/admin/video-works/tags'),
  createTag: (d: unknown) => apiFetch('/admin/video-works/tags', { method: 'POST', body: JSON.stringify(d) }),
  updateTag: (id: string, d: unknown) => apiFetch(`/admin/video-works/tags/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
  deleteTag: (id: string) => apiFetch(`/admin/video-works/tags/${id}`, { method: 'DELETE' }),
  getSettings: () => apiFetch('/admin/video-works/settings'),
  updateSettings: (d: unknown) => apiFetch('/admin/video-works/settings', { method: 'PUT', body: JSON.stringify(d) }),
};
```

VideoWorksPage.tsx 骨架（ProTable + ModalForm，完整字段清单，模式参照 HomeBannersPage.tsx）：

```tsx
// 核心结构（完整页面按 HomeBannersPage 模式补齐布局与上传内联逻辑）
<ProTable
  columns={[
    { title: '标题', dataIndex: 'title' },
    { title: '类型', dataIndex: 'categoryId', render: v => categoryName(v) },
    { title: '状态', dataIndex: 'status', valueEnum: { DRAFT: { text: '草稿' }, PUBLISHED: { text: '已发布' } } },
    { title: '观看', dataIndex: 'viewCount', editable: true },
    { title: '喜欢', dataIndex: 'likeCount', editable: true },
    { title: '排序', dataIndex: 'sortOrder' },
    { title: '更新时间', dataIndex: 'updatedAt', render: v => new Date(v).toLocaleString() },
    // 操作：编辑/发布/下架/删除（Popconfirm）。编辑 trigger 照 HomeBannersPage.tsx:39 先例用 <a>（role=link）——测试须用 getByText 查询，勿写 getByRole('button')（第十轮定死，消除"测试假设未规定 markup"）
  ]}
  request={async (params) => { const r = await adminVideoWorkApi.listWorks(params.current, params.pageSize); return { data: r.items, total: r.total, success: true }; }}
/>
```

ModalForm 字段（完整清单，spec §5.6）：
1. **候选视频**（ProFormSelect，request=listCandidates，fieldProps.showSearch + optionRender 缩略图预览；**canvasExists=false 项 disabled + 标注「画布已删除」**；选中后回填 videoKey/videoMediaId/canvasProjectId/durationSec/width/height/coverKey 兜底）
2. 标题（ProFormText，必填 max 200）
3. 简介（ProFormTextArea，max 2000）
4. 作者名（ProFormText，必填 max 64）
5. 类型（ProFormSelect，request=listCategories）
6. 标签（**ProFormSelect mode="tags"**，options=listTags→name，maxCount 10——标签池+自由输入 D7）
7. 封面（Upload，customRequest→uploadCover→写 coverKey；提示"留空使用视频缩略图"）
8. 排序（ProFormDigit）
9. 状态（Radio DRAFT/PUBLISHED）
10. allowViewProcess / allowClone（ProFormSwitch；**无 canvasProjectId（未选候选或候选无画布）时两开关 disabled + tooltip 提示**；**allowViewProcess 关闭时 allowClone 强制关 + disabled**（第八轮裁定：后端 400 校验（Task 2.3 assertProcessFlags）的前端半边，防保存出"可克隆不可看过程"死开关）——**第十二轮 P2-2：联动必须显式订阅**——allowClone 的 ProFormSwitch 包 `dependencies={['allowViewProcess']}`（或 ProFormDependency/Form.useWatch）后按订阅值算 disabled；**承重的是订阅本身（第十三轮精确化：dependencies 内部即包一层 ProFormDependency、依赖值变化时重跑本字段 props——订阅到位后 `disabled={!form.getFieldValue('allowViewProcess')}` 与 useWatch 两种取值写法均读到新值，不必纠结选型）**；antd Form.Item 兄弟字段值变化**不触发**本字段重渲染，裸 `form.getFieldValue('allowViewProcess')` 读陈旧值、开关联动断言停在 false；**两 Switch 显式 `aria-label`="允许查看创作过程"/"允许克隆"**——第十一轮：Form.Item label→Switch button 的 accessible name 传递仓内零先例（5 处 switch 断言全裸查询，唯一带名先例 PropertiesPanel.tsx:141 是组件自写 aria-label），测试 getByRole('switch', { name: ... }) 依赖这两个属性）
11. viewCount / likeCount（ProFormDigit，后台可调）

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test -- VideoWorksPage
git add apps/web/src/pages/admin/ apps/web/src/api/adminApi.ts
git commit -m "feat(video-work): 批次10 admin 作品管理（候选选片/两开关联动/计数可调/封面）"
```

### Task 10.2: 类型/标签管理 + 轮播设置卡片

**Files:**
- Modify: `VideoWorksPage.tsx`（页内 Tabs 第二/三个 tab）
- Modify: `apps/web/src/pages/admin/pages/__tests__/VideoWorksPage.test.tsx`（追加用例——第九轮补：renderWithProviders/mock 均在 Task 10.1 建立的该文件内，勿新开文件）

- [ ] **Step 1: 写失败测试**

```tsx
// 第六轮落地（原为空壳用例）
it('类型管理 tab：ProTable 列 name/sortOrder/active + 新增入口', async () => {
  vi.mocked(adminVideoWorkApi.listCategories).mockResolvedValue([
    { id: 'c1', name: 'AI真人影视', sortOrder: 0, active: true }, { id: 'c2', name: 'MV', sortOrder: 1, active: false },
  ] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '视频类型' }));
  await waitFor(() => screen.getByText('AI真人影视'));
  // 第十二轮 P1：rc-tabs 不卸载已激活面板（destroyInactiveTabPane 默认 false，rc-tabs@15.4.0 TabPanelList/index.js:38
  // removeOnLeave:false；TabPane.js:16 aria-hidden）——切走后作品面板仍挂载，其「排序」列头与类型表撞名、getByText 抛
  // Found multiple elements。within(激活 panel) 收敛：getByRole('tabpanel') 默认排除 aria-hidden → 唯一命中当前面板
  const panel = within(screen.getByRole('tabpanel'));
  for (const col of ['名称', '排序', '启用']) expect(panel.getByText(col)).toBeInTheDocument();
});
it('标签管理 tab：同构', async () => {
  vi.mocked(adminVideoWorkApi.listTags).mockResolvedValue([{ id: 't1', name: '悬疑', sortOrder: 0, active: true }] as any);
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '标签池' }));
  await waitFor(() => screen.getByText('悬疑'));
});
it('轮播设置卡片：开关 + 范围单选，保存调 updateSettings', async () => {
  vi.mocked(adminVideoWorkApi.getSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'all' });
  vi.mocked(adminVideoWorkApi.updateSettings).mockResolvedValue({ carouselEnabled: true, carouselScope: 'category' });
  renderWithProviders(<VideoWorksPage />);
  fireEvent.click(screen.getByRole('tab', { name: '播放页设置' }));
  // 第十一轮 S3：原 getByText(/全部作品/) 只证标签存在（initialValue 写错成 category 也绿）——radio 的 checked 才反映初值
  await waitFor(() => expect(screen.getByRole('radio', { name: /全部作品/ })).toBeChecked());
  fireEvent.click(screen.getByText(/同类型/));        // 切 scope=category
  fireEvent.click(screen.getByRole('button', { name: /保存/ })); // 按钮文案钉死「保存设置」（≥3 字不触发 antd 两字插空格——"保存"两字会变"保 存"致 /保存/ 不匹配）
  await waitFor(() => expect(adminVideoWorkApi.updateSettings).toHaveBeenCalledWith({ carouselEnabled: true, carouselScope: 'category' }));
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现（两个轻量 ProTable + 设置卡片 Form；Tabs 为新增结构——HomeBannersPage 无 Tabs 先例，可参照的只有其 ProTable/ModalForm/上传内联）**

```tsx
<Tabs items={[
  { key: 'works', label: '作品', children: <WorksTable /> },
  { key: 'categories', label: '视频类型', children: <CategoryTable /> },   // ProTable name/sortOrder/active + ModalForm CRUD
  { key: 'tags', label: '标签池', children: <TagTable /> },               // 同构
  { key: 'settings', label: '播放页设置', children: <CarouselSettingsCard /> },
]} />

// CarouselSettingsCard：**settings 加载完成后才渲染 Form（`if (!settings) return null`）**——第十二轮 m1：antd Form 无
// initialValue prop、initialValues 只在首挂载时生效，异步到达的 getSettings 数据不会让 radio 变选中（除非 form.setFieldsValue），
// 直接写 initialValues 会让 toBeChecked 初值断言红。Switch carouselEnabled + Radio.Group carouselScope(all|category)；
// 保存按钮文案钉死「保存设置」（第十一轮——两字"保存"被 antd 插空格成"保 存"，测试 /保存/ 不匹配）；保存→updateSettings→message.success
```

- [ ] **Step 4: 跑绿 + web 全量回归 → Step 5: Commit**

```bash
pnpm --filter @flowweb/web test
pnpm --filter @flowweb/web exec tsc -b   # 批次收尾类型门禁（build 的类型半边，第十轮减负；11.1 跑全量 build）
git add apps/web/src/pages/admin/
git commit -m "feat(video-work): 批次10 类型/标签管理 + 轮播设置卡片"
```

---

## 批次 11：端到端验收与部署

### Task 11.1: 全量验证 + 浏览器手工验收清单

- [ ] **Step 1: 全栈测试与构建**

```bash
pnpm --filter @flowweb/api test          # tsc + vitest（api）
pnpm --filter @flowweb/web test          # vitest（web）
pnpm --filter @flowweb/web build         # web 类型检查含在 build（X15：无独立 typecheck 脚本）
```

Expected: 全绿、零 TS 错误。

- [ ] **Step 2: 本地起服务，执行浏览器手工验收清单（逐项打勾）**

| # | 场景 | 预期 |
|---|---|---|
| 1 | 未登录打开 `/` → 打开会员弹窗 | banner 正常显示（批次 0 端到端，非默认渐变） |
| 2 | 未登录打开 `/videos` | 列表渲染：卡片仅封面/时长/标题/标签；类型 tab 切换正常 |
| 3 | 点卡片 → 全屏 Modal | Modal 弹出、URL 变 `/videos/:id`、Esc/返回钮/浏览器返回键均可关闭且回列表 |
| 4 | 直链打开 `/videos/:id` | Modal 自动弹出；关闭后落列表不退出站点 |
| 5 | 播放视频 | 进度条可拖（Range 生效）；暂停/续播正常 |
| 6 | 播放 Modal 内点喜欢（未登录） | **登录框可见可点**（z 层级正确）；Esc 先关登录框不误关播放 Modal |
| 7 | 登录后点赞/取消 | 数字 ±1；刷新后 liked 状态正确 |
| 8 | 「查看制作过程」（开关开） | 快照渲染：节点+连线齐全、组框、缩略图、纯文本（无 HTML 标签） |
| 9 | 创作过程 → 复制项目 | 克隆成功 toast + 打开画布进入新工程；画布无剪辑节点、节点 id 已换 |
| 10 | 轮播（默认设置） | 底部最多 10 条、当前作品不在其中；点击无刷新切换；切换后关闭回列表 |
| 11 | admin 后台 | 选片（缩略图预览/无画布标注）/两开关联动/标签 tags 输入/封面传/计数改/轮播设置生效 |
| 12 | 下架作品 | 列表/详情立即 404 |

- [ ] **Step 3: 记录验收结果（本 plan 勾选框 + PR 描述）→ Commit（若有验收中修复）**

### Task 11.2: 部署清单（上线顺序红线，spec §8）

- [ ] **Step 1: 确认迁移文件就绪**

```bash
ls apps/api/prisma/migrations/ | tail -3   # 含 add_video_work 与 by-key 无关（无 schema 变更）
```

- [ ] **Step 2: 部署顺序执行（deploy.sh api 模式不含 prisma/——schema 与 migrations 必须先到位）**

```bash
# 1) 全量部署（或手动上传 apps/api/prisma/schema.prisma + apps/api/prisma/migrations/ 两者）
# 2) 服务器执行迁移
npx prisma migrate deploy
# 3) 重启 api（新代码 + 新 prisma client 生效——先 generate 再启动，deploy.sh 只跑 generate 不跑 migrate）
```

- [ ] **Step 3: 上线后冒烟：R12 Nginx /flowai Range 透传双验（curl -I -H "Range: bytes=0-1" 视频 URL → 206；DevTools 播放多次 206 无 range 警告）+ 会员 banner + /videos 列表**

---

## Plan 自审记录（writing-plans Self-Review）

1. **Spec 覆盖对照**：批次 0=D17/§4.3 by-key；批次 1=§3 schema/shared；批次 2=§4.3 后台 API 全量；批次 3=§4.2 公开列表/详情/categories；批次 4=§4.5 计数；批次 5=§4.6 快照（白名单/排序/Handle 依赖在 9.1/缩略图/端点）；批次 6=§4.7 克隆；批次 7=§5.1/5.2/5.5/D13/D14；批次 8=§5.4/D5/D15/D18/D11；批次 9=§5.3/D8/D9 前端半边；批次 10=§5.6；批次 11=§8 上线顺序+R12。**发现并补齐**：spec §4.2 未明确"公开读取轮播设置"的端点——落为 `GET /api/video-works/settings`（非敏感运营开关，公开；后端 Task 3.2、前端封装 Task 7.1，第九轮更新——原记"Task 8.3"已两轮前移）。
2. **占位符扫描**：无未承接占位——Task 8.1 按 C2 执行序（8.2→8.3→9.1→9.2→8.1→8.4）集成全部真实子组件，并在 Step 3b 完成 VideosPage 挂载接线（第八轮落进正文，原"最简占位阶段"表述作废）。upload-cover 的 MinIO API 已定案 `upload(key, buffer, contentType)` 三参（C1-4 / minio.service.ts:105 / Task 2.5 三处一致——"以 grep 为准"的占位表述作废，第八轮）。
3. **类型一致性**：shared `VideoWorkDetail/ProcessSnapshotData/CandidateMedia` 在 Task 1.2 定义，Task 3.3/5.2/5.3/7.1/8.2/9.1 引用一致；`buildFilteredSnapshot(raw, opts)` 签名在 5.1 定义、5.3/6.1 复用一致；`toggleLike` 返回 `{liked,likeCount}` 在 4.3/7.1/8.2 一致；Redis key `videoWork:like:{workId}:{userId}` 在 3.3/4.3 同键（§4.2 约束落实）。


