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
| 删 | 前端候选下拉及 candRef/selCandRef（VideoWorksPage.tsx:209-250,151-152,182-198）；`adminApi.listCandidates`（adminApi.ts:198）；后端 `GET /candidates`（controller:29-32）+ `service.listCandidates`（video-work.service.ts:73-103）；`CandidateMedia` 类型（shared/video-work.ts，仅 service 使用）；controller.spec staticRoutes 数组中的 `'listCandidates'`；service.spec 整块 `describe('VideoWorkService.listCandidates')`（video-work.service.spec.ts:59-85）；web 测试连带（VideoWorksPage.test.tsx:22 全局 mock、:115 create 提交、:194 pageSize 满额、fixtures :50/:177）；DTO 注释失真（create-video-work.dto.ts:9/10/12 "取自 candidate.*" 三处，本次孤立内容同批改掉） |
| 加 | 成品视频上传（预签直传）、画布关联、canvas-check、对象清理（域判断）、平台团队 seed、confirm 安全加固（D1）、两个前端工具模块 |
| 不变 | 编辑不可换视频源（换源=删除重建，UI 文案钉住代价：丢观看/喜欢数）；`allowViewProcess`/`allowClone` 联动；表单其余字段 |

## 3. 上传链路总览

```
选文件 → JS 前置拦截（非 mp4 / >1GB，中文提示，不进上传）
       → probeVideoFile 本地探测（objectURL + <video>，10s 超时兜底）
           loadedmetadata → durationSec(Math.round)/width/height（守卫见 §5.1）
           seek 1s → canvas 抽帧 → coverBlob('image/jpeg', 限宽 1280)
           error / 超时 → 拦截："浏览器无法解码，请导出 H.264 编码 MP4"
       → 抽帧封面立即 uploadCover + setCoverKey（默认值先落，手选后覆盖，见 §5.4）
       → POST /admin/video-works/presign-video      （API 只签名，expiresIn=3600s）
       → POST uploadUrl（经 toFlowaiUrl 同源改写）+ fields
           （XHR 直传 MinIO，字节不过 API，带进度；fields 在前 file 在后）
       → POST /api/storage/confirm（全路径！仓内有两个 /confirm 路由，
           另一个是 generated-media/confirm，语义不同，勿混）
       → onFinish 提交 videoKey/videoMediaId/durationSec/width/height
```

**上传 URL 同源改写（A1）**：presign 返回的 uploadUrl 是 MinIO 直连地址，dev 必挂 CORS。uploadUrl 过 `toFlowaiUrl` 改写（列表封面同款先例），生产前提 = Nginx `/flowai` 反代已存在；dev 走 Vite proxy（实施时确认 `/flowai` 代理规则覆盖 PUT/POST）。

## 4. 后端设计

### 4.1 平台团队 seed（B 形态：专用系统用户）

seed.ts 追加（全部固定 id、幂等 upsert；**顺序依赖：TeamMember 必须插在管理员账号创建之后**，新库 admin 由 BetterAuth 生成 id）：

1. `User` `platform-owner`：无凭据系统用户。必给 `name` / `email`（唯一，如 platform-owner@flowweb.local）/ `emailVerified: true`（三者无默认值，default-user 先例）。Team.owner 是 onDelete: Restrict → DB 层就删不掉，双保险
2. `TeamPlan` `platform-storage`：字段全给（仅 isActive/sort 有默认）——`name:'平台存储'`、`monthlyCredits:0`、`storageLimitBytes: 1099511627776n`（BigInt，1TB）、`seatLimit:1`、`priceMonthly:0`、`isActive: false`（**必须 false**：GET /api/team/plans 用户端 where isActive:true，true 会把 1TB 档泄漏为可购买套餐；getLimits 只读 sub.plan.storageLimitBytes 不读 isActive，false 零副作用）、`sort: 99`
3. `Team` `platform-team`：ownerId=`platform-owner`，isDefault: **false**（承重：true 会使 getLimits 走"默认团队回退个人订阅"分支，1TB 被忽略、回落 6GiB）
4. `TeamMember`：seed 管理员 × platform-team，role OWNER（@@unique([teamId,userId]) 幂等）
5. `TeamSubscription`：platform-team × platform-storage，status active，currentPeriodStart=now，currentPeriodEnd=2099，paidAmount=0。**必须 upsert**：migration 20260829201000 有 partial unique index `team_subscription_one_active`（teamId WHERE status='active'），裸 create 二次 seed 必冲突

