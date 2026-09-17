# 管理后台视频作品——成品视频上传改造设计（v2）

日期：2026-09-18
状态：设计定稿 v2（三轮审核修正合并：N0-N8 / A1-A3 / B1-B7 / C3 / D1 / 上线顺序）

## 1. 背景与业务口径

视频作品 = **成品视频** + **源画布（可选，单一关联）**。

- 成品视频不一定由视频剪辑节点导出：复杂视频的用户会把画布生成的多个片段下载到本地，用专业软件（PR/剪映）编辑合并成最终成品。因此作品视频来源改为**管理员本地上传**。
- 源画布（克隆画布）= 制作该成品视频所用的画布，承载创作过程分享与克隆。**可选**：不关联也可建作品，但"允许查看创作过程/允许克隆"两开关禁用。
- **一个作品只关联一个画布**（单一 `canvasProjectId`）是有意决定，与 P5 快照假设一致；将来允许多画布才需 join 表改 schema。
- 现有"候选视频"下拉（origin=video-project 剪辑导出池）只覆盖剪辑导出路径，**删除**。

## 2. 范围

| 动作 | 内容 |
|---|---|
| 删 | 前端候选下拉及 candRef/selCandRef（VideoWorksPage.tsx:209-250,151-152,182-198）；`adminApi.listCandidates`（adminApi.ts:198）；后端 `GET /candidates`（controller:29-32）+ `service.listCandidates`（video-work.service.ts:73-103）；`CandidateMedia` 类型（shared/video-work.ts，仅 service 使用，index.ts 是 export * 无需动）；controller.spec staticRoutes 数组中的 `'listCandidates'` 与 service.spec 整块 `describe('listCandidates')`（video-work.service.spec.ts:59-85）**必须同批**（只删 describe 不改数组，守卫测试 names.indexOf 悬空名直接红）；web 测试连带（VideoWorksPage.test.tsx:22 全局 mock、:115 create 提交、:194 pageSize 满额、fixtures :50/:177）；DTO 注释失真（create-video-work.dto.ts:9/10/12 "取自 candidate.*" 三处，本次孤立内容同批改掉） |
| 加 | 成品视频上传（预签直传）、画布关联、canvas-check、对象清理（域判断）、平台团队 seed、confirm 服务层安全收口（D1 方案 a）、两个前端工具模块 |
| 不变 | 编辑不可换视频源（换源=删除重建，UI 文案钉住代价：丢观看/喜欢数）；`allowViewProcess`/`allowClone` 联动；表单其余字段；封面区文案失真同批修（VideoWorksPage.tsx:270"留空使用视频缩略图"→"留空则用视频截帧封面"，旧语义是候选 thumbnailKey 兜底） |

**测试连带总表**（实现批次红先的完整清单，防"批次一开整片红"）：controller.spec staticRoutes + service.spec listCandidates describe（§4.4/§2）；storage.service.spec fixture 两类对齐 + mismatch 重写（§4.3）；**storage-quota.service.spec 签名/断言/fixture（§4.3 assertOnConfirm 删形参）**；**video-work.service.spec prisma.media 命名空间补 findUnique + 5 处 createWork stub + 泛型断言升级（§4.5 F2）**；removeWork 钉子翻转三态（§4.6）；web 侧候选用例（§2）。

## 3. 上传链路总览

```
选文件 → JS 前置拦截（非 mp4 / >1GB，中文提示，不进上传）
       → probeVideoFile 本地探测（objectURL + <video>，10s 超时兜底）
           loadedmetadata → durationSec(Math.round)/width/height（守卫见 §5.1）
           seek 1s → canvas 抽帧 → coverBlob('image/jpeg', 限宽 1280)
           error / 超时 → 拦截："浏览器无法解码，请导出 H.264 编码 MP4"
       → 抽帧封面 blob 留内存 + objectURL 预览（"将使用视频截帧作封面"），
         onFinish 提交时才 uploadCover（孤儿归零，见 §5.4）
       → POST /admin/video-works/presign-video      （API 只签名，expiresIn=3600s）
       → POST uploadUrl（经 toFlowaiUrl 同源改写）+ fields
           （裸 axios 直传 MinIO，字节不过 API，带进度；fields 在前 file 在后）
       → POST /api/storage/confirm（全路径！仓内有两个 /confirm 路由，
           另一个是 generated-media/confirm，语义不同，勿混）
       → onFinish 提交 videoKey/videoMediaId/durationSec/width/height
```

**上传 URL 同源改写（A1）**：presign 返回的 uploadUrl 是 MinIO 直连地址，dev 必挂 CORS。uploadUrl 过 `toFlowaiUrl` 改写（列表封面同款先例），生产前提 = Nginx `/flowai` 反代已存在；dev 走 Vite proxy（实施时确认 `/flowai` 代理规则覆盖 PUT/POST）。

## 4. 后端设计

### 4.1 平台团队 seed（B 形态：专用系统用户）

seed.ts 追加（全部固定 id、幂等 upsert；**顺序依赖：TeamMember 必须插在管理员账号创建之后**，新库 admin 由 BetterAuth 生成 id）：

