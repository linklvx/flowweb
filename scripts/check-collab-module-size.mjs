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
  'apps/api/src/modules/collab/collab.gateway.ts': 1015,   // T42 B3 934→Y1c T9 985→T10 实测 1015（+30：onStateless barrier 接线+beforeUnloadDocument drain 纪律〔拒卸载 throw 面〕+isMaintenanceBlocked 缝——G2 净增面，非膨胀）
  'apps/api/src/modules/collab/collab-session-guard.service.ts': 1273,   // T41 W3b B2 1238→Y1c T9 实测 1273（+35：closeAllConnectionsWs 泛化〔1011 WAL fail-stop 档〕+版本门 historyId 硬门〔修正 #8 resolveVersionGate 接线〕+auth 回执 historyId 下发半链——三净增面，非膨胀）
  'apps/api/src/modules/collab/collab-doc-registry.service.ts': 1082,   // T41 W3a B2 实测（偏离 65/74）
  'apps/api/src/modules/collab/collab-persistence.service.ts': 1056,   // T40 B1 实测 950→T14 flushDocument 窄接口（交付判定载体——v10.1 T6c 维持）叠加实测重标（锚值=绿相终值，红绿同批）
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
