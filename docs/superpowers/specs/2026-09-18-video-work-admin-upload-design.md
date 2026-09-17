# 管理后台视频作品——成品视频上传改造设计

日期：2026-09-18
状态：设计定稿（两轮用户确认）

## 1. 背景与业务口径

视频作品 = **成品视频** + **源画布（可选）**。

- 成品视频不一定由视频剪辑节点导出：复杂视频的用户会把画布生成的多个片段下载到本地，用专业软件（PR/剪映）编辑合并成最终成品。因此作品视频来源改为**管理员本地上传**。
- 源画布（克隆画布）= 制作该成品视频所用的画布，承载创作过程分享（各节点、提示词、连线步骤）与克隆功能。**可选**：不关联也可建作品，但"允许查看创作过程/允许克隆"两开关禁用。
- 现有"候选视频"下拉（视频剪辑节点导出产物池，origin=video-project）只覆盖剪辑导出路径，**删除**。

## 2. 范围

| 动作 | 内容 |
|---|---|
| 删 | 前端候选下拉及 candRef/selCandRef 组装（VideoWorksPage.tsx:209-250,151-152,182-198）、`adminApi.listCandidates`（adminApi.ts:198）、后端 `GET /candidates`（controller:29-32）+ `service.listCandidates`（video-work.service.ts:73-103）。`presignWork` 保留（列表/详情在用） |
| 加 | 成品视频上传（预签直传）、画布 ID/URL 关联、canvas 存在性校验端点、删除作品/换封面时的对象清理、平台团队 seed、两个前端工具模块 |
| 不变 | 编辑作品不可换视频源（换源=删除重建）；`allowViewProcess`/`allowClone` 联动；表单其余字段 |

## 3. 上传链路总览

```
选文件 → JS 前置拦截（非 mp4 / >1GB，中文提示，不进上传）
       → probeVideoFile 本地探测（objectURL + <video>）
           loadedmetadata → durationSec/width/height（守卫见 §6）
           seek 1s → canvas 抽帧 → coverBlob('image/jpeg', 限宽 1280)
           error → 拦截："浏览器无法解码，请导出 H.264 编码 MP4"
       → POST /admin/video-works/presign-video     （API 只签名， expiresIn=3600s）
       → POST uploadUrl + fields（XHR 直传 MinIO，字节不过 API，带进度）
           fields 字段在前、file 在后（S3 presigned POST 硬要求）
       → POST /storage/confirm（复用现有端点，验收 + 置 completed）
       → coverBlob → 复用现有 uploadCover multipart（不建 Media 行，返回 key）
       → onFinish 提交 videoKey/videoMediaId/durationSec/width/height
```

## 4. 后端设计

### 4.1 平台团队 seed（B 形态：专用系统用户）

seed.ts 追加（全部固定 id、幂等 upsert）：

- `User` `platform-owner`：无凭据系统用户（不参与登录，仅作归属）
- `TeamPlan` `platform-storage`：storageLimitBytes = 1TB（1024^4）
- `Team` `platform-team`：ownerId = `platform-owner`，isDefault: **false**（承重：改 true 会使 getLimits 走"默认团队回退个人订阅"分支，1TB 被忽略）
- `TeamMember`：seed 管理员加入 platform-team（role OWNER）
- `TeamSubscription`：platform-team × platform-storage，status active，currentPeriodEnd = 2099 年；字段形状照 team-subscription.service.ts:100-105 的 create（planId/status/currentPeriodStart/currentPeriodEnd/paidAmount 别漏）

效果：配额代码零改动，presign/confirm 两道闸照跑永不超限；`getUsage('platform-team')` 即平台存储用量；管理员个人团队配额零污染；Media.user 级联删除风险消失（userId=platform-owner 无人删）。

**自动化 spec 钉死**：`getLimits('platform-team').storageLimitBytes === 1TB`（订阅缺失/过期/非 active 时静默回落 6GiB，失效极难排查，不写成手工步骤）。

### 4.2 新端点 `POST /admin/video-works/presign-video`