**自动化 spec 钉死**（不写成手工步骤）：`getLimits('platform-team').storageLimitBytes === 1024 ** 4`（**number 比较**——getLimits 出口已 Number(BigInt)；订阅缺失/过期/非 active 静默回落 6GiB，失效极难排查）。

效果：配额代码零改动，两道闸照跑永不超限；`getUsage('platform-team')` 即平台用量；管理员个人配额零污染；Media.user 级联删除风险消失（platform-owner 无删除路径）。

### 4.2 新端点 `POST /admin/video-works/presign-video`

- Body: `{ fileName, fileSize, fileType }`
- 校验（400 + 中文原因，前端透传）：`fileType === 'video/mp4'`；`fileSize <= 1GB`
- 内部：teamId 固定 `platform-team`（不做成员校验）→ `quota.assertCanUpload('platform-team', fileSize)`（必须用 platform-team 调用，spec 断言防改回管理员个人团队——配额支点）→ `minio.buildKey('uploaded', 'system', { ext: 'mp4' })`（**ext 硬编码 'mp4'**：fileType 已强校验，fileName.split('.').pop() 可能给出 MP4/txt）→ 建 pending Media：`userId='platform-owner'`、`teamId='platform-team'`、`type='uploaded'`（**禁 temp**：temp 写 expiresAt=now+7d，temp-cleanup.processor.ts:23-24 条件含 temp → 已发布作品视频 7 天后被删）、status='pending' → `generatePresignedPost(key, fileType, fileSize, 3600)`（默认 900s=15min，1GB 慢网直传可能中途 403）
- 返回 `{ fileId, uploadUrl, key, fields }`
- **为何不复用 `StorageService.presignUpload`**（注释必写，防后人顺手合并）：presignUpload 内 `buildKey(dto.type, userId)` 与 `Media.userId = 登录用户`——key 归属与 Media.userId 恒等于调用者，正是 B 形态要去掉的；且它会走成员校验/个人团队配额

### 4.3 confirm 复用 `POST /api/storage/confirm` + 安全加固（D1）

复用路径机械验证：pending Media.userId=platform-owner ≠ 管理员 → `assertTeamMember(platform-team, admin)`（storage.service.ts:77-79）→ seed 成员 → 通过；`assertOnConfirm` 按 platform-team 配额 → 不拦；statSize 核对（±1024），不匹配自动删对象+删记录。

**D1 加固（同批修改现有 storage.service.ts）**：`confirmUpload` 就地从 media 行读 `key`/`size`，请求体只留 `fileId`（删去 dto.key/dto.fileSize）。理由：现有 dto.key 会流进失败清理路径 `minio.delete(dto.key)`——传任意 key 可让校验失败时误删任意对象（攻击面）；就地读 media 后该面消失。注意与 generated-media 的 confirm（创建者独占 + 无比对 + 清 expiresAt，语义完全不同）无关，勿动。

约束注释：确认者须为 platform-team 成员（当前=seed 管理员，新增管理员需手动加成员，登记后续项）。

### 4.4 轻量校验 `GET /admin/video-works/canvas-check?id=xxx`

- 返回 `{ id, name, ownerName: string | null, updatedAt }` 或 404。**ownerName 可空**：CanvasProject.userId 是 String?（团队画布），取 `user?.name ?? team.owner.name`；两者皆空回显"团队画布"（不得出现 "作者 null"）
- 实现抽**私有 `findCanvasRef(id)`**（返回 `{id,name,ownerName,updatedAt} | null`），三处共用防双实现漂移（仓内委托先例 storage-quota.service.ts:51）：canvas-check、create/update 校验、getDetail 现有 canvasExists 布尔
- 权限：AdminGuard 全局 /api/admin/ 前缀，天然 admin-only；**有意不做画布 owner 校验**（admin 策展跨用户）——注释写明"admin-only + 有意绕过 owner"防被当漏洞修掉
- **路由声明序（N0 硬约束）**：`canvasCheck` 与 `presignVideo` 必须声明在静态段（`@Get(':id')` 之前）——否则 GET canvas-check 被 :id 吃掉 → getWorkById('canvas-check') → 200+null ≠ 404，前端门禁失真。controller.spec 的 staticRoutes 数组同提交更新：`'listCandidates'` → `'canvasCheck'`（白名单式断言，漏加=静默覆盖漏洞）