1. `User` `platform-owner`：无凭据系统用户。必给 `name` / `email`（唯一，如 platform-owner@flowweb.local）/ `emailVerified: true`（三者无默认值，default-user 先例）。Team.owner 是 onDelete: Restrict → DB 层就删不掉，双保险
2. `TeamPlan` `platform-storage`：字段全给（仅 isActive/sort 有默认）——`name:'（内部）平台存储·勿上架'`（命名即运维红线：admin 套餐管理页可见并可改/可上架该行，误点上架 = 1TB/0 元套餐进用户端可购买列表；PlansPage 编辑表单不注册 isActive 字段，保存不会改回 true，但"上架"开关单点即翻转）、`monthlyCredits:0`、`storageLimitBytes: 1099511627776n`（BigInt，1TB）、`seatLimit:1`、`priceMonthly:0`、`isActive: false`（**必须 false**：GET /api/team/plans 用户端 where isActive:true；subscribe 也挡 !plan.isActive；getLimits 只读 storageLimitBytes 不读 isActive，false 零副作用；expireSubscriptions 只筛 status+currentPeriodEnd，2099 永不 due）、`sort: 99`
3. `Team` `platform-team`：ownerId=`platform-owner`，isDefault: **false**（承重：true 会使 getLimits 走"默认团队回退个人订阅"分支，1TB 被忽略、回落 6GiB）
4. `TeamMember`：seed 管理员 × platform-team，role OWNER（upsert 用复合键 `where: { teamId_userId: { teamId, userId } }`——seed.ts:187-191 现成先例，勿自造键名）。**管理员 id 必须按 email 查回**（ADMIN_EMAIL 可被环境变量覆盖、id 由 BetterAuth 生成），不能用字面量
5. `TeamSubscription`：platform-team × platform-storage，status active，currentPeriodStart=now，currentPeriodEnd=2099，paidAmount=0。**必须 upsert**：migration 20260829201000 有 partial unique index `team_subscription_one_active`（teamId WHERE status='active'），裸 create 二次 seed 必冲突

**自动化 spec 钉死**（不写成手工步骤）：`getLimits('platform-team').storageLimitBytes === 1024 ** 4`（**number 比较**——getLimits 出口已 Number(BigInt)；订阅缺失/过期/非 active 静默回落 6GiB，失效极难排查）。

效果：配额代码零改动，两道闸照跑永不超限；`getUsage('platform-team')` 即平台用量；管理员个人配额零污染；Media.user 级联删除风险消失（platform-owner 无删除路径）。

### 4.2 新端点 `POST /admin/video-works/presign-video`

- Body: `{ fileName, fileSize, fileType }`
- **必须新建带装饰器的 `PresignVideoDto`**（`@IsString fileName`、`@IsString fileType`、`@IsInt fileSize`——**只做结构约束**）：该 controller 类级 `whitelist + forbidNonWhitelisted`（无全局 pipe，controller:14 注释立的规矩），裸 TS 类 DTO 会恒 400（ConfirmUploadDto 能裸活恰因其 controller 无 pipe，勿照抄）
- **语义校验全部下沉 service 抛中文字符串异常**（必修①：ValidationPipe 数组 message → HttpException.initMessage 兜底 → HttpExceptionFilter 只发 exception.message → 前端显示 "Bad Request Exception"；装饰器加 {message:'仅支持 MP4'} 也到不了前端，数组在 filter 之前就被丢）：
  ```ts
  if (dto.fileType !== 'video/mp4') throw new BadRequestException('仅支持 MP4 格式（video/mp4）');
  if (dto.fileSize < 1) throw new BadRequestException('文件为空');
  if (dto.fileSize > 1GB) throw new BadRequestException('视频不得超过 1GB');
  ```
  字符串 message 被 createBody 原样采用 → filter 透传 → 前端中文 ✓（§6 "中文原因透传"由此成立）。仓内 phone-login.dto.ts:5 的中文装饰器消息其实同样到不了响应体（前端自校验兜住了），勿在本批重复该模式
- 内部：teamId 固定 `platform-team`（不做成员校验）→ `quota.assertCanUpload('platform-team', fileSize)`（必须用 platform-team 调用，spec 断言防改回管理员个人团队——配额支点）→ `minio.buildKey('uploaded', 'system', { ext: 'mp4' })`（**ext 硬编码 'mp4'**：fileType 已强校验，fileName.split('.').pop() 可能给出 MP4/txt）→ 建 pending Media：`userId='platform-owner'`、`teamId='platform-team'`、`type='uploaded'`（**禁 temp**：temp 写 expiresAt=now+7d，temp-cleanup.processor.ts:23-24 条件含 temp → 已发布作品视频 7 天后被删）、status='pending' → `generatePresignedPost(key, fileType, fileSize, 3600)`（默认 900s=15min，1GB 慢网直传可能中途 403）
- 返回 `{ fileId, uploadUrl, key, fields }`
- **为何不复用 `StorageService.presignUpload`**（注释必写，防后人顺手合并）：presignUpload 内 `buildKey(dto.type, userId)` 与 `Media.userId = 登录用户`——key 归属与 Media.userId 恒等于调用者，正是 B 形态要去掉的；且它会走成员校验/个人团队配额

### 4.3 confirm 复用 `POST /api/storage/confirm` + 服务层安全收口（D1 方案 a）

复用路径机械验证：pending Media.userId=platform-owner ≠ 管理员 → `assertTeamMember(platform-team, admin)`（storage.service.ts:77-79）→ seed 成员 → 通过；`assertOnConfirm` 按 platform-team 配额 → 不拦；statSize 核对（±1024），不匹配自动删对象+删记录。

**D1 加固（方案 a：服务层收口，零前端改动）**。攻击链**两条入口**（都已逐环验证，都吃请求体 key）：
- **攻击 A（mismatch 分支）**：`confirmUpload` 现读 `dto.key`/`dto.fileSize`（storage.service.ts:82-88）——自 presign 造 pending 行 + 传受害者 key + 故意不符 fileSize → `statSize(dto.key)` 不匹配 → `minio.delete(dto.key)`
- **攻击 B（配额分支）**：`assertOnConfirm(dto.fileId, actualSize, dto.key, media.bucket)` 超限时 `try { minio.delete(key) } catch {}`——删的也是请求体 key，且无需知对象大小（猜 ±1024 内跳过 mismatch、或顶爆配额即可）

