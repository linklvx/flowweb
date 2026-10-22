# soak-t19.json 留档说明（T19 评审收口）

- 本 JSON 为 T19 真 10min 档（1 doc×10 客户端×10k 节点×300ms 率）的**一次性产物快照**。
- **重跑覆盖**：`node apps/api/scripts/collab-soak.mjs --docs 1 --clients 10 --rate 300 --duration 10 --seed-nodes 10000 --json apps/api/soak-t19.json`（仓根跑）会直接覆盖本文件——**原档以 git 历史为准**（`git log -- apps/api/soak-t19.json` 逐版可溯）。
- 数字消费面：T19 交付报告六指标对照表（frameP95≤30ms/doc<8MB/单帧<128KB/delivery lag p95≤60s/outbox+materialize lag/applied_unpersisted=0）。
