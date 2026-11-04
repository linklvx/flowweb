// scripts/check-gate-evidence.mjs —— Y1c T34（plan :441）：release 门 gate-evidence manifest 机器判定。
// 语义（卡文逐字承载）：G1-G6a 全 manifest——skipped=0 / artifact 齐 / invariant 全过（cases 全 pass）
// / commit==HEAD（确认点②裁定「manifest==最终代码」的机器化：认证 commit 在当前历史上，且自认证
// 对象起 apps/ packages/ 生产码零漂移——git diff <commit> -- apps packages 为空＝manifest 认证的
// 就是最终代码；证据/文档批不触发）。配套证据文件在位（T30b 演练/T31 故障演练/T33 负载基准/
// flake 台账）。任一不满足＝exit 非零＝缺证据不发布。
// 不进 verify 链 PR 档（CI pnpm verify=full 每次跑会挡所有生产码迭代——开发流与发布门分离，
// 与 T33 load-bench 两档先例同构）；调用点=release 前（本地/CI release job）+T34 证据批实跑留证。
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** G 门 manifest 清单（文件名 → gate 字段期望值）。 */
export const GATE_MANIFESTS = {
  'gate-evidence/g1.json': 'G1',
  'gate-evidence/g2.json': 'G2',
  'gate-evidence/g3.json': 'G3',
  'gate-evidence/g4.json': 'G4',
  'gate-evidence/g5.json': 'G5',
  'gate-evidence/g6a.json': 'G6a',
};

/** T34 发布门配套证据文件（卡文「verify full+故障演练+负载基准+删除清单+reset 实弹+T30b 演练记录」
 *  的在盘锚——删除清单/reset 实弹由 plan T32/T30 checkbox+批注承载（文档面），证据文件面如下）。 */
export const EVIDENCE_FILES = [
  'gate-evidence/t30b-cutover-drill.txt',
  'gate-evidence/t31-fault-drill.txt',
  'gate-evidence/t33-load-benchmark.txt',
  'gate-evidence/registered-flakes.md',
];

const COMMIT_RE = /^[0-9a-f]{40}$/;

/** 纯判据函数（自测消费）。manifests={file:parsedJson}；artifactsExists=(relPath)=>bool；
 *  isAncestor=(commit)=>bool（commit 是否当前 HEAD 祖先）；prodDrift=(commit)=>string[]（自 commit
 *  起 apps/ packages/ 漂移文件清单——含工作树）。返回违反清单（空=门过）。 */
export function checkGateEvidence({ manifests, artifactsExists, isAncestor, prodDrift }) {
  const violations = [];
  for (const [file, expectedGate] of Object.entries(GATE_MANIFESTS)) {
    const m = manifests?.[file];
    if (!m) { violations.push(`${file}: 不可读/非 JSON`); continue; }
    if (m.gate !== expectedGate) violations.push(`${file}: gate="${m.gate}"（期望 "${expectedGate}"）`);
    if (m.skipped !== 0) violations.push(`${file}: skipped=${m.skipped}（必须 0）`);
    if (!Array.isArray(m.cases) || m.cases.length === 0) violations.push(`${file}: cases 空`);
    else {
      const failed = m.cases.filter((c) => c.status !== 'pass');
      if (failed.length) violations.push(`${file}: ${failed.length} case 非 pass（${failed.map((c) => c.id).slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}）`);
      for (const c of m.cases) for (const a of c.artifacts ?? []) {
        if (!artifactsExists(a)) violations.push(`${file}: case ${c.id} artifact 缺失：${a}`);
      }
    }
    if (!Array.isArray(m.invariants) || m.invariants.length === 0) violations.push(`${file}: invariants 空`);
    if (!COMMIT_RE.test(m.commit ?? '')) violations.push(`${file}: commit="${m.commit}"（须 40-hex）`);
    else {
      if (!isAncestor(m.commit)) violations.push(`${file}: commit ${m.commit} 不在当前 HEAD 历史上`);
      else {
        const drift = prodDrift(m.commit);
        if (drift.length) violations.push(`${file}: commit ${m.commit} 之后生产码漂移 ${drift.length} 文件（apps/packages——manifest 须重认证；如 ${drift.slice(0, 3).join(', ')}）`);
      }
    }
  }
  return violations;
}

function main() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  const isAncestor = (commit) => {
    try { execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }); return true; }
    catch { return false; }
  };
  const prodDrift = (commit) => git(['diff', '--name-only', commit, '--', 'apps', 'packages']).split(/\r?\n/).filter(Boolean);
  const violations = checkGateEvidence({
    manifests: Object.fromEntries(Object.keys(GATE_MANIFESTS).map((f) => [f, JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'))])),
    artifactsExists: (rel) => existsSync(path.join(ROOT, rel)),
    isAncestor,
    prodDrift,
  });
  for (const f of EVIDENCE_FILES) if (!existsSync(path.join(ROOT, f))) violations.push(`证据文件缺失：${f}`);
  if (violations.length) {
    console.error('check-gate-evidence: 发布门红（T34）——缺证据/漂移，不发布：');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  const heads = Object.entries(GATE_MANIFESTS).map(([f]) => {
    const j = JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
    return `${j.gate}@${j.commit.slice(0, 8)}(${j.cases.length}c)`;
  });
  console.log(`check-gate-evidence: PASS（release 门）——${heads.join(' ')}+证据文件 ${EVIDENCE_FILES.length} 件在位；生产码零漂移`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