受害者 key 无需猜测（getDetail 返回的 videoUrl 就是 `presignedGetUrl(w.videoKey)`，路径带完整 key，前端 DOM 直接可见）→ **任意登录用户可删任意已发布作品的视频/封面对象**。

修法：`confirmUpload` 内部一律改用 `media.key`/`media.size`（statSize/delete/大小核对/配额**全部**），请求体只用来定位行——两条攻击同时关死。**`assertOnConfirm` 直接删掉 `key` 形参**：它已在 :36 findUnique 读了行、行里就有 key → `assertOnConfirm(mediaId, actualSize, bucket)`，内部用 `media.key`——**参数消失 = 编译期不可能再被误用**（比"要求调用方传 media.key"强一个量级，后者下次仍可能传错；现有 spec 恰以"传什么删什么"被测试固化：storage-quota.service.spec.ts:59-61）。**禁止 `media.size ?? dto.fileSize` 回落**（会让"media 行为唯一事实源"静默失效，fixture 缺陷再次不可见）。**DTO 三字段保留不动**（key/fileSize 标 `@deprecated` 注释"服务端已改用 media.key/media.size，保留兼容"）——storage.controller **没有** ValidationPipe（仓内无全局 pipe，ConfirmUploadDto 零装饰器），多余字段既不被剥也不被拒、只被忽略，故前端 `storageApi.confirmUpload` 及全部 12 处调用点（mediaUploadUtils/splitUploadService/materialLibraryStore/各生成节点/useImageUpload 等）与 8 份测试断言**零改动**；"删 DTO 字段"是顺带洁癖，会拖 ~20 个无关文件回归，明确不做（挂 forbidNonWhitelisted 更是红线：会把仍传三字段的全站上传打成 400）。

**spec 连带口径（必须同批，比"补字段"更严）**：
- storage.service.spec.ts fixture 缺失是**两类**：`:124/:159` 需补 `size`（read media.size 的用例）、`:140/:151` 需补 `key`（成员用例，今天靠请求体 key 活着）——别混成一条"补 size"
- 修复是**对齐**而非补字段：① fixture `size` 与该用例请求体 `fileSize` 差值 ≤1024（否则成功路径用例以"大小不匹配"翻红）；② `minio.statSize` 返回值显式给出（assertOnConfirm 配额终判也读 actualSize）；③ D1 后 mismatch 用例（:158-169）会**变红**（服务端不读 dto.fileSize → resolve → rejects.toThrow 失败），按新语义重写；④ :139-148 成员用例补齐后才真正覆盖"成员可确认+大小一致→completed"
- storage-quota.service.spec.ts 同批：:59/:68 调用签名改三参（去 key）、:61 断言 `delete('media.key')`、:54/:67 fixture 补 `key`

与 generated-media 的 confirm（`/video-projects/generated-media/confirm`，创建者独占 + 无比对 + 清 expiresAt，语义完全不同）无关，勿动。

约束注释：确认者须为 platform-team 成员（当前=seed 管理员，新增管理员需手动加成员，登记后续项）。

### 4.4 轻量校验 `GET /admin/video-works/canvas-check?id=xxx`

- 返回 `{ id, name, ownerName: string | null, updatedAt }` 或 404。**ownerName 可空**：CanvasProject.userId 是 String?（团队画布），取 `user?.name ?? team.owner.name`；两者皆空回显"团队画布"（不得出现 "作者 null"）
- 实现抽**私有 `findCanvasRef(id)`**（返回 `{id,name,ownerName,updatedAt} | null`）——**是抽取，不是复用**：getDetail:205-206 今天是内联存在性查询（select:{id:true}），不存在现成函数。查询形状 `select: { id, name, updatedAt, user: { select: { name } }, team: { select: { owner: { select: { name } } } } }`。**getDetail 保留现有轻量 boolean 查询不改**（公开热路径，为防漂移加两次 join 不值；findCanvasRef 服务 canvas-check 与 create/update 校验两处 admin 路径即可，注释写明取舍，并加可 grep 指针："CanvasProject 将来加软删/可见性条件时，getDetail:205 与本函数两处都要改"）
- 权限：AdminGuard 全局 /api/admin/ 前缀，天然 admin-only；**有意不做画布 owner 校验**（admin 策展跨用户）——注释写明"admin-only + 有意绕过 owner"防被当漏洞修掉
- **路由声明序（N0 硬约束）**：`canvasCheck` 与 `presignVideo` 声明在静态段（`:id` 段之前）——`@Get(':id')` 会吃掉 **GET** canvas-check（→ getWorkById('canvas-check') → 200+null ≠ 404，门禁失真）；presignVideo 是 **POST**，`:id`（GET）今天吃不掉它，纳入守卫是**防御性完整性**（防将来改成 @Get 或加同名 GET 路由）。controller.spec 的 staticRoutes 数组**一次到位**：`['listCategories','listTags','canvasCheck','uploadCover','getSettings','presignVideo']`（删 listCandidates；:71 测试标题同步——现标题还写着 candidates）。**新端点必须写成类方法**（`async presignVideo(...)`），不能写类字段箭头函数——守卫用 `Object.getOwnPropertyNames(Controller.prototype)` 取顺序，类字段是实例属性不在 prototype 上 → indexOf 恒 -1 → 守卫直接红

### 4.5 createWork / updateWork 画布校验 + videoKey 不变量

