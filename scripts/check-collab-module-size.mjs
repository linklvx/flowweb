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
  'apps/api/src/modules/collab/collab.gateway.ts': 1048,   // T42 B3 934→Y1c T9 985→T10 1015（+30：onStateless barrier 接线+beforeUnloadDocument drain 纪律〔拒卸载 throw 面〕+isMaintenanceBlocked 缝）→T10 收口 1020（+5：Q-I3 UnloadDrainRefusedError typed 分类）→T11 收口 1025（+5：C1① onWalSeqFloorSeeded 装载缝+boot 播种接线）→复核 round-2 1032（+7：C1' boot 三元组播种块前移 replayAll 前+generation 接线——净增面，非膨胀）→T12 1048（+16：#g canonical 寻址〔isDocResident/persistence docNameOf 缝〕+schemaVersion⇒generation 拒启断言接线+switchWalGeneration 换代委托+doc-name 再导出——净增面，非膨胀）
  'apps/api/src/modules/collab/collab-session-guard.service.ts': 1298,   // T41 W3b B2 1238→Y1c T9 实测 1273（+35：closeAllConnectionsWs 泛化〔1011 WAL fail-stop 档〕+版本门 historyId 硬门〔修正 #8 resolveVersionGate 接线〕+auth 回执 historyId 下发半链——三净增面，非膨胀）→T12 1298（+25：auth 面 docName 世代准入〔E23 双校验①·GENERATION_STALE 终态档〕+真空窗 4410 载荷先行+persistUnhealthy 归一键+closeTeamDocuments canonical——净增面，非膨胀）
  'apps/api/src/modules/collab/collab-doc-registry.service.ts': 1114,   // T41 W3a B2 实测 1082（偏离 65/74）→Y1c T12 1114（+32：preVacuumSv 缓存/门退役删除〔净 -20〕+装载世代准入+generation 真值链播种+liveDocName/vacuumTargetGeneration/generationInDb 三读面+4410 载荷——净增面，非膨胀）
  'apps/api/src/modules/collab/collab-persistence.service.ts': 1091,   // T40 B1 实测 950→T14 重标 1056→Y1c T11 1070（+14：maybeCompact purgeBelowSeq spool confirm 消费面）→T11 收口 1073（+3：Q-M6 confirm 过滤断言锚注释——净增面非膨胀）→T12 1091（+18：docNameOf canonical 寻址缝+四 flush 点改 liveName+persistKey 归一 bare 键——净增面，非膨胀）
  'apps/api/src/modules/collab/collab-limits.ts': 55,   // CI 修复批 R4b' 新文件入锚（T10 实测 42+1.3 余量——spec 预登记 2 兑现）
  'apps/api/src/modules/collab/collab-outbound-budget.ts': 155,   // CI 修复批 R4b' 新文件入锚（T10 实测 119+1.3 余量——四档帧型+记账台账）
  'apps/api/src/modules/collab/collab-heartbeat.ts': 40,   // CI 修复批 R6' 新文件入锚（T10 实测 31+1.3 余量——v3 补：三新文件统一入锚）
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
