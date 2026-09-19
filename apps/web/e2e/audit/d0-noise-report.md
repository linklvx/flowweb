# D0-0 自比自跑噪声报告（Task 4）

- 采集条件：同 HEAD `0a7d4bd9`、同 D1 属性集（两侧 meta.attrSetVersion=D1）、d-noise-a 2026-09-20 采集 + d-noise-b 同日重采（Step 2b 还原后为第三次采集的干净副本）
- unexpectedTotal: 0（gate：属性 0 + 几何 0 = 0；涌现登记闸 offender=0/漂移=0（authorized=60）；配对闸 offender=0；exit=0）
- 归一化/白名单处置: 无（transparent/rgba(0,0,0,0) 变体噪声未出现；differ 分类器零改动，无独立 commit）
- 逐页元素计数: d-noise-a vs d-noise-b 逐页全等——login 40/40、register 18/18、works 148/148、videos 128/128、canvas 123/123、material-modal 215/215、video-editor 252/252、admin-models 281/281
- 配对闸两级吸收冒烟（Step 2b）: unregistered=1 → registered-page=0 且 dAbsorbed 含 [page]（第七轮 P1-1 接线验证）

## 补充事实

1. **配对闸唯一非零位**：video-editor 配对 249/252——removed=added=3（同位同量），键均为 `tid:` 运行时 ID 白名单命中（`rf__node-node-<时间戳>`、`video-edit-node-node-<时间戳>`、`track-row-track-<uuid>`，测试自建节点/轨道的跨运行必然键变），零 offender，属既有已消化机制，非本任务新增噪声。
2. **冒烟证据**（e2e/audit/baseline-diff-dnoise-smoke.* 已删，结论留档）：手改 d-noise-b works.json `dom:`（body）backgroundColor → `rgb(1, 2, 3)` 后，未登记 diff exit=1（属性意外 1：`works|dom:|backgroundColor rgb(20, 20, 20)→rgb(1, 2, 3)`）；stub registry 登记 `{page:'works',prop:'backgroundColor',before:'rgb(20, 20, 20)',after:'rgb(1, 2, 3)'}` 复跑 exit=0，`dExpectedGate.absorbedByPair = {"backgroundColor rgb(20, 20, 20)→rgb(1, 2, 3) [page]": 1}` —— `[page]` 标记证明 absorbedBy() 的 page 限定分支真被走过（非 global 兜底）。还原后复跑干净 diff：pairsRegistered=1 但 absorbedTotal=0（冒烟 pair 的 after 值不再出现，无误吸收）。
3. **stub registry**：`e2e/audit/canvas-migration-registry.json` 含冒烟 pair（Task 4 Step 0 落的最小 stub + Step 2b ③ 登记项），按 plan 留待 Task 5 Step 2 脚本产出整体覆盖。
4. **Step 3 未触发**：全元素继承色（color/backgroundColor）噪声预算为 0，无 OVERRIDES/归一化条目，勿带噪声进 D1a 的目标达成。