`canvasProjectId` 非空时经 `findCanvasRef` 查存在性，不存在 → 400 "画布不存在"。**为空时不校验、允许创建**（null 分支，spec 覆盖）。

**videoKey 服务端不变量（F2，把约定升级为不变量；插入位置钉在 assertProcessFlags 之后**——放之前会让 flags 两条用例静默失去覆盖）**：createWork 现对 videoKey 只做类型/长度校验就 spread 落库，"必属平台域"只是前端约定。加校验（**PK 查 + 交叉校验**，勿按 key 查——Media.key 无索引，全站最大表顺序扫）：

```ts
if (!dto.videoMediaId) throw new BadRequestException('视频文件不存在或未完成上传');
const m = await this.prisma.media.findUnique({ where: { id: dto.videoMediaId } });
if (!m || m.deletedAt || m.status !== 'completed' || m.type !== 'uploaded'
    || m.teamId !== 'platform-team' || m.key !== dto.videoKey)
  throw new BadRequestException('视频文件不存在或未完成上传');
```

五条件 + key 交叉校验的用意：① `teamId='platform-team'` 把"平台域"从约定升级为服务端不变量（普通用户的上传素材同样满足 uploaded+completed，须排除）；② `m.key === dto.videoKey` 关掉"合法 key + 别人的 mediaId"（removeWork 的 Media 软删用的正是 videoMediaId，两字段不一致会软删无关行）。D1 的教训是"服务端不相信请求体"，此处同源；旧候选池 create 路径已删且 createWork 无其他调用者（仅 controller:59 与 spec），无兼容问题。

**spec 连带（不补则批次一开整片 TypeError 红）**：video-work.service.spec.ts:28-34 的 prisma.media mock 命名空间只有 findMany/count → `media.findUnique is not a function`。同批：① mock 命名空间补 `findUnique`；② 5 处 createWork 用例（:110-115/:118 flags、:129-134 publishedAt、:145-148 durationSec 取整）stub 匹配行（或 beforeEach 给默认行）；③ 两处泛型 `toThrow(BadRequestException)` 升级为断言文案（否则 F2 插入位置会静默改变断言含义——与 §4.3 防的是同一类事故）。

### 4.6 对象清理（域判断 + 排他 + 缓存失效；红线改写）

**旧红线及取代理由（§10 注释必写）**：video-work.service.ts:224-231 现有红线"只删 DB 行，禁止 minio.delete——videoKey 与源 Media 指向同一对象"。其前提是候选池模型；新模型 videoKey 是平台自有上传对象（uploads/system/ 域），前提消失。存量作品两种 key 形态并存（旧 `results/...` 共享对象、新 `uploads/system/...` 平台独占），**域判断收口**：

- `removeWork`：
  1. 仅当 key 以 `uploads/system/` 前缀（平台域）才删 MinIO 对象；`results/` 等旧域**只删 DB 行不删对象**。域判断比直觉更可靠：`uploads/system/` 在全仓只有 3 个写入点且全是图片（uploadCover/home-banner/admin-banner），素材上传走 `buildKey(dto.type, 真实userId)` → 永远不会是字面量 `system`。但**勿信"平台域 = 本作品独占"**——该域是三个子系统共用（作品封面/首页 banner/订阅 banner），banner 与封面都不建 Media 行，videoMediaId 排他对封面无帮助；**封面排他只能靠 VideoWork.coverKey 字符串比对**（硬化需 banner 表反查，登记 §9）。视频对象排他**以 videoMediaId 为主**（`count({ where: { videoMediaId, NOT: { id } } }) > 0` → 不删）：同一 Media 行 key 唯一，裸 key 可跨域重复。排他属**防御性**校验（新 UI 不可能产生共享，防的是 API 直调——如管理员直调把 coverKey 设成 banner 的 key）
  2. 先 `findUnique` 取行再删（现状 delete 直接抛 P2025 → 500；语义钉住：行不存在 → 404）
  3. videoMediaId 对应 Media 行置 `deletedAt`（软删释放平台配额；getUsage 条件 status='completed' AND deletedAt:null）
  4. **缓存失效（C3）**：删对象后同步 `redis.del('videoWork:url:' + key)`（presignWork 短缓存约 58min），否则删了还能播
  5. 全程 try/catch **尽力而为不阻断**：MinIO 抖动仅记日志，作品删除照常成功；失败对象登记后续清理
- `updateWork` 换封面（coverKey 变更）：先确认新 key 已上传（§5.4 提交时才 uploadCover，天然满足"新 key 成功后才动旧的"）再删旧对象；删前同样排他查（其他作品未引用旧 coverKey；防御性，勿在注释写"UI 可产生共享 key"——不可能，防的是 API 直调）；coverKey 走 uploadCover 不建 Media 行（system/ 域），只能记录旧 key 直接删
- spec：新封面失败 → 旧封面仍在；`results/` 存量作品删除 → 不调 minio.delete

### 4.7 删除候选池

连带清单见 §2（闭合：前端唯一消费者是本表单）。`presignWork` 保留（列表/详情/缩略图在用：video-work.service.ts:184,209,210,238）。

## 5. 前端设计

### 5.1 模块抽取（表单只做编排）

```ts
// apps/web/src/pages/admin/utils/probeVideoFile.ts
probeVideoFile(file: File): Promise<
  | { ok: true; durationSec: number | null; width: number | null; height: number | null; coverBlob: Blob | null }
  | { ok: false; reason: 'decode' }   // video error 或 10s 超时
>
```

