// scripts/check-gate-evidence.test.mjs —— T34 release 门装置元测试（node:test；verify 链
// scripts-node-test 步消费——防漂移面：清单/判据/负控）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGateEvidence, GATE_MANIFESTS, EVIDENCE_FILES } from './check-gate-evidence.mjs';

const A40 = 'a'.repeat(40);
const B40 = 'b'.repeat(40);

/** 最小绿 manifest 工厂（可覆盖字段）。 */
const green = (over = {}) => ({ gate: 'G1', commit: A40, skipped: 0, cases: [{ id: 'C1', status: 'pass', artifacts: [] }], invariants: [{ id: 'I1' }], ...over });

/** 六门全绿入参工厂（单门覆盖用）。gate 名自文件名提取（g1.json→G1、g6a.json→G6a）。 */
const gateOf = (f) => 'G' + f.match(/g([\w-]+)\.json$/)[1];
const args = (mutateOne) => ({
  manifests: Object.fromEntries(Object.keys(GATE_MANIFESTS).map((f, i) => [f, mutateOne ? mutateOne(f, i) : green({ gate: gateOf(f) })])),
  artifactsExists: () => true,
  isAncestor: () => true,
  prodDrift: () => [],
});

test('绿形态全过（六门 pass+skipped 0+commit 祖先+零漂移+artifact 齐）', () => {
  assert.deepEqual(checkGateEvidence(args()), []);
});

test('skipped 非 0 即红（缺证据=不发布）', () => {
  const v = checkGateEvidence(args((f) => (f.endsWith('g2.json') ? green({ gate: 'G2', skipped: 1 }) : green({ gate: gateOf(f) }))));
  assert.equal(v.length, 1);
  assert.match(v[0], /skipped=1（必须 0）/);
});

test('case 非 pass 即红（invariant 全过口径=零 fail case）', () => {
  const v = checkGateEvidence(args((f) => (f.endsWith('g3.json') ? green({ gate: 'G3', cases: [{ id: 'C1', status: 'pass' }, { id: 'C2', status: 'fail' }, { id: 'C3', status: 'skipped' }] }) : green({ gate: gateOf(f) }))));
  assert.equal(v.length, 1);
  assert.match(v[0], /2 case 非 pass（C2, C3）/);
});

test('artifact 缺失即红', () => {
  const manifests = Object.fromEntries(Object.keys(GATE_MANIFESTS).map((f) => [f, green({ gate: gateOf(f), cases: [{ id: 'C1', status: 'pass', artifacts: ['gate-evidence/missing.txt'] }] })]));
  const v = checkGateEvidence({ ...args(), manifests, artifactsExists: () => false });
  assert.equal(v.length, 6);
  assert.match(v[0], /artifact 缺失：gate-evidence\/missing\.txt/);
});

test('invariants 空即红', () => {
  const v = checkGateEvidence(args((f) => (f.endsWith('g4.json') ? green({ gate: 'G4', invariants: [] }) : green({ gate: gateOf(f) }))));
  assert.equal(v.length, 1);
  assert.match(v[0], /invariants 空/);
});

test('commit 非 40-hex / 非祖先 / 生产码漂移 三档红（manifest==最终代码裁定机器化）', () => {
  const mk = (over) => args((f) => (f.endsWith('g5.json') ? green({ gate: 'G5', ...over }) : green({ gate: gateOf(f) })));
  assert.match(checkGateEvidence(mk({ commit: 'fc6a4d68' }))[0], /须 40-hex/);
  const notAncestor = mk({ commit: B40 });
  assert.match(checkGateEvidence({ ...notAncestor, isAncestor: () => false })[0], /不在当前 HEAD 历史上/);
  const drift = mk({});
  assert.match(checkGateEvidence({ ...drift, prodDrift: () => ['apps/api/src/x.ts', 'packages/shared/src/y.ts'] })[0], /生产码漂移 2 文件/);
});

test('清单冻结：六门+四证据文件（卡文 G1-G6a 与 T30b/T31/T33/flake 台账逐字）', () => {
  assert.deepEqual(Object.keys(GATE_MANIFESTS), ['gate-evidence/g1.json', 'gate-evidence/g2.json', 'gate-evidence/g3.json', 'gate-evidence/g4.json', 'gate-evidence/g5.json', 'gate-evidence/g6a.json']);
  assert.deepEqual(EVIDENCE_FILES, ['gate-evidence/t30b-cutover-drill.txt', 'gate-evidence/t31-fault-drill.txt', 'gate-evidence/t33-load-benchmark.txt', 'gate-evidence/registered-flakes.md']);
});
