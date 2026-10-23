# T19 UX 签字留痕（plan v11.2 Task 19——五项验收描述+证据锚+签栏）

> 纪律：签字权在用户，本记录只承载验收描述与可验证证据面（测试锚/实现/复现步骤），不代签。
> plan :270 复选框维持未勾（待签）——五项全部签署后勾选并注明日期。
> 2026-10-23 出口裁定批补验：浏览器级证据（40MP 满幅/超限降尺度+告知/Range 206·416·HEAD/视频双向 seek）=`F4-browser-acceptance.md`；有载跨链路（投递 lag≤3s tick/事实拉取发布/物化退避推进——真 WS soak 并发）=`assets/f5-loaded-crosslink.json`+`assets/soak-f5.json`。

## ① slot 交互（分镜格位）

**验收描述**：分镜格位读写稳定——并发 slot 竞态（同格位两成员/等值 slot）不丢成员不 500，读序 (slot,id) tie-break 稳定；cs data.cells 派生缓存与 doc slot 权威一致（双写者单源核心）。

**证据锚**：
- e2e 串联：`apps/api/src/modules/collab/collab-harness/provider-convergence.e2e-spec.ts` 场景 E（两真 WS 客户端并发 slot/order 等值键竞态——双端收敛等值+零成员丢失+`scanOrderPathology` duplicate-key 档计数）。
- 读序单源：`packages/shared/src/canvas/order-records.test.ts`（compareWithinLayer (slot,id)/(order,id) 双 tie-break）+`order-pathology.test.ts`（重复键容忍+计数——v14 口径）。
- cells 派生：`apps/web/src/stores/canvasStore.ts` `computeStoryboardCellsPatch`（共享核心——命令点与 reconcile 写域⑥ 同取数/派生/同值判定）；渲染面 `StoryboardGroupRenderer.tsx:67`（cells 缓存读）。
- 复现步骤：画布建分镜组→两浏览器客户端并发拖入同格位成员→两端节点数一致且排序稳定；`collab_order_pathology_total` 零增长（健康档）。

**签栏**：＿＿＿＿＿＿＿＿（签字/日期）

## ② replace 命令 409 交互

**验收描述**：用户 replace 产物（变换保存/AI 编辑回填等四客户端写路径迁移命令）遇 `expectedRev` 过期（槽位已换代）→409 ARTIFACT_REV_CONFLICT+槽位不被旧写覆盖；客户端拿到 errorCode 可提示重试。

**证据锚**：
- int：`apps/api/src/modules/collab/collab-media.int.spec.ts:161`（409：expectedRev 过期→ARTIFACT_REV_CONFLICT+槽位不被覆盖）。
- 实现载体：`apps/api/src/modules/collab/collab-media.controller.ts`（PG 单事务 CAS——0 行=superseded→409；409 载体=BusinessException errorCode）。
- 线形态：`apps/api/src/filters/http-exception.filter.ts`（errorCode 透出进 body `{code:-1,...,errorCode}`）+`http-exception.filter.spec.ts`。
- 投影侧 superseded 不覆盖用户值：`projection-outbox.poller.int.spec.ts`（superseded 用例）+e2e 场景 B（replace 后旧投影 superseded+doc 用户值保住）。
- 复现步骤：两标签页同节点先后触发 replace→后提交者（持旧 rev）收 409 提示；槽位值=先提交者的新产物。

**签栏**：＿＿＿＿＿＿＿＿（签字/日期）

## ③ 40MP 上限（图片像素域）

**验收描述**：probe 轮对超 40MP（MAX_IMAGE_PIXELS）图片 sharp downscale 到域内再入库——固有尺寸事实=降尺度后值；超限时明确告知「已自动缩小至支持尺寸」（原尺寸）；用户感知=大图可正常装载不炸内存。