### 4.5 createWork / updateWork 画布校验

`canvasProjectId` 非空时经 `findCanvasRef` 查存在性，不存在 → 400 "画布不存在"。**为空时不校验、允许创建**（null 分支，spec 覆盖）。

### 4.6 对象清理（域判断 + 排他 + 缓存失效；红线改写）

**旧红线及取代理由（§10 注释必写）**：video-work.service.ts:224-231 现有红线"只删 DB 行，禁止 minio.delete——videoKey 与源 Media 指向同一对象"。其前提是候选池模型；新模型 videoKey 是平台自有上传对象（uploads/system/ 域），前提消失。存量作品两种 key 形态并存（旧 `results/...` 共享对象、新 `uploads/system/...` 平台独占），**域判断收口**：

- `removeWork`：
  1. 仅当 key 以 `uploads/system/` 前缀（平台域）才删 MinIO 对象；`results/` 等旧域**只删 DB 行不删对象**（存量盘点口径：删对象前先查排他——无其他 VideoWork 引用同一 videoKey/coverKey 才删，防共享 key 互删）
  2. videoMediaId 对应 Media 行置 `deletedAt`（软删释放平台配额；getUsage 条件 status='completed' AND deletedAt:null）
  3. **缓存失效（C3）**：删对象后同步 `redis.del('videoWork:url:' + key)`（presignWork 短缓存约 58min），否则删了还能播
  4. 全程 try/catch **尽力而为不阻断**：MinIO 抖动仅记日志，作品删除照常成功；失败对象登记后续清理
- `updateWork` 换封面（coverKey 变更）：先确认新 key 已上传（表单只在 uploadCover 成功后提交）再删旧对象；删前同样排他查（其他作品未引用旧 coverKey——DTO 只 @IsString()，同一 key 理论可挂多作品，不查会互删打穿）；coverKey 走 uploadCover 不建 Media 行（system/ 域），只能记录旧 key 直接删
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

内含 objectURL（revoke 放 finally）、loadedmetadata、seek(1s)+onseeked、readyState>=2 守卫、drawImage、toBlob('image/jpeg')、限宽 1280 的完整事件舞；**Promise.race 10s 超时**归入 decode（畸形文件事件永不触发会让 Promise 永不 settle + objectURL 泄漏）。数值守卫（A4）：`Number.isFinite(duration) && videoWidth>0 && videoHeight>0` 才填字段，否则 null（DTO 全 @IsOptional 允许）；元数据守卫与抽帧互不阻断。duration=Infinity（流式/缺 moov）、宽高=0 是真实 MP4 形态。

```ts
// apps/web/src/pages/admin/utils/uploadToPresignedPost.ts
uploadToPresignedPost(args: { url: string; fields: Record<string,string>; file: File|Blob;
  onProgress?: (pct: number) => void; signal?: AbortSignal }): Promise<void>
```

XHR 实现（fetch 无上传进度，仓内无 XHR 先例）；FormData **fields 在前、file 在后**（S3 硬要求）；403 → 抛"上传超时（签名过期），请重试"。url 由调用方先过 toFlowaiUrl。

**durationSec 取整（A2）**：`video.duration` 是浮点（12.345），DTO `@IsInt()` 无 transform 直接 400（服务端 Math.round 在校验之后救不了）——**前端组装 payload 时 `Math.round`**；width/height 是 videoWidth/videoHeight 天然整数。

### 5.2 上传区流水线（create 模式，表单顶部）

- 隐藏 `input[type=file] accept="video/mp4"`，内联 `display:none`（antd :where 特异性 (0,2,1) 压 Tailwind .hidden 先例）+ `e.target.value=''` 复位（连续选同一文件，VideoWorksPage.tsx:208 先例）；accept 只是选择器过滤，JS 判断不可省
- 选文件后：前置拦截 → probeVideoFile → （抽帧 uploadCover，§5.4）→ presign-video → uploadToPresignedPost（进度百分比）→ `POST /api/storage/confirm` → 成功态（文件名+大小+时长/分辨率）
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

### 5.4 封面区（竞态消除）