内含 objectURL（revoke 放 finally）、loadedmetadata、seek+onseeked（**目标 `Math.min(1, duration/2)`**：<1s 短视频 seek(1) 被夹到末帧可能抽到黑帧）、readyState>=2 守卫、drawImage、toBlob('image/jpeg')、限宽 1280 的完整事件舞；**Promise.race 10s 超时**归入 decode（畸形文件事件永不触发会让 Promise 永不 settle + objectURL 泄漏；超时分支同样要 removeEventListener + video.src='' + revoke，否则 10s 后解码仍在跑）。数值守卫（A4）：`Number.isFinite(duration) && videoWidth>0 && videoHeight>0` 才填字段，否则 null（DTO 全 @IsOptional 允许）；元数据守卫与抽帧互不阻断。duration=Infinity（流式/缺 moov）、宽高=0 是真实 MP4 形态。

```ts
// apps/web/src/pages/admin/utils/uploadToPresignedPost.ts
uploadToPresignedPost(args: { url: string; fields: Record<string,string>; file: File|Blob;
  onProgress?: (pct: number) => void; signal?: AbortSignal }): Promise<void>
```

**裸 axios + onUploadProgress**（裸 axios + 显式 multipart/form-data + 同源改写照 mediaUploadUtils.ts:31-35 模板——注意该模板**不含**进度参数；进度写法另引仓内 6 处 onUploadProgress 先例如 VideoGenNode.tsx:498，测试范式 useImageUpload.test.ts:265-267 直接喂 {loaded,total}）。**禁用 apiFetch/应用 axios 实例**——应用实例默认 Content-Type: application/json（api/client.ts:13），S3 policy 对表单字段敏感。FormData **fields 在前、file 在后**（S3 硬要求）；403 → 抛"上传超时（签名过期），请重试"。url 由调用方先过 `toFlowaiUrl`（导出自 videoWorkApi.ts:7，勿再造内联正则第三版；**正则只认"host 后紧跟 /flowai"的路径式寻址**——桶名/寻址方式变更会静默失效直连 presign host，变更需同步正则与 Nginx location）。`signal` 贯穿 presign/直传/confirm 三段（storageApi.presignUpload(params, signal?) 先例签名照抄）。

**durationSec 取整（A2）**：`video.duration` 是浮点（12.345），DTO `@IsInt()` 无 transform 直接 400（服务端 Math.round 在校验之后救不了）——**前端组装 payload 时 `Math.round`**；width/height 是 videoWidth/videoHeight 天然整数。

### 5.2 上传区流水线（create 模式，表单顶部）

- 隐藏 `input[type=file] accept="video/mp4"`，内联 `display:none`（antd :where 特异性 (0,2,1) 压 Tailwind .hidden 先例）+ `e.target.value=''` 复位（连续选同一文件，VideoWorksPage.tsx:208 先例）；accept 只是选择器过滤，JS 判断不可省
- 选文件后：前置拦截 → probeVideoFile（抽帧 blob 留内存预览，§5.4）→ presign-video → uploadToPresignedPost（进度百分比）→ `POST /api/storage/confirm` → 成功态（文件名+大小+时长/分辨率）
- **abort/重置挂点（N2）**：WorkFormModal 是 trigger 宿主**永不卸载**（destroyOnClose 只销毁 ModalForm 内部内容），useEffect cleanup 不会执行——abort 与状态机重置（videoKey/videoMediaId/dims/progress/uploading/coverTouched）必须挂在既有 `modalProps.afterClose`（那里已在重置 coverKey/selCandRef），否则关弹层白传 1GB 且重开残留进度条
- 上传失败/取消 → state 回落"未上传"，门禁仍生效，可重试
- 悬挂 pending 说明（注释）：直传失败未 confirm 的 Media 行永不过期（temp 清理抓不到 uploaded），不占配额，已知台账噪音（§9）

### 5.3 源画布输入（A1 状态机：防 C-1 注册陷阱重演）

- **可见输入框本身就是 `name="canvasProjectId"` 注册字段，值=原始文本**（隐藏字段 setFieldsValue 写入、onFinish 恒 undefined 的 C-1 教训）
- onFinish 用导出纯函数 `parseCanvasRef(text): string | null` 现算最终 ID，表驱动单测：绝对 URL、相对 URL（`new URL(v, location.origin)` 解析 /canvas?projectId=x）、裸 ID、首尾空白、控制台粘贴带引号、URL 无 projectId 回落整串当裸 ID
- canvas-check 异步结果只用于**回显 + 门禁**，不写回表单值：
  - 校验通过 → 回显"画布：{name}（{ownerName ? `作者 ${ownerName}` : '团队画布'}）"
  - 404 → 红字"画布不存在"，阻止提交
  - **校验通过后文本又被改动 → 阻止提交 + "画布已修改，请重新校验" + 两开关回禁用**（B3：disabled 由"校验通过"状态驱动，不由文本非空驱动——非空乱码就能点开关、提交才报错的体验失真；且清空/改动后残留 true 会撞服务端 assertProcessFlags 400）
- edit 模式允许改画布（UpdateVideoWorkDto canvasProjectId?: string|null，今天已支持）

### 5.4 封面区（提交时上传：竞态与孤儿双消除）

抽帧 `coverBlob` **留内存**，UI 用本地 objectURL 预览 + 文案"将使用视频截帧作封面"（区标题同步改"留空则用视频截帧封面"，旧文案指候选 thumbnailKey 兜底已失真）；**onFinish 提交时才 uploadCover**（`if (!coverTouched)`）。效果：①竞态不存在（手选封面仍是最后一次写入，且不会发生"直传几分钟里抽帧静默覆盖手选"）；②抽帧孤儿归零（probe 后立即上传的方案在每次重选文件时都会产生一张无引用封面，第三类清理只能 MinIO 前缀列举+反查，比 Media 行筛难一个量级——直接不产生）；③代价仅提交时多几百毫秒。手选封面放弃提交产生的孤儿是**既有现象**（现在 VideoWorksPage.tsx:155-157 就是选中即 uploadCover），登记 §9 不在本批。afterClose 重置 coverBlob/coverTouched/objectURL（revoke）。**封面 onFinish 上传失败的路径**：作品未创建，但视频已直传+confirm（Media completed 无引用）——正落 §9② 清理范围，勿误以为漏了。

