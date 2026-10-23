# F4 浏览器级补验证据（裁定④：私有桶下载/跨团队拒绝/Range/大图装载）

> 2026-10-23 控制器亲驱真浏览器（Chromium In-app Browser）+ 本地全栈（api dev :3000 / vite :5173 /
> PG / MinIO :9000 / worker dist 进程）录制。人工体验签栏仍留空——本文件是**机器可复核的浏览器级
> 证据**，不替代 T19-ux-signoff.md 的人工签署。

## 环境

- 栈：`pnpm --filter @flowweb/api dev`（main.ts，COLLAB_ROLE=all）+ `vite`（web :5173，
  `/api`→:3000、`/flowai`→MinIO 代理）+ `node dist/main-worker.js`（worker 进程——
  MediaProbePoller/MaterializeJob 所在面；**api 进程不跑 DB poller**，dev 需另起 worker）。
- 账号：手机号验证码登录（Redis 直种 OTP 绕过真短信——dev 装置），新用户自动建个人团队，
  画布自建项目 `cmvkhxmwy0056zcd5cu4qly1g`。
- 上传路径=**真实链路**：页面内 DataTransfer 注入 file input（IAB 无文件选择器）→presign→
  MinIO POST 204→confirm→probe worker 异步处理。零 mock。

## ① 40MP 上限·边界内满幅装载（裁定③「补浏览器大图装载验收」）

- 输入：8000×5000（=40.0MP 恰上限）JPEG 1,388,461B，经节点上传全链。
- 结果：`<img>` naturalWidth/Height=**8000×5000 完整解码**，complete=true，页面零崩溃；
  `performance.memory`：usedJSHeap **53MB** / totalJSMB 58 / limit 4096MB。
- 截图：`assets/f4-bigimage-canvas.png`（画布节点实际渲染该图）。

## ② 超限降尺度（46.8MP→≤40MP）

- 输入：9000×5200（46.8MP）JPEG 1,330,518B 同链上传。
- probe worker 实测：`probeState=done`，natural=**8320×4807**（39,994,240px≤40M 恰边界），
  对象同 key 重编码回写（1.33MB→**691,966B**）。
- 浏览器强制重取（`cache:'reload'`）：200/691,966B/`Content-Type: image/jpeg`/
  `ETag "7f4ca820…"`/`Accept-Ranges: bytes`，`createImageBitmap` 解码 8320×4807——**降尺度后
  字节真实可装载**。
- ⚠️ 验收时发现缺口→**已修并浏览器复验**（F4c）：「已缩小至支持尺寸」**用户告知原本不存在**
  （probe 注释称 UI 侧归前端、前端无落点）——签字③承诺与实现脱节。根修：natural fact payload
  携 `downscaledFrom`（shared `MediaNaturalFactPayload` 单源）+web ingest 告知恰一次+上传点
  12s/30s 延时定向补拉（spec 评审 P0：上传者本人会话②驱动被本地 origin 过滤、④watcher 对
  无 state fact 的上传图结构性不适用——不补拉则 toast 推迟到重连）。**复验**（2026-10-23 活
  浏览器+MutationObserver 持久捕获）：超限上传后同会话内捕获 toast
  「图片超过尺寸上限，已自动缩小至支持尺寸（原 9000×5200）」**恰一次**（两次补拉去重实证）。

## ③ Range/HEAD（浏览器上下文·私有桶 API 流）

对 `/api/media/06781eae-…/content` 页内 fetch：

| 请求 | 结果 |
|---|---|
| `Range: bytes=100-199` | **206**，恰 100B，`Content-Range: bytes 100-199/691966` |
| `Range: bytes=999999999-` | **416** |
| `HEAD` | 200，`Content-Length: 691966`，`image/jpeg` |

## ④ 视频 ready 态可拖动 seek（真 mp4·私有桶流）

- 输入：ffmpeg testsrc 6s/640×360/H.264/yuv420p/`+faststart`（moov 前置=Range seek 友好），
  38,797B，页内全链上传（presign→204→confirm ok→probe done natural=640×360）。
- 浏览器 `<video src=/api/media/7224e119-…/content>`：**canplay→duration=6s→seek 4.2s 成功
  （seeked 事件+画面解码：64×36 采样 18 distinct colors，非黑屏）→seek 回 0.5s 成功**。
  「视频可拖动的顺序读契约」在真实浏览器+私有桶流下成立。

## ⑤ 跨团队拒绝/processing 代理（API 面回归，非浏览器面）

- 跨团队 403/单门①-④/presign 旁路删除：`media-content.int.spec.ts` **7/7 passed**（真 MinIO）。
- processing 态 allowlist 代理降级（410/425）：同 spec 覆盖。
- 浏览器面的 processing 占位可播/下载入口视觉验收归 T19-ux-signoff ④⑤ 人工签（需真实
  provider 源视频；本机无可信上游可代理）。

## 边界与诚实记录

- img 标签刷新后短暂呈现旧缓存尺寸（同 URL 无 cache-busting）——`cache:'reload'` 取证已消除
  观察偏差；产品语义不受影响（降尺度为异步后写，签字③ UX 顺序=先原图后告知）。
- worker 进程以**构建产物**启动（`nest build`+`node dist/main-worker.js`）；`tsx` 直启因
  DI 令牌双实例失败（ts-node 类工具的已知形态，非产品缺陷——生产即 dist 形态）。
- dev 默认 `COLLAB_ROLE=all` 只并 Bull 消费者，**不含** DB poller——本地全栈需三进程
  （api/worker/web），此点已作为部署/开发注记带入 F5 汇总。