时序：probe 一完成就 `uploadCover(coverBlob)` + `setCoverKey(抽帧封面)`（几百 KB 几秒内落默认值）；直传视频的几分钟里管理员若手选封面 → `coverTouchedRef=true`，后续抽帧回归 `if (!coverTouchedRef.current)` 才覆盖——"默认值先落、手选后覆盖"语义天然成立，竞态消失，§3 流水线短一步。上传最终失败也无害（无视频则门禁阻止提交）。UI 显示"已用视频截帧作默认封面"。

### 5.5 edit 模式形态

edit 不显示上传控件，显示**只读信息条**：当前视频时长/分辨率 + 封面缩略图 + 可换封面（现有封面区）。画布输入照常。文案："上传后不可更换视频，更换需删除作品重建（会丢观看/喜欢数）"。零后端改动（listAllWorks 已返回全部字段）。

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
| presign 400 | 中文原因透传 |
| 直传 403 | "上传超时（签名过期），请重试" |
| 直传其他失败/取消 | state 回落"未上传"，可重试；afterClose abort |
| confirm 大小不匹配 | 后端自动删对象+记录，前端透传文案 |
| canvas-check 404 | 红字"画布不存在"，阻止提交 |
| 画布文本改动未重新校验 | "画布已修改，请重新校验"，阻止提交，两开关回禁用 |
| createWork/updateWork 画布 400 | 兜底透传 |
| removeWork 清理失败 | 记日志不阻断，删除照常成功 |

## 7. 测试策略（TDD，每条红→绿）

### 7.1 后端 spec

1. presign-video：mp4+1GB 边界通过；非 mp4 400；>1GB 400；Media 归属（userId=platform-owner、teamId=platform-team、type=uploaded）；**断言用 platform-team 调 quota.assertCanUpload**（配额支点防回退）；generatePresignedPost 收到 3600；ext 恒 'mp4'（fileName 传 x.TXT 也产 .mp4 key）
2. confirm D1 加固：就地读 media.key/size——请求体只 fileId 即成功；dto.key 移除后旧字段传入被拒（forbidNonWhitelisted）
3. canvas-check：存在 → {id,name,ownerName,updatedAt}；团队画布 ownerName 回落 team.owner.name；不存在 → 404
4. createWork：canvasProjectId 不存在 400；**为空不校验允许创建**（null 分支）；durationSec 传 null 通过
5. updateWork：画布校验同上；换封面删旧对象（排他：旧 coverKey 被其他作品引用 → 不删）；新封面失败 → 旧封面仍在
6. removeWork：平台域 key 删对象 + Media 软删 + **redis.del('videoWork:url:'+key) 缓存失效**；**存量 `results/` 作品删除不调 minio.delete**；MinIO 失败不阻断（mock delete 抛错仍成功）
7. seed spec（自动化）：`getLimits('platform-team').storageLimitBytes === 1024 ** 4`（number 比较）
8. 路由声明序：staticRoutes 数组 `'listCandidates'` → `'canvasCheck'`（既有 spec 机制复用，canvasCheck 在 :id 之前）

### 7.2 前端 test

1. 重写候选用例为上传路径（原 :22 mock/:115 create/:194 pageSize + fixtures :50/:177 按实际清点处理）
2. `input[type=file]` 内联 `display:none` 锚点（防回退 .hidden）
3. probeVideoFile 单测：loadedmetadata 元数据（jsdom 属性直赋 + fireEvent，fixture duration=12.345 → durationSec=12 钉取整）；error → decode；数值守卫（Infinity/0 宽高）→ 字段 null 非整体失败；**事件永不触发 → 10s 超时 decode**（fake timers）；stub URL.createObjectURL/revokeObjectURL（FilePreviewPopover.test.tsx:29-39 先例）；stub canvas.getContext（jsdom 默认 null，EraseCanvas/PreviewPlayer 先例）+ mock toBlob
4. uploadToPresignedPost 单测：fields 前 file 后；onprogress；abort signal；403 文案
5. 表单编排（mock 两模块）：成功 → payload 带 videoKey/videoMediaId/durationSec(取整)/width/height；失败/取消 → 门禁仍生效可重试；**afterClose → abort 被调用 + 状态机全重置**（非 unmount）
6. canvasProjectId **注册性**：payload 带解析后 ID（C-1 家族回归）
7. parseCanvasRef 表驱动：绝对/相对 URL、裸 ID、空白、带引号、无 projectId 回落
8. canvas-check 门禁状态机：未校验通过阻止提交；**校验后改动文本 → 阻止提交 + 两开关回禁用**；ownerName null → 显示"团队画布"
9. edit：无上传控件（只读信息条）、payload 不含 videoKey/videoMediaId、画布可改
10. 封面竞态：probe 后自动 uploadCover；手选封面后抽帧不覆盖（coverTouchedRef）；重开弹层（afterClose）coverTouched 复位