### 5.5 edit 模式形态

edit 不显示上传控件，显示**只读信息条**：当前视频时长/分辨率 + 封面缩略图 + 可换封面（现有封面区）。画布输入照常。文案："上传后不可更换视频，更换需删除作品重建（会丢观看/喜欢数）"。零后端改动（listAllWorks 已返回全部字段）。**信息条只读 VideoWork 行自身字段**（durationSec/width/height 存在行上）——**不解析 videoKey**（旧域作品的 key 可能指向已删对象，勿去 sign 它做缩略图）。封面缩略图是**全新代码**（该页今天没有 <img>）：edit 用 `<img src={'/flowai/' + coverKey}>` + onError → 占位（旧封面对象可能已被删）；create 用 §5.4 的本地 objectURL。

### 5.6 表单状态与门禁

- videoKey/videoMediaId/durationSec/width/height 存组件 state（替代 selCandRef）；afterClose 一并重置（§5.2）
- create 门禁：未上传不可提交（"请先上传成品视频"）；后端兜底 videoKey @IsString 必填
- onFinish：create 组装 `videoKey/videoMediaId/durationSec(Math.round)/width/height + coverKey`；edit 剔除 video 源字段

## 6. 错误处理契约

| 场景 | 行为 |
|---|---|
| 选文件非 mp4 / >1GB | 前端即时 message.error（中文原因），不进上传 |
| 探测 video error / 10s 超时 | "浏览器无法解码，请导出 H.264 编码 MP4"（可播放性闸门，拦截 HEVC/ProRes/.mov） |
| 探测数值守卫不过 | 对应字段留 null，仍可上传（作品缺时长/分辨率可接受） |
| presign 400 | 中文原因透传（service 语义校验）；**例外**：类型层失败（如 fileSize 非整数，@IsInt 装饰器承担）返回**英文约束消息**且无法用装饰器中文修好——前端 §5.2 已有类型/大小前置拦截，正常路径不会走到 |
| 直传 403 | "上传超时（签名过期），请重试" |
| 直传其他失败/取消 | state 回落"未上传"，可重试；afterClose abort |
| confirm 大小不匹配 | 后端自动删对象+记录，前端透传文案 |
| canvas-check 404 | 红字"画布不存在"，阻止提交 |
| 画布文本改动未重新校验 | "画布已修改，请重新校验"，阻止提交，两开关回禁用 |
| createWork/updateWork 画布 400 | 兜底透传 |
| removeWork 清理失败 | 记日志不阻断，删除照常成功 |

## 7. 测试策略（TDD，每条红→绿）

### 7.1 后端 spec

1. presign-video：mp4+1GB 边界通过；非 mp4 / <1 / >1GB → **service 层断言中文文案**（`rejects.toThrow('仅支持 MP4')` 等——只断言 400 会漏必修①：装饰器 message 到不了响应体）；**PresignVideoDto 带结构装饰器**（类级 forbidNonWhitelisted 下裸 DTO 恒 400）；Media 归属（userId=platform-owner、teamId=platform-team、type=uploaded）；**断言用 platform-team 调 quota.assertCanUpload**（配额支点防回退）；generatePresignedPost 收到 3600；ext 恒 'mp4'（fileName 传 x.TXT 也产 .mp4 key）
2. confirm D1 安全回归（先红后绿）：请求体传 `key:'victim/obj'` + 故意不符的 fileSize → **断言 statSize 与 minio.delete 收到的都是 media.key**（victim 不被删——覆盖攻击 A mismatch 分支与攻击 B assertOnConfirm 配额分支**两条**删除路径；不写"旧字段被拒"断言：controller 无 pipe，多余字段只被忽略）；fixture 两类对齐（:124/:159 补 size、:140/:151 补 key；size 与请求体 fileSize 差 ≤1024、statSize 显式给出）；mismatch 用例（:158-169）按新语义重写；**storage-quota.service.spec 同批**（:59/:68 三参签名、:61 断言 delete(media.key)、:54/:67 fixture 补 key）；**禁止 `media.size ?? dto.fileSize` 回落实现**（回落会让本组安全断言失效）
3. canvas-check：存在 → {id,name,ownerName,updatedAt}；团队画布 ownerName 回落 team.owner.name；不存在 → 404
4. createWork：canvasProjectId 不存在 400；**为空不校验允许创建**（null 分支）；durationSec 传 null 通过；**videoKey 不变量五条件**（F2：不存在/软删/非 completed/非 uploaded/非 platform-team/mediaId 与 key 交叉不符 → 400 "视频文件不存在或未完成上传"；**插入位置钉在 assertProcessFlags 之后**）；**连带**：prisma.media mock 命名空间补 findUnique（:28-34 只有 findMany/count，否则整片 TypeError 非 400）+ 5 处 createWork 用例 stub 匹配行（:110-115/:118/:129-134/:145-148）+ 两处泛型 toThrow 升级为文案断言
5. updateWork：画布校验同上；换封面删旧对象（排他：旧 coverKey 被其他作品引用 → 不删）；新封面失败 → 旧封面仍在
6. removeWork（**翻转钉子用例必须非真空**：既有 :151-157 mock 了 minio.delete 但没 stub videoWork.findUnique——裸 vi.fn() 返回 undefined → 无 key → not.toHaveBeenCalled 恒真，真空绿验不到新语义）：① stub findUnique 返回 `videoKey:'uploads/system/…'` 行 → **断言 delete 被调用**；② 另一例 `videoKey:'results/…'` → 断言不调 delete；③ findUnique → null → 404（先查后删，别让 P2025 → 500）；④ Media 软删 + **redis.del('videoWork:url:'+key) 缓存失效**；⑤ MinIO 失败不阻断（mock delete 抛错仍成功）
7. seed spec（自动化）：`getLimits('platform-team').storageLimitBytes === 1024 ** 4`（number 比较）
8. 路由声明序：staticRoutes 数组一次到位 `['listCategories','listTags','canvasCheck','uploadCover','getSettings','presignVideo']`（删 listCandidates；:71 测试标题同步；**新端点写成类方法**——prototype 顺序守卫对类字段箭头函数恒红）

