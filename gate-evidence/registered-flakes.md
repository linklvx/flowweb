# 登记不修 flake 台账（Controller 台账——Y1c T19 双评审 spec-M-4 落痕）

- **ENOTEMPTY rmdir 竞态**（collab-project-actor.spec.ts per-connection 入站排队用例收尾）：
  复现条件=Windows 全池并发下偶现（2026-10-24 两次全池一次复现，单跑恒绿）；归因=collab-spool
  临时目录清理竞态存量（fs.rm/rmdir 与并发句柄释放窗口——非 Y1c T19 引入，T9 actor 落地起在库）；
  处置=CI 复现时单独收口（本批零动作——登记留痕防误判回归）。

- 2026-10-26（Y1c T21 收口批登记）：apps/api collab-harness 系 spec 偶发端口竞态（`collab_state: starting→start-failed`——多套件并行抢 COLLAB_PORT/监听窗；净跑全绿〔api 全池 2957/2957 复验〕；quality 复核裁定=可接受环境 flake 需登记非回归）。

- 2026-10-26（Y1c T22 G5 末轮小收口登记①）：web 池 stale-transform-cache flake——陈旧 vitest transform 缓存间歇供给旧版
  `@flowweb/shared`（症状=read-model-census compose 用例/runtimeStore 乱序·墓碑三例「undefined」形态=旧 merge/词表在跑）；
  处置=清 `node_modules/.vite/vitest`（web+root+shared 三处）复绿；建议=CI 缓存键纳 git SHA 或 vitest `cache:false`
  （登记留痕防误判代码回归——症状面=纯语义旧版供给非逻辑红）。

- 2026-10-26（Y1c T22 G5 末轮小收口登记②）：soak heavy echo p95 环境敏感——实测 18-42s 超预算 50ms（本机负载态放大
  echo 回声累积窗）；A/B 判定=pre-T22 基线 9d3ada45 同机同败 ⇒ 环境态非回归；该 spec 自注「环境抖动=单次重跑处置禁松阈值」
  （重跑绿即过，禁以环境态调预算——阈值口径冻结归 T33 负载基准卡）。