- Body: `{ fileName, fileSize, fileType }`
- 校验（400 + 中文原因，前端透传）：`fileType === 'video/mp4'`；`fileSize <= 1GB`
- 内部：teamId 固定 `platform-team`（不做成员校验）→ `quota.assertCanUpload('platform-team', fileSize)`（必须用 platform-team 调用，spec 断言防后人改回管理员个人团队——这是整个设计的支点）→ `minio.buildKey('uploaded', 'system', { ext })`（平台资产聚在 system/ 域，与封面同域，运维好找）→ 建 pending Media：`userId='platform-owner'`，`teamId='platform-team'`，`type='uploaded'`（**禁 temp**：temp 写 expiresAt=now+7d，已发布作品的视频会被清理任务删掉）→ `generatePresignedPost(key, fileType, fileSize, expiresIn=3600)`（默认 900s=15min，1GB 慢网直传可能中途签名过期 403）
- 返回 `{ fileId, uploadUrl, key, fields }`

### 4.3 confirm 复用现有 `POST /storage/confirm`

机械验证过的路径：pending Media.userId=platform-owner ≠ 操作管理员 → `assertTeamMember(platform-team, admin)` → seed 已把管理员加为成员 → 通过；`assertOnConfirm` 按 platform-team 配额（1TB）→ 不拦；statSize 核对真实大小（±1024），不匹配自动删对象+删记录。

约束注释：presign 与 confirm 可以是**不同管理员**，但确认者必须是 platform-team 成员（当前=seed 管理员；新增管理员需手动加成员，登记后续项）。

### 4.4 轻量校验端点 `GET /admin/video-works/canvas-check?id=xxx`

- 返回 `{ id, name, ownerName, updatedAt }` 或 404
- ownerName 必带：同名画布的唯一区分信息
- 权限：AdminGuard 全局按 /api/admin/ 前缀生效，天然 admin-only；**有意绕过画布 owner 校验**（画布属于创作者，admin 策展需跨用户访问）——注释写明，防将来被当漏洞"修掉"

### 4.5 createWork / updateWork 画布校验

`canvasProjectId` 非空时查 CanvasProject 存在性，不存在 → 400 "画布不存在"（服务端兜底，防"制作过程永久报错"的脏数据）。**为空时不校验、允许创建**（null 分支，spec 覆盖）。

### 4.6 对象清理（尽力而为、不阻断）

- `removeWork`：try/catch 删 MinIO 对象（videoKey + coverKey）+ Media 行置 `deletedAt`（软删即释放平台配额，getUsage 条件 status='completed' AND deletedAt=null）。MinIO 抖动失败 → 仅记日志，照常删除成功；失败对象登记进后续清理任务
- `updateWork` 换封面（coverKey 变更）：**先确认新封面上传成功（表单只会在拿到新 key 后提交）再删旧对象**——顺序反过来=封面永久丢失。封面走 uploadCover 不建 Media 行（system/ 域），所以只能"记录旧 key → 直接删对象"，无台账兜底。spec：新封面失败 → 旧封面对象仍在

### 4.7 删除候选池

前端唯一消费者是本表单，删除闭合（§2）。`CandidateMedia` 类型随删。

## 5. 前端设计

### 5.1 模块抽取（表单只做编排）

两个独立小模块，各自单测，表单测试 mock 之：

```ts
// apps/web/src/pages/admin/utils/probeVideoFile.ts
probeVideoFile(file: File): Promise<
  | { ok: true; durationSec: number | null; width: number | null; height: number | null; coverBlob: Blob | null }
  | { ok: false; reason: 'decode' }   // 仅 video error（编码/容器浏览器不支持）
>
```

内含 objectURL 创建/释放、loadedmetadata、seek(1s) + onseeked、readyState>=2 守卫、canvas.drawImage、toBlob('image/jpeg')、限宽 1280 的完整事件舞。数值守卫（A4）：`Number.isFinite(duration) && videoWidth > 0 && videoHeight > 0` 才填对应字段，否则该字段为 null（DTO 全 @IsOptional 允许缺省）；抽帧独立守卫 readyState>=2，与元数据守卫互不阻断——元数据缺失但可 seek 时 coverBlob 照常返回。duration=Infinity（流式/缺 moov）、宽高=0 是真实存在的 MP4 形态。

```ts
// apps/web/src/pages/admin/utils/uploadToPresignedPost.ts
uploadToPresignedPost(args: { url: string; fields: Record<string,string>; file: File|Blob;
  onProgress?: (pct: number) => void; signal?: AbortSignal }): Promise<void>
```

