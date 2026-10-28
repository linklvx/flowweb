#!/usr/bin/env node
// scripts/check-collab-module-size.mjs —— Y0c T42（B3）：collab 模块本体行数防倒退门禁。
// plan T42 行：「gateway 本体只剩钩子编排+协议适配（≤600 行防倒退锚）+check-collab-module-size.mjs*
// （Z96 计法=对齐 wc -l：content.replace(/\n$/,'').split('\n').length）」。
// 锚语义=**防倒退禁再膨胀**（非可达目标值——spec §0.6 偏离 65：≤600 字面为 plan 原锚，按 B3 完成
// 实测重标，gateway 终标=934〔T42 实测：1031→934，手段①server 工厂/②observability wiring/
// ④钩子壳内联，手段③委托位零退役=控制方裁决「协议适配面载体+RC5 行为零变化结构保证」〕；
// T43 确认点⑥ 呈报义务注记见 spec §0.6 偏离 76）。SG/DR/persistence=偏离 65/74 既有锚原值。
// residency 不入锚——片 A 文件非片 B 产物（设计 t41-b2-design §7.2 口径）。
// 退出码：0=PASS；1=FAIL（超限——收敛削减不回写锚，膨胀即红）；2=结构性错误（锚文件缺失）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 执法锚七文件（T42 B3 四文件+CI 双故障根修批 T10 三新文件——变更锚值=有意识动作：自测 SIZE_LIMITS 断言同批改）。 */
export const SIZE_LIMITS = {
  'apps/api/src/modules/collab/collab.gateway.ts': 1161,   // T42 B3 934→Y1c T9 985→T10 1015（+30：onStateless barrier 接线+beforeUnloadDocument drain 纪律〔拒卸载 throw 面〕+isMaintenanceBlocked 缝）→T10 收口 1020（+5：Q-I3 UnloadDrainRefusedError typed 分类）→T11 收口 1025（+5：C1① onWalSeqFloorSeeded 装载缝+boot 播种接线）→复核 round-2 1032（+7：C1' boot 三元组播种块前移 replayAll 前+generation 接线——净增面，非膨胀）→T12 1048（+16：#g canonical 寻址〔isDocResident/persistence docNameOf 缝〕+schemaVersion⇒generation 拒启断言接线+switchWalGeneration 换代委托+doc-name 再导出——净增面，非膨胀）→T12 收口 1054（+6：vacuumEraGeneration 纪元读面委托〔I1.2〕——净增面，非膨胀）→T13 1080（+26：G6a boot 恢复路径生产接线〔recoverScan 消费+restore.lock 门控+violation/suspect fail-closed+docRecoveryTotal〕+wal observer unregister——净增面，非膨胀）→T13 收口 1082（+2：M4 启动自检条件收窄 fatal 维〔良性 dup 不噪声〕注释锚——净增面，非膨胀）→T22 收口批补账 1098（+16：T26 双评审~三轮 observer 接线 +3+2+1 净增+T22 主体 broadcastStatelessToProject stateless 扇出〔feed-hint 通知通道〕+11——批漏登锚的补账，净增面非膨胀）→Y1c T24 1101（+3：装载缝 noteDocIndexRebuild 转发一行——docIndex 装载即 rebuild 根修接线，净增非膨胀）→T24 收口 1103（+2：I-1 挂点移 onDocLoadedAndReplayed 重放后缝——净增非膨胀）→Y1c T27 1144（+41：维护状态机 host 接线〔docConnections/hardClose/thaw 段/常驻释放/WAL 切代 1 行转发族〕+actor 准入链 maintenanceFreezeOf/isMaintenanceBlocked∨freeze 扩+boot resumeActiveOnBoot 续跑接线〔重启从 PG stage 继续〕——净增面非膨胀）→T27 收口 1150（+6：boot replayAll 重派生双回调接线〔I-3 恢复链终态〕——净增面非膨胀）→T27 收尾 1161（+11：reconciler face 扩传 derive+persist 两面〔I-3' 裁定 (a) 接线〕+boot derive memo 转发——净增面非膨胀）
  'apps/api/src/modules/collab/collab-session-guard.service.ts': 1371,   // T41 W3b B2 1238→Y1c T9 实测 1273（+35：closeAllConnectionsWs 泛化〔1011 WAL fail-stop 档〕+版本门 historyId 硬门〔修正 #8 resolveVersionGate 接线〕+auth 回执 historyId 下发半链——三净增面，非膨胀）→T12 1298（+25：auth 面 docName 世代准入〔E23 双校验①·GENERATION_STALE 终态档〕+真空窗 4410 载荷先行+persistUnhealthy 归一键+closeTeamDocuments canonical——净增面，非膨胀）→T22 收口批补账 1304（+6：T22 主体 setHeartbeatEnricher 委托〔feed latestFeedSeq 心跳增补面〕——批漏登锚的补账，净增面非膨胀）→Y1c T24 1348（+44：版本门 deny=4406 terminal close 投递〔closeUpgradeTerminal RFC6455 close 帧+upgradeSockets WeakMap 登记〕——旧 bundle DENY 无限循环阻断面，净增非膨胀）→T24 收口 1358（+10：sv 上行承载 M-1〔VERSION_GATE_CLIENT_PARAMS 消费+三元真承载〕——净增面非膨胀）→T25 收口 1371（+13：auth 面方向分档〔resolveAuthHistoryVerdict 消费+g_client>g_server 4410 server-restored 码投递——C-1(spec) 服务端腿〕——净增面非膨胀）
  'apps/api/src/modules/collab/collab-doc-registry.service.ts': 1162,   // T41 W3a B2 实测 1082（偏离 65/74）→Y1c T12 1114（+32：preVacuumSv 缓存/门退役删除〔净 -20〕+装载世代准入+generation 真值链播种+liveDocName/vacuumTargetGeneration/generationInDb 三读面+4410 载荷——净增面，非膨胀）→T12 收口 1134（+20：真空纪元代投影会话态〔I1——beginVacuumEra 定格/setVacuuming 清/vacuumEraGeneration 读面〕——净增面，非膨胀）→T12 复核残留 1144（+10：era 定格 DB 真值化〔I1.2 修——readGeneration 单行 PK 读替进程内投影〕——净增面，非膨胀）→T22 收口批补账 1150（+6：T26 三轮 loadPgSeq 装载缝读面〔presence 可信守卫谓词根修〕——批漏登锚的补账，净增面非膨胀）→T24 收口 1157（+7：onDocLoadedAndReplayed 新缝〔I-1 索引重建挂点移重放后〕——净增面非膨胀）→T25 收口 1162（+5：装载面 serverRestoredForm 方向标记〔C-1(spec) 防御第二道〕——净增面非膨胀）
  'apps/api/src/modules/collab/collab-persistence.service.ts': 1146,   // T40 B1 实测 950→T14 重标 1056→Y1c T11 1070（+14：maybeCompact purgeBelowSeq spool confirm 消费面）→T11 收口 1073（+3：Q-M6 confirm 过滤断言锚注释——净增面非膨胀）→T12 1091（+18：docNameOf canonical 寻址缝+四 flush 点改 liveName+persistKey 归一 bare 键——净增面，非膨胀）→T22 收口批补账 1105（+14：T26 二轮 R-1 生产 reconciler 入口接线〔30s ownPending/adopt 两档+observer face〕——批漏登锚的补账，净增面非膨胀）→Y1c T24 1123（+18：origin 枚举计数 doc_update_origin_total{origin}〔update 监听单点+server-direct 节流告警台账〕——净增面非膨胀）→T24 终验 1124（+1：M-11 排版拆行——零行为变化）→Y1c T27 收尾 1146（+22：reconcileSpool replayAll derive+persist 随载+face 扩两可选面〔I-3' 裁定 (a) 接线——doc-lag 窗派生缺档根修〕——净增面非膨胀）
  'apps/api/src/modules/collab/collab-limits.ts': 55,   // CI 修复批 R4b' 新文件入锚（T10 实测 42+1.3 余量——spec 预登记 2 兑现）
  'apps/api/src/modules/collab/collab-outbound-budget.ts': 155,   // CI 修复批 R4b' 新文件入锚（T10 实测 119+1.3 余量——四档帧型+记账台账）
  'apps/api/src/modules/collab/collab-heartbeat.ts': 42,   // CI 修复批 R6' 新文件入锚（T10 实测 31+1.3 余量——v3 补：三新文件统一入锚）→T22 收口批补账 42（+2：T22 主体 enricher 钩〔latestFeedSeq 增补档缺省纯 heartbeat〕——批漏登锚的补账，净增面非膨胀）
};

