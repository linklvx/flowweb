<!-- doc-status: frozen | note: 删除登记表（索引性载体——不进权威链，死因列即其职能） | verified_at: n/a -->
# 已删除文档索引（DELETED）

> 可发现性载体（spec §5.5）：git 为归档、"在 git 里"只在知道文件名时成立。批 2 起逐行登记。
> 代码侧删除不进本表（登记在 `docs/_meta/dead-symbols.json` 的 removedIn）。

> 文件列记法：目录 · 文件名（去 .md 后缀，防路径形态触发引用存在性检查——本表路径条目即数据本体）。补全文件名查 git 历史。

| 文件 | 删除 commit | 死因 | 决策承载于 |
|---|---|---|---|
| specs 与 plans · canvas-refresh-data-loss-fix | 批 2 commit | 四 Fix 全绑死 localStorage 双 key 恢复链（机制已亡） | tech-debt · TD-5/6 已清账行 |
| specs 与 plans · td2-allimages-unify-td1-projectid-fix | 批 2 commit | deleteRefs 已被 TD-15 删（修复对象不存在） | tech-debt · TD-2/TD-1 清账行 |
| specs 与 plans · td4-hydrate-window-seal | 批 2 commit | isHydrating 机制已亡（hydration 四态取代） | tech-debt · TD-4 清账行 |
| specs 与 plans · td5-6-8-persistence-refactor | 批 2 commit | flowweb_canvas_v2 本体已死（服务端 doc 持久化取代） | tech-debt · TD-5/6 清账行 |
| specs 与 plans · 2026-08-23-group-bugs-fix | 批 2 commit | Fix 全是 REST+localStorage 机制，照做会复活已删代码 | 组升级 Spec A/B + 2026-08-24 spec :10 前轮注 |
| plans · smoke-dual-client | 批 2 commit | 已被 gate-checklist 归并节显式归并（e2e 判据源注随批 2 改指） | collab-e2e-gate-checklist + master plan 批注 |
| specs · account_balance | 批 2 commit | UserBalance 方案从未落地；积分池冲突动机已被 TeamBalance 双池吸收（schema.prisma:712-713 credits+subscriptionCredits；reserve/settle/void_ 三方法现行=team-credit.service.ts:58/164/202，双池 11 处引用） | TeamBalance 双字段现行实现 |
| specs · 2026-05-16-template-marketplace-design | 批 4 commit | 市场机制被 M0 整删（市场页/两卡/保存对话框/templateApi 拆除——commit f0bdbdd2）；8 处死符号命中（saveCanvas/templateData 等） | M0 commit f0bdbdd2 + tech-debt 台账 |
| docs 根 · AI多模态内容创作SaaS平台产品设计文档（txt 与 docx 两份） | 批 2 commit | 6 个死/未实现机制+零引用孤岛；txt/docx 归一化后**逐节完全一致**（4290 字符，无裁决分歧）。内部矛盾：:11 技术栈 Better Auth vs :102 Keycloak 用户隔离；:102"仅创建者可查看编辑修改自己的数据"=个人隔离模型，与团队协作模型（teamId 非空+两层角色）方向相反。未建设项：APISIX/Prometheus/Grafana/Loki/Jaeger/ECharts | 定位句+现行技术栈萃取入 README ⑥ ARCHITECTURE 节 |