XHR 实现（fetch 无上传进度）；FormData **fields 字段在前、file 在后**；403 → 抛"上传超时（签名过期），请重试"。仓内无 XHR 先例，全新代码，隔离后好测。

### 5.2 上传区流水线（create 模式，表单顶部）

- 隐藏 `input[type=file] accept="video/mp4"`，内联 `display:none`（antd :where 特异性 (0,2,1) 压 Tailwind .hidden 先例）；`e.target.value=''` 复位（连续选同一文件，VideoWorksPage.tsx:207 先例）；accept 只是文件选择器过滤，JS 判断不可省
- 选文件后：前置拦截（类型/大小，中文 message.error）→ probeVideoFile → presign-video → uploadToPresignedPost（进度百分比）→ /storage/confirm → 成功态
- 抽帧 coverBlob → uploadCover → 默认 coverKey（管理员可手换）
- 成功态显示：文件名 + 大小 + 时长/分辨率
- 组件卸载（Modal destroyOnClose）/关闭时：`xhr.abort()` + 提示"上传已取消"（AbortSignal 贯穿）
- 上传失败/取消 → state 回落"未上传"，门禁仍生效，可重试
- 悬挂 pending 说明（注释）：直传失败未 confirm 的 Media 行永不过期（type=uploaded 无 expiresAt、现有 temp 清理任务抓不到），不占配额，已知台账噪音，登记后续项

### 5.3 源画布输入（A1：防 C-1 注册陷阱重演）

- **可见输入框本身就是 `name="canvasProjectId"` 注册字段，值=原始文本**（rc-field-form onFinish 只含已注册字段，隐藏字段 setFieldsValue 写入提交时恒 undefined 的 C-1 教训）
- onFinish 用导出纯函数 `parseCanvasRef(text): string | null` 现算最终 ID，表驱动单测覆盖：绝对 URL、相对 URL（`new URL(v, location.origin)` 解析 /canvas?projectId=x 形式）、裸 ID、首尾空白、控制台粘贴带引号、URL 无 projectId 参数时回落"整串当裸 ID"
- canvas-check 异步结果只用于**回显 + 门禁**，不写回表单值：
  - 校验通过 → 回显"画布：{name}（作者 {ownerName}）"
  - 404 → 红字"画布不存在"
  - **校验通过后文本又被改动 → 阻止提交并提示"画布已修改，请重新校验"**（状态机，漏掉会保存错误画布）
  - 未校验通过（含解析不出 ID）→ 阻止提交
- 两开关 ProFormDependency 基于同一字段自然联动（现有逻辑不变）
- edit 模式允许改画布（updateWork 校验支持，贴错必须能改）

### 5.4 封面区

现有手动上传保留；抽帧成功后显示"已用视频截帧作默认封面"，手动换图覆盖 coverKey。

### 5.5 edit 模式形态（A5）

edit 不显示上传控件，显示**只读信息条**：当前视频时长/分辨率 + 封面缩略图 + 可换封面（现有封面区）。画布输入框照常可用。文案钉住："上传后不可更换视频，更换需删除作品重建（会丢观看/喜欢数）"。

### 5.6 表单状态与门禁

- videoKey/videoMediaId/durationSec/width/height 存组件 state（替代 selCandRef 模式）；afterClose 重置（防残留）
- create 门禁：未上传成品视频不可提交（"请先上传成品视频"）；edit 不需要
- onFinish：create 从 state 组装 videoKey/videoMediaId/durationSec/width/height + coverKey；edit 剔除 video 源字段（现状不变）

## 6. 错误处理契约

| 场景 | 行为 |
|---|---|
| 选文件非 mp4 / >1GB | 前端即时 message.error（中文原因），不进上传 |
| 探测 video error | "浏览器无法解码，请导出 H.264 编码 MP4"（同时是可播放性闸门，拦截 HEVC/ProRes/.mov） |
| 探测数值守卫不过 | 三字段留空，仍可上传（作品缺时长/分辨率可接受） |
| presign 400 | 中文原因透传 |
| 直传 403 | "上传超时（签名过期），请重试" |
| 直传其他失败/取消 | state 回落"未上传"，可重试；卸载时 abort |
| confirm 大小不匹配 | 后端自动删对象+记录，前端透传文案 |
| canvas-check 404 | 输入区红字"画布不存在"，阻止提交 |
| createWork/updateWork 画布 400 | 兜底透传 |
| removeWork 清理失败 | 记日志不阻断，作品删除照常成功 |