### 7.3 浏览器验收

1. **前置**：seed 后平台团队限额生效（1TB）——见 §8 上线顺序，未 seed 的库必挂（回落 6GiB → FK 500 → confirm 403）
2. 真实 MP4 上传 → 进度条 → 建作品 → 前台播放 + 制作过程 + 克隆全链路
3. HEVC/.mov → 闸门文案"浏览器无法解码"；>1GB → 前置拦截
4. 可选：慢网进度条 + 签名过期路径；dev 下 /flowai 代理对 PUT/POST 生效（A1 改写）

## 8. 上线顺序（A3：运行期硬依赖）

平台团队是**运行期硬依赖**，未 seed 的库失败形态：assertCanUpload 静默回落 6GiB 不报错 → `media.create({teamId:'platform-team'})` FK 违例 500 → confirm 侧 assertTeamMember 403。部署清单：

1. schema/migrations（本设计无 Prisma 变更，可省）
2. `prisma db seed`（新增 platform-owner/User、TeamPlan、Team、TeamMember、TeamSubscription 五行）
3. 重启 api
4. 验证：`getLimits('platform-team') === 1TB`（seed spec 即自动化验证）

仓内约定：结构行写 seed.ts 并跑 prisma db seed（dev-data-cleanup-design.md:98）；deploy.sh 只上传 apps/api/src 不含 prisma/，生产需手动带 seed。

## 9. 登记后续项

- stale Media 清理任务两类（N4）：① type=uploaded AND status=pending AND createdAt>24h → 删对象+记录（悬挂 pending，台账噪音不占配额）；② type=uploaded AND status=completed AND createdAt>24h AND **无 VideoWork.videoMediaId 引用**（先查引用再删）→ 删对象+软删记录（表单放弃的 confirm 行占平台配额，性质与①不同）
- 新增管理员需手动加入 platform-team 才能 confirm（当前仅 seed 管理员）
- removeWork 清理失败对象的兜底清理任务
- edit 不可换源代价已用 UI 文案缓解；失误率高再考虑"重建时继承 viewCount/likeCount"工具

## 10. 关键注释清单（实现时必须落注释）

| 位置 | 注释 |
|---|---|
| presign-video | type 必须 'uploaded' 禁 temp（7d 清理 footgun）；fileSize 上限不得超 ~2GiB（Media.size 是 Postgres Int，超出需迁 BigInt）；teamId 固定 platform-team 是配额支点；**为何不复用 presignUpload**（key/Media.userId 恒等于调用者，正是 B 形态要去掉的） |
| storage confirm（D1） | 就地读 media.key/size 的安全理由（dto.key 流入失败清理 minio.delete 的任意对象删除面） |
| canvas-check / findCanvasRef | admin-only + 有意绕过画布 owner 校验（admin 策展跨用户），非漏洞；三处共用防双实现漂移 |
| controller 静态段 | canvasCheck/presignVideo 必须在 :id 之前（:id 会吃掉静态段路由） |
| removeWork | **取代旧红线**（旧：只删 DB 行禁 minio.delete；理由：旧前提是 videoKey 与源 Media 共享对象，新模型平台域独占）+ 域判断 + 排他校验 + 缓存失效 |
| seed | platform-team isDefault:false 承重（true 回落个人订阅分支）；TeamPlan isActive:false 防泄漏到用户端套餐列表（getLimits 不读 isActive）；TeamSubscription partial unique index → 必须 upsert；TeamMember 在 admin 创建之后 |
| confirm | 确认者须为 platform-team 成员 |
| 前端表单 | 悬挂 pending 行是已知台账噪音（§9）；abort 挂 afterClose 的原因（组件常驻不卸载） |
| 上传 input | 内联 display:none 的特异性原因；e.target.value='' 复位原因 |
| uploadToPresignedPost | fields 前 file 后的 S3 要求；403=签名过期映射 |

