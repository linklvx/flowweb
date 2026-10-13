// 契约锁㉗/F9：spec 全部行号引证基于 4.6.0——版本漂移=契约锁整表重验前置。CI 必跑。
// 正则锚定 lockfile packages 段条目键形态（'@hocuspocus/provider@4.6.0':）；
// snapshots 段带 peer 后缀的键（@4.6.0(y-protocols@...)）不匹配——引号紧跟版本号收口，天然排除。
import { readFileSync } from 'node:fs';
const lock = readFileSync('pnpm-lock.yaml', 'utf8');
// 批0e 评审 #2：逐包存在性断言——任一包从 lockfile 消失时，版本断言只扫"找到的"条目会静默绿，先锁存在再锁版本。
// Y0a-3：跨实例扩展包随单实例拓扑钉死删除——EXPECTED 收敛 @hocuspocus 三包（common=批0e
// 存在性断言保留）+yjs 独立正则（非 scoped 键在 packages 段不带引号——引号正则永不匹配=门禁静默绿，
// spec §1.3 v2.1 注；行首两空格锚定 packages 段，snapshots 段四空格天然排除）。
const EXPECTED = ['provider', 'server', 'common', 'yjs'];
const reHocuspocus = /'@hocuspocus\/(provider|server|common)@([\d.]+)'/g;
const reYjs = /^  yjs@([\d.]+):/gm;
const found = new Set();
const names = new Set();
let m;
while ((m = reHocuspocus.exec(lock))) {
  found.add(`${m[1]}@${m[2]}`);
  names.add(m[1]);
}
while ((m = reYjs.exec(lock))) {
  found.add(`yjs@${m[1]}`);
  names.add('yjs');
}
if (found.size === 0) {
  console.error('未在 lockfile 找到 @hocuspocus/yjs 条目（正则失配？）');
  process.exit(1);
}
const missing = EXPECTED.filter((p) => !names.has(p));
if (missing.length) {
  console.error('契约锁：条目缺失（provider/server/common/yjs 必须都在 lockfile）:', missing);
  process.exit(1);
}
const bad = [...found].filter((s) => !s.startsWith('yjs@') && !s.endsWith('@4.6.0'));
if (bad.length) {
  console.error('契约锁：@hocuspocus 版本漂移（必须 pin 4.6.0 且跑契约锁全量用例）:', bad);
  printRerunChecklist(console.error);
  process.exit(1);
}
const badYjs = [...found].filter((s) => s.startsWith('yjs@') && !s.endsWith('@13.6.32'));
if (badYjs.length) {
  console.error('契约锁：yjs 版本漂移（必须 pin 13.6.32 且跑契约锁全量用例）:', badYjs);
  printRerunChecklist(console.error);
  process.exit(1);
}
console.log('pinned ✓', [...found]);
console.log('版本目标（Z123）：4.6.0 不升级——本批全部行为结论源码实证绑定 4.6.0 实现细节；任何漂移（含 ≥4.7.1）必须重跑下方锚清单+契约锁全量用例。');
printRerunChecklist(console.log);

// Z18/Z123（Y0c T5）：版本变化时必须重跑的锚清单——版本漂移=清单内全部行为结论失效。
// 行号引证=4.6.0 安装态 hocuspocus-server.esm.js 立项快照（Z95：行号非执行锚，重跑时按语义定位）。
function printRerunChecklist(out) {
  const list = [
    '版本漂移必重跑锚清单（apps/api/src/modules/collab/collab.library-anchors.spec.ts 全文件）：',
    '  A5 store 失败不自动重试 / A6 失败也卸载 / A7 pendingStructs 边界 / A8 store 跳过判据 / A9 最后连接关闭销毁 / A14 store 钩子在 saveMutex 内',
    '  Z80 正例① 持有 direct ⇒ 谓词恒 false ⇒ 4 入口 no-op（esm:1171/:1386/:1543/:1551）',
    '  Z80 正例② 谓词=唯一卸载决策者——unloadDocument 双校验 :1576/:1589+卸载调用点 census（源码级结构锚）',
    '  Z80 反例① disconnect({unloadImmediately:true}) 释放确实能卸载',
    '  Z80 反例② saveMutex 锁定 ⇒ 谓词 false（Z94②）',
  ];
  for (const line of list) out(line);
}