## 7. 测试策略（TDD，每条红→绿）

### 7.1 后端 spec

1. presign-video：mp4 + 1GB 边界通过；非 mp4 400；>1GB 400；Media 归属（userId=platform-owner、teamId=platform-team、type=uploaded）；**断言用 platform-team 调 quota.assertCanUpload**（防改回个人团队）；expiresIn=3600 传入
2. canvas-check：存在 → {id,name,ownerName,updatedAt}；不存在 → 404
3. createWork：canvasProjectId 不存在 400；**为空时不校验、允许创建**（null 分支）
4. updateWork：画布校验同上；换封面 → 删旧对象；**新封面失败 → 旧封面仍在**（顺序）
5. removeWork：删 videoKey+coverKey 对象 + Media 软删；**MinIO 失败不阻断**（mock delete 抛错仍返回成功）
6. seed spec（自动化，非手工步骤）：`getLimits('platform-team').storageLimitBytes === 1TB`

### 7.2 前端 test

1. 重写 3 条候选用例为上传路径（payload 五字段、edit 禁字段、pageSize 满额删除）
2. `input[type=file]` 内联 `display:none` 锚点（防回退到 .hidden）
3. probeVideoFile 模块单测：loadedmetadata 元数据断言（jsdom 属性直赋 + fireEvent）；error → decode；数值守卫（Infinity/0 宽高）→ 对应字段 null 而非整体失败；stub URL.createObjectURL/revokeObjectURL（FilePreviewPopover.test.tsx:29-39 先例）；stub canvas.getContext（jsdom 默认 null，EraseCanvas/PreviewCanvas 先例）+ mock toBlob
4. uploadToPresignedPost 模块单测：fields 在前 file 在后；onprogress 回调；abort signal；403 文案
5. 表单编排测试（mock 两个模块）：上传成功 → payload 带 videoKey/videoMediaId/durationSec/width/height；失败/取消 → 门禁仍生效可重试；unmount → abort 被调用
6. canvasProjectId **注册性**：提交 payload 确实带解析后 ID（C-1 家族回归设防）
7. parseCanvasRef 表驱动：绝对/相对 URL、裸 ID、空白、带引号、无 projectId 回落
8. canvas-check 门禁状态机：未校验通过阻止提交；**校验后改动文本阻止提交**（"画布已修改"）
9. edit 模式：无上传控件（只读信息条）、payload 不含 videoKey/videoMediaId、画布可改
10. 抽帧触发 uploadCover

### 7.3 浏览器验收

1. 真实 MP4 上传 → 进度条 → 建作品 → 前台播放 + 制作过程页 + 克隆全链路
2. HEVC/.mov 文件 → 闸门文案"浏览器无法解码"
3. >1GB 文件 → 前置拦截
4. 可选：慢网验证进度条 + 签名过期路径
5. seed 后平台团队限额生效（1TB）

## 8. 登记后续项

- stale pending Media 清理任务（type=uploaded 且 status=pending 且 createdAt>24h → 删对象+记录）
- 新增管理员需手动加入 platform-team 才能 confirm（当前仅 seed 管理员）
- removeWork 清理失败的对象的兜底清理任务
- edit 不可换源的操作代价已用 UI 文案缓解；若未来失误率高再考虑"重建时继承 viewCount/likeCount"工具

## 9. 关键注释清单（实现时必须落注释）

| 位置 | 注释 |
|---|---|
| presign-video | type 必须 'uploaded' 禁 temp（expiresAt 7d 清理 footgun）；fileSize 上限不得超 ~2GiB（Media.size 是 Postgres Int，超出需迁 BigInt）；teamId 固定 platform-team 是配额支点 |
| canvas-check | admin-only + 有意绕过画布 owner 校验（admin 策展跨用户），非漏洞 |
| seed | platform-team 的 isDefault:false 承重（true 会回落个人订阅分支）；TeamSubscription 三态（缺失/过期/非 active）静默回落 6GiB |
| confirm | 确认者须为 platform-team 成员 |
| 前端表单 | 悬挂 pending 行是已知台账噪音（见 §8） |
| 上传 input | 内联 display:none 的特异性原因；e.target.value='' 复位原因 |