**证据锚**：
- int：`apps/api/src/modules/media/media-probe.int.spec.ts`「40MP+downscale 产品策略」用例（`naturalWidth×naturalHeight ≤ MAX_IMAGE_PIXELS`+降尺度+outbox payload 携 downscaledFrom 断言——锚用例名防行号漂移）。
- 实现载体：`apps/api/src/modules/media/media-probe.poller.ts`（sharp 重编码=执行边界——probe 分型批卡 T7）。
- 降尺度告知链（F4c——浏览器验收缺口补齐）：api probe resize 分支记录原尺寸 → natural fact payload 携 `downscaledFrom {width,height}`（形态单源=shared `media-fact.ts` `MediaNaturalFactPayload`；正常/视频路径零键——int 同用例 payload 断言）→ web `mediaFactsRuntime.ts` ingest（doc 已引用即到即告知）与 pending 消费窗 `message.info`「图片超过尺寸上限，已自动缩小至支持尺寸（原 w×h）」每 mediaId 每会话恰一次（红绿测 `apps/web/src/stores/mediaFactsRuntime.test.ts` F4c describe）。
- 上传者会话链锚（F4c 双评审 P0）：上传 confirm 成功后双档延时定向补拉（`mediaFactsRuntime.ts` `scheduleUploadFactPull` 12s/30s——②lazy 被本地 origin 过滤+④watcher 对无 state fact 的上传图结构性不适用；挂点=ImageGenNode `handleUploadFile`+MultiImageNode 逐 fileId confirm 尾）。
- 复现步骤：上传 >40MP 图（如 8000×6000）→素材库事实 natural≈域内值（<7000 宽）→约 12s 后（同会话内）出现「已自动缩小至支持尺寸（原 8000×6000）」提示（每图每会话一次；重连/其他协作者引用亦触发）→节点装载/渲染正常。

**签栏**：＿＿＿＿＿＿＿＿（签字/日期）

## ④ content 两态下载行为

**验收描述**：ready 态=MinIO X-Accel-Redirect 内部 location（Range/HEAD/ETag/304/416——视频可拖动 seek）；processing 态=allowlist 代理降级（上限降级 410/425）；下载入口按两态给正确字节流。

**证据锚**：
- int：`apps/api/src/modules/media/media-content.int.spec.ts:182`（ready 真 S3 全链：HEAD Content-Length/Range 206+Content-Range/越界 416/If-None-Match 304——「视频可拖动的顺序读契约」）+processing 代理降级用例（同文件）。
- 实现载体：`apps/api/src/modules/media/`（media-content.controller——ready=X-Accel/processing=sourceUrl 代理；读侧 presign 旁路零存在）。
- 复现步骤：视频产物 ready 后节点全屏播放拖动进度条（Range 生效）；processing 期占位可播 seek；右键下载=完整文件。

**签栏**：＿＿＿＿＿＿＿＿（签字/日期）

## ⑤ video processing UX

**验收描述**：video 异步 materialize 期节点=processing 可播 seek 占位（sourceUrl 代理）；processing→completed/failed 由 web 会话级退避补拉自动刷新（无需用户操作/重连/换引用）；暂态失败由服务端 MaterializeJob 自动重试（无需用户操作）；终态失败=MATERIALIZE_FAILED errorCode+补偿退款（UI 保留 fileId、显示失败及退款结果+「刷新状态」按钮拉取最新 facts——非重走 materialize、非撤回交付；退款后重新生成=正常资金流程）；completed 后自然切成品播放。

**证据锚**：
- int：`apps/api/src/modules/artifact-core/materialize.int.spec.ts`（processing claim/瞬态退避/mismatch 终态退款/lease fence）；`intent-reconcile-r3.int.spec.ts` 窗⑤（video processing 重试链归 MaterializeJob——R3 不重造）。
- facts 通道（UI 真实驱动）：`media-facts.controller.ts`（POST /api/media/facts——pending→published at-least-once）+web `mediaFacts.ts`/`useMediaFact`（processing/failed 驱动 VideoGenNode 占位与错误重试；natural 尺寸决策数据源——T19 登记收口）。
- F3 自动刷新：web `apps/web/src/stores/mediaFactsRuntime.ts` processing watcher（仅当前引用中 processing 媒体·会话级退避 4s→8s→16s→帽 30s·集合变化重置·切项目丢弃在飞响应）——红绿测 `apps/web/src/stores/mediaFactsRuntime.test.ts`；组件级测试归 Y2 登记不变。
- 复现步骤：生成视频节点→交付后 processing 占位可播放拖动→静置不动（无重连/无换引用）节点自动刷新至成品播放或终态失败（退避补拉）→（源过期形态）失败显示错误+「刷新状态」按钮→点击拉取最新 facts（非重走 materialize：暂态失败由服务端 MaterializeJob 自动重试；终态失败保留 fileId+显示失败及退款结果；退款后重新生成=正常资金流程——新生成任务重新计费）。
- 登记（评审#5 不修）：processing 可播 seek 的**组件级**自动化测试归 Y2（VideoGenNode processing 占位渲染+seek 交互的组件测试面）；本卡以 int 链（materialize/content 两态）+UX 签字复现步骤承载。

**签栏**：＿＿＿＿＿＿＿＿（签字/日期）
