// scripts/collab-rebuild-gen.test.mjs
// Y1c T27（红②）：CLI 无租约直写拒——租约判定纯函数（decideLeaseVerdict）单测。
// DB 触碰面（真租约行+子进程级真跑）归 apps/api int 池 collab-t27-kill9.process.spec.ts。
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideLeaseVerdict } from './collab-rebuild-gen.mjs';

const NOW = 1_700_000_000_000;

test('红② 租约判定：持有者在且未过期=拒（无租约直写被拒——exit 1 面）', () => {
  const v = decideLeaseVerdict({ owner: 'api-proc-1', expiresAtMs: NOW + 60_000 }, NOW);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'held');
  assert.equal(v.holder, 'api-proc-1');
});

test('租约空窗三形态=放行：行缺失/无持有者/持有已过期', () => {
  assert.deepEqual(decideLeaseVerdict(null, NOW), { ok: true, reason: 'no-lease-row' });
  assert.deepEqual(decideLeaseVerdict({ owner: null, expiresAtMs: null }, NOW), { ok: true, reason: 'no-holder' });
  assert.deepEqual(decideLeaseVerdict({ owner: '', expiresAtMs: NOW + 60_000 }, NOW), { ok: true, reason: 'no-holder' });
  const expired = decideLeaseVerdict({ owner: 'old-proc', expiresAtMs: NOW - 1 }, NOW);
  assert.equal(expired.ok, true);
  assert.equal(expired.reason, 'expired');
  assert.equal(expired.holder, 'old-proc');   // 过期持有者透传（审计面）
});

test('expiresAtMs null+owner 在=保守拒（TTL 未知不推断——fail-closed 方向）', () => {
  const v = decideLeaseVerdict({ owner: 'api-proc-2', expiresAtMs: null }, NOW);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'held');
});