### 7.2 前端 test

1. 重写候选用例为上传路径（原 :22 mock/:115 create/:194 pageSize + fixtures :50/:177 按实际清点处理）
2. `input[type=file]` 内联 `display:none` 锚点（防回退 .hidden）
3. probeVideoFile 单测：loadedmetadata 元数据（jsdom 属性直赋 + fireEvent，fixture duration=12.345 → durationSec=12 钉取整）；error → decode；数值守卫（Infinity/0 宽高）→ 字段 null 非整体失败；**事件永不触发 → 10s 超时 decode**（fake timers）；stub URL.createObjectURL/revokeObjectURL（FilePreviewPopover.test.tsx:29-39 先例）；stub canvas.getContext（jsdom 默认 null，EraseCanvas/PreviewPlayer 先例）+ mock toBlob
4. uploadToPresignedPost 单测：fields 前 file 后；onprogress（喂 {loaded,total}，useImageUpload.test.ts:265-267 先例）；abort signal；403 文案
5. 表单编排（mock 两模块）：成功 → payload 带 videoKey/videoMediaId/durationSec(取整)/width/height；失败/取消 → 门禁仍生效可重试；**afterClose → abort 被调用 + 状态机全重置**（非 unmount）；**重开弹层不残留上次 videoKey/进度**（重置的正面断言）
6. canvasProjectId **注册性**：payload 带解析后 ID（C-1 家族回归）
7. parseCanvasRef 表驱动：绝对/相对 URL、裸 ID、空白、带引号、无 projectId 回落
8. canvas-check 门禁状态机：未校验通过阻止提交；**校验后改动文本 → 阻止提交 + 两开关回禁用**；ownerName null → 显示"团队画布"
9. edit：无上传控件（只读信息条）、payload 不含 videoKey/videoMediaId、画布可改
10. 封面（提交时上传）：probe 后仅内存 blob + objectURL 预览（不调 uploadCover）；手选封面 → coverTouched；onFinish 才 `if (!coverTouched)` uploadCover；afterClose → coverBlob/coverTouched/objectURL（revoke）复位

### 7.3 浏览器验收

1. **前置**：seed 后平台团队限额生效（1TB）——见 §8 上线顺序，未 seed 的库必挂（回落 6GiB → FK 500 → confirm 403）；**确认服务器 prisma/seed.ts 是最新版**（deploy_api 模式不更新它）
2. 真实 MP4 上传 → 进度条 → 建作品 → 前台播放 + 制作过程 + 克隆全链路
3. HEVC/.mov → 闸门文案"浏览器无法解码"；>1GB → 前置拦截
4. 可选：慢网进度条 + 签名过期路径；**Network 面板确认上传请求 URL 以 `/flowai/` 开头且返回 200/204**（toFlowaiUrl 改写生效的直接证据；正则只认路径式寻址，桶名/寻址变更会静默失效直连 presign host）

## 8. 上线顺序（A3：运行期硬依赖 + 生产运维前置）

平台团队是**运行期硬依赖**，未 seed 的库失败形态：assertCanUpload 静默回落 6GiB 不报错 → `media.create({teamId:'platform-team'})` FK 违例 500 → confirm 侧 assertTeamMember 403。部署清单：

1. schema/migrations（本设计无 Prisma 变更，可省）
2. `prisma db seed`（新增 platform-owner/User、TeamPlan、Team、TeamMember、TeamSubscription 五行）
3. 重启 api
4. 验证：`getLimits('platform-team') === 1TB`（seed spec 即自动化验证）

**deploy 模式精确口径**（已核 deploy.sh）：deploy_full（默认无参）上传 apps/ packages/ 全目录（含 prisma/）并跑 pnpm install（含 devDependencies → tsx 在位）→ `cd apps/api && npx prisma db seed` 可直接跑；deploy_api 只上传 apps/api/src（:55-56）→ 不含 prisma/ 也不跑 install，seed 依赖 devDependency tsx（apps/api/package.json:54/65）→ api 模式后 seed 会失败，须先补传 seed.ts。运维顺序：跑全量 deploy.sh → cd apps/api && npx prisma db seed → 重启。

**生产运维前置（阻塞项，三件套）**：A1 同源改写后 1GB 的 POST 穿 Nginx（仓内无 nginx 配置可验证；现有上传都是几 MB 素材从未触碰上限，"现在能用"不证明 1GB 能用）：① `client_max_body_size >= 1024m`（默认 1MB → 413）；② 读/体超时放宽（`proxy_read_timeout`/`client_body_timeout` 默认 60s，慢网 1GB → 504）；③ `proxy_request_buffering on`（默认）会先把整包落到 `client_body_temp_path`——确认磁盘余量或改 `off`。dev 无此问题（Vite 代理不限体积）。