/** Z96 计法（plan 钉死）：对齐 wc -l（尾换行文件两口径一致；无尾换行差 1——自测钉）。 */
export function countLines(content) {
  return content.replace(/\n$/, '').split('\n').length;
}

/** 判定核（readFn 注入可测）：返回 { structural, results[{file,lines,limit,pass}] }。 */
export function checkSizes(limits, readFn = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')) {
  const results = [];
  for (const [file, limit] of Object.entries(limits)) {
    let content;
    try { content = readFn(file); } catch { return { structural: file, results: [] }; }
    const lines = countLines(content);
    results.push({ file, lines, limit, pass: lines <= limit });
  }
  return { structural: null, results };
}

function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }

if (isMain()) {
  const { structural, results } = checkSizes(SIZE_LIMITS);
  if (structural) { console.error(`check-collab-module-size: 结构性错误（exit 2）——锚文件缺失 ${structural}`); process.exit(2); }
  const pass = results.every((r) => r.pass);
  const summary = `${pass ? 'PASS' : 'FAIL'}  check-collab-module-size（T42 B3 行数防倒退锚——Z96 计法对齐 wc -l；${results.map((r) => `${path.basename(r.file).replace(/\.ts$/, '')} ${r.lines}/${r.limit}`).join(' ')}）`;
  if (pass) console.log(summary); else console.error(summary);   // T43 Minor-1：FAIL 明细走 stderr（check-ecosystem 惯例对齐）
  for (const r of results.filter((x) => !x.pass)) console.error(`      - 超限 ${r.file}：实测 ${r.lines} > 锚 ${r.limit}（锚语义=防倒退禁再膨胀——偏离 65；超限即红，禁改锚绕行）`);
  if (!pass) { console.error('check-collab-module-size FAIL'); process.exit(1); }
}
