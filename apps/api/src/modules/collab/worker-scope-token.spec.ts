// apps/api/src/modules/collab/worker-scope-token.spec.ts
// T13（plan v11.2 ①）：worker 作用域令牌——HMAC 绑定 projectId+intentRowId+execSeq+exp。
// 红：伪造他 project/intent/execSeq 的写请求被拒的凭据面单源（端点侧 verify+绑定校验=collab-write
// .controller；本文件钉纯函数语义：往返/篡改/过期/异密钥/裸档形态约束）。
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  mintWorkerScopeToken, verifyWorkerScopeToken, deriveWorkerScopeSecret,
  WORKER_SCOPE_TTL_MS, type WorkerScopePayload,
} from './worker-scope-token';

const TOKEN = 'tok-t13-scope';

describe('T13 worker-scope-token（HMAC 作用域凭据）', () => {
  it('全档往返：mint→verify ok，payload 逐字段还原（execSeq wire=string）', () => {
    const t = mintWorkerScopeToken(TOKEN, 'p1', { intentRowId: 'gi-1', execSeq: 42n });
    const v = verifyWorkerScopeToken(TOKEN, t);
    expect(v).toEqual({ ok: true, payload: { p: 'p1', i: 'gi-1', s: '42', x: expect.any(Number) } as WorkerScopePayload });
    if (v.ok) expect(v.payload.x).toBeGreaterThan(Date.now() + WORKER_SCOPE_TTL_MS - 5_000);   // exp=now+TTL
  });

  it('裸项目档（pre-claim 断言路径）：intentRowId/execSeq 缺省 → i/s 空串，verify ok', () => {
    const t = mintWorkerScopeToken(TOKEN, 'p1');
    const v = verifyWorkerScopeToken(TOKEN, t);
    expect(v.ok).toBe(true);
    if (v.ok) { expect(v.payload.i).toBe(''); expect(v.payload.s).toBe(''); }
  });

  it('异静态 token（伪造者无 HMAC 密钥）→ bad-signature；密钥派生域分隔（不同前缀不同密钥）', () => {
    const t = mintWorkerScopeToken(TOKEN, 'p1', { intentRowId: 'gi-1', execSeq: '7' });
    expect(verifyWorkerScopeToken('other-token', t)).toEqual({ ok: false, reason: 'bad-signature' });
    expect(deriveWorkerScopeSecret('x')).not.toEqual(deriveWorkerScopeSecret('y'));
  });

  it('载荷篡改（换 projectId/intentRowId/execSeq——base64 可解码可重编码）→ bad-signature', () => {
    const t = mintWorkerScopeToken(TOKEN, 'p1', { intentRowId: 'gi-1', execSeq: '7' });
    const [v, body, sig] = t.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as WorkerScopePayload;
    for (const forge of [{ ...payload, p: 'p-other' }, { ...payload, i: 'gi-other' }, { ...payload, s: '999' }]) {
      const forgedBody = Buffer.from(JSON.stringify(forge), 'utf8').toString('base64url');
      expect(verifyWorkerScopeToken(TOKEN, `${v}.${forgedBody}.${sig}`)).toEqual({ ok: false, reason: 'bad-signature' });
    }
  });

  it('过期（exp<now）→ expired（exp=claim lease 量级短命凭据）', () => {
    const t = mintWorkerScopeToken(TOKEN, 'p1', { intentRowId: 'gi-1', execSeq: '7' }, () => Date.now(), 1_000);
    expect(verifyWorkerScopeToken(TOKEN, t, () => Date.now() + 2_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('缺头/形态违规 → missing/malformed（裸档禁携 execSeq；全档 execSeq 必数字串）', () => {
    expect(verifyWorkerScopeToken(TOKEN, undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWorkerScopeToken(TOKEN, 'garbage')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyWorkerScopeToken(TOKEN, 'v2.a.b')).toEqual({ ok: false, reason: 'malformed' });
    // 自构载荷形态违规（签名自洽但 i/s 组合非法）：裸档携 execSeq / 全档非数字 execSeq
    const mintRaw = (payload: WorkerScopePayload) => {
      const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const sig = createHmac('sha256', deriveWorkerScopeSecret(TOKEN)).update(body).digest().toString('base64url');
      return `v1.${body}.${sig}`;
    };
    const now = Date.now() + 60_000;
    expect(verifyWorkerScopeToken(TOKEN, mintRaw({ p: 'p1', i: '', s: '7', x: now }))).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyWorkerScopeToken(TOKEN, mintRaw({ p: 'p1', i: 'gi-1', s: 'x9', x: now }))).toEqual({ ok: false, reason: 'malformed' });
  });
});