## 9. 登记后续项

- stale Media 清理任务两类（N4）：① type=uploaded AND status=pending AND createdAt>24h → 删对象+记录（悬挂 pending，台账噪音不占配额）；② type=uploaded AND status=completed AND createdAt>24h AND **无 VideoWork.videoMediaId 引用**（先查引用再删）→ 删对象+软删记录（表单放弃的 confirm 行占平台配额，性质与①不同）
- **手选封面放弃提交的孤儿对象**（既有现象，本批 §5.4 已消除抽帧侧孤儿——提交时上传；手选侧 uploadCover 后放弃提交仍会留下无引用封面，如需清理同 ② 按引用反查）
- 新增管理员需手动加入 platform-team 才能 confirm（当前仅 seed 管理员）
- removeWork 清理失败对象的兜底清理任务
- VideoWork.videoKey/coverKey 无索引，排他查询全表扫（作品量小可接受；量大再加索引）
- admin 套餐管理页可见 platform-storage 行并可改限/上架——命名已带"勿上架"红线，如需彻底硬化再加 isSystem 过滤；封面排他硬化（banner 表反查，防 API 直调把 coverKey 设成 banner 对象——UI 不可能，低严重度）
- confirm DTO 的 key/fileSize 兼容字段清理（12 处前端调用点 + 8 份测试，待某批全站上传链改动时顺带；**清理时必须保留 victim key 安全回归用例**——它是唯一能证明 D1 洞已关的钉子）
- edit 不可换源代价已用 UI 文案缓解；失误率高再考虑"重建时继承 viewCount/likeCount"工具

## 10. 关键注释清单（实现时必须落注释）

| 位置 | 注释 |
|---|---|
| presign-video | 语义校验在 service 抛**中文字符串异常**的原因（装饰器 message 是数组 → initMessage 兜底 → 前端只见 "Bad Request Exception"）；type 必须 'uploaded' 禁 temp（7d 清理 footgun）；fileSize 上限不得超 ~2GiB（Media.size 是 Postgres Int，超出需迁 BigInt）；teamId 固定 platform-team 是配额支点；**为何不复用 presignUpload**（key/Media.userId 恒等于调用者，正是 B 形态要去掉的）；预签传**精确** file.size（policy 钉 content-length-range ±1024，超差 403——与签名过期同症状，排查注意） |
| storage confirm（D1） | 就地读 media.key/media.size 的安全理由（**攻击 A** mismatch 分支 + **攻击 B** assertOnConfirm 配额分支，两条都吃请求体 key：自 presign 造 pending 行 + 传受害者 key → delete(dto.key)，key 经公开 URL 可得）；assertOnConfirm **删 key 形参**（内部读行，编译期防误用）；禁止 `media.size ?? dto.fileSize` 回落；DTO key/fileSize 保留兼容、服务端不读（勿"顺手"挂 forbidNonWhitelisted pipe——会把全站仍传三字段的上传打成 400） |
| canvas-check / findCanvasRef | admin-only + 有意绕过画布 owner 校验（admin 策展跨用户），非漏洞；getDetail 保留轻量 boolean 查询是**有意取舍**（公开热路径不加 join）；"CanvasProject 加软删/可见性时 getDetail:205 与本函数两处都要改" |
| controller 静态段 | canvasCheck/presignVideo 必须是**类方法**（prototype 顺序守卫对类字段箭头函数恒红）且声明在 :id 段之前（:id 吃 GET 静态段；presignVideo 是 POST，纳入数组属防御性完整性而非"会被吃"） |
| removeWork | **取代旧红线**（旧：只删 DB 行禁 minio.delete；理由：旧前提是 videoKey 与源 Media 共享对象，新模型平台域独占）+ 域判断（仅 uploads/system/ 删对象；视频侧有 F2 platform-team 不变量支撑，**封面侧仍是约定**——system 域是封面/banner 三子系统共用，勿信"平台域=本作品独占"）+ **视频排他以 videoMediaId 为主、封面靠 coverKey 字符串比对** + 缓存失效 |
| seed | platform-team isDefault:false 承重（true 回落个人订阅分支）；TeamPlan isActive:false + 命名"勿上架"（admin 套餐页可见可翻转，运维红线）；TeamSubscription partial unique index → 必须 upsert（改固定 id 前先清旧 active 行，否则同撞索引）；TeamMember 在 admin 创建之后（admin id 由 BetterAuth 生成，须按 email 查回） |
| confirm | 确认者须为 platform-team 成员 |
| 前端表单 | 悬挂 pending 行是已知台账噪音（§9）；abort 挂 afterClose 的原因（组件常驻不卸载）；封面 onFinish 上传失败时视频已 confirm 无引用——§9② 覆盖，非遗漏 |
| createWork（F2） | videoKey 不变量五条件（存在+completed+uploaded+未软删+platform-team）+ mediaId/key 交叉校验；PK 查 mediaId（key 无索引勿按 key 查）；插入位置在 assertProcessFlags 之后 |
| 上传 input | 内联 display:none 的特异性原因；e.target.value='' 复位原因 |
| uploadToPresignedPost | 裸 axios/裸请求的硬要求（apiFetch/应用实例拦截器改 Content-Type，S3 policy 敏感）；fields 前 file 后的 S3 要求；403=签名过期（或体积超差）映射 |
| probeVideoFile | 超时分支同样 removeEventListener + src='' + revoke；seek 目标 Math.min(1, duration/2) 防短视黑帧 |

