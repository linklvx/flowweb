// apps/api/src/utils/sentry-scrub.spec.ts
// Y0b-5 T11：Sentry 事件面 scrub（白名单保留 csv/cb）+release 来源（build-info.json——pm2 剥 GIT_* 修复）
// +collab capture helper（scope{docName,reason,connectionId}）。
// 偏离表登记（plan T11）：scrub 只护 Sentry 事件面不护日志面——project id 非机密裁定（仓库已公有），
// 结构化日志保持原文（docName/连接三元组不脱敏）；csv/cb 保留理由=WS 无法设自定义头 URL query 是
// 唯一通道+版本事故唯一线索+非机密。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));
import * as Sentry from '@sentry/nestjs';
import { scrubEvent, scrubQuery, resolveSentryRelease, captureCollabException } from './sentry-scrub';

describe('T11 scrub=剥 query 中除 csv/cb 外全部（token/任意参数）；csv/cb 白名单保留', () => {
  it('URL query 剥除只留 csv/cb（保序）；全非白名单→去 query；无 query/无=不动', () => {
    expect(scrubQuery('wss://h:3001/?csv=2&token=secret')).toBe('wss://h:3001/?csv=2');
    expect(scrubQuery('wss://h/?cb=abc&foo=1&csv=2')).toBe('wss://h/?cb=abc&csv=2');
    expect(scrubQuery('https://x/works?token=t&page=2')).toBe('https://x/works');
    expect(scrubQuery('project:p1')).toBe('project:p1');   // docName 形态：无 ? 无 = 不动
    expect(scrubQuery('what?')).toBe('what?');             // '?' 后无 k=v → 非查询串不动
    expect(scrubQuery('https://x/works')).toBe('https://x/works');
  });
});

describe('T11 对象递归 scrub：键名含 query/url/token 的字符串值→[scrub]（url 键含 query 例外——保 csv/cb 剥其余）', () => {
  it('四面（extra/tags/request/breadcrumbs）递归生效；docName=project:<id> 无 PII 断言不误伤', () => {
    const ev: any = {
      extra: { wsUrl: 'wss://h/?token=t&csv=2', docName: 'project:p1', nested: { token: 'secret' } },
      tags: { url: 'https://x/?a=1&cb=z', docName: 'project:p1' },
      request: { url: 'ws://127.0.0.1:3001/?csv=2&token=abc', query_string: 'csv=2&token=abc', headers: { cookie: 'flowweb.session_token=tok' } },
      breadcrumbs: [{ message: 'connect wss://h/?token=t&cb=q', data: { token: 'x' } }],
    };
    scrubEvent(ev);
    expect(ev.extra.wsUrl).toBe('wss://h/?csv=2');                 // url 键+值含 query → 白名单剥（非整值 [scrub]）
    expect(ev.extra.docName).toBe('project:p1');                   // 不误伤（project id 非机密裁定）
    expect(ev.extra.nested.token).toBe('[scrub]');                 // token 键：对象内递归整值打码
    expect(ev.tags.url).toBe('https://x/?cb=z');
    expect(ev.tags.docName).toBe('project:p1');
    expect(ev.request.url).toBe('ws://127.0.0.1:3001/?csv=2');
    expect(ev.request.query_string).toBe('[scrub]');               // query 键的字符串值→[scrub]
    expect(ev.request.headers.cookie).toBe('[scrub]');             // token 子串键（session_token）同族打码
    expect(ev.breadcrumbs[0].message).toBe('connect wss://h/?cb=q'); // 泛字符串（键无模式）剥 query 留白名单
    expect(ev.breadcrumbs[0].data.token).toBe('[scrub]');
  });

  it('非 Sentry 面字段零触碰：scrubEvent 只改 extra/tags/request/breadcrumbs 四面', () => {
    const ev: any = { extra: { a: '?token=1' }, message: '?token=1', user: { email: 'x@y.z' }, contexts: { trace: '?token=1' } };
    scrubEvent(ev);
    expect(ev.extra.a).toBe('');            // '?token=1' → 无白名单参数 → 剥空
    expect(ev.message).toBe('?token=1');    // 面外字段不动
    expect(ev.user.email).toBe('x@y.z');
    expect(ev.contexts.trace).toBe('?token=1');
  });

  it('深限+循环引用防环不抛（Sentry 事件对象可能巨大/自引用）', () => {
    let deep: any = { token: 'leaf' };
    for (let i = 0; i < 15; i++) deep = { child: deep };
    const cyc: any = { docName: 'project:p1' };
    cyc.self = cyc;
    expect(() => scrubEvent({ extra: deep })).not.toThrow();
    expect(() => scrubEvent({ extra: cyc })).not.toThrow();
  });
});

describe('T11 release 修复：改读 build-info.json（部署链既有产物；pm2 剥 GIT_* ⇒ env 路恒 unknown）', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 't11-release-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('build-info.git 优先 → package.json version → unknown（文件缺失/坏 JSON 不阻塞不抛——SENTRY_DSN 未设 no-op 同源）', () => {
    const bi = join(dir, 'build-info.json');
    const pkg = join(dir, 'package.json');
    writeFileSync(bi, JSON.stringify({ git: '59734a13', builtAt: '2026-10-11T08:38:43Z' }));   // deploy.sh:194 产物形态
    expect(resolveSentryRelease(bi, pkg)).toBe('59734a13');
    rmSync(bi);
    writeFileSync(pkg, JSON.stringify({ name: '@flowweb/api', version: '0.0.1' }));
    expect(resolveSentryRelease(bi, pkg)).toBe('0.0.1');
    rmSync(pkg);
    expect(resolveSentryRelease(bi, pkg)).toBe('unknown');
    writeFileSync(bi, '{broken json');   // 坏 JSON 同缺失回落，不抛
    expect(resolveSentryRelease(bi, pkg)).toBe('unknown');
  });
});

describe('T11 captureCollabException：collab catch 统一入口（scope{docName,reason,connectionId}）', () => {
  it('captureException(err,{tags})——三 tag 逐字透传；helper 自身不抛（事件面禁抛）', () => {
    const err = new Error('store append failed');
    expect(() => captureCollabException(err, { docName: 'project:p1', reason: 'store-append-failed', connectionId: '-' })).not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { docName: 'project:p1', reason: 'store-append-failed', connectionId: '-' },
    });
  });

  it('非 Error reason 折 Error 后上送（captureException 载荷恒 Error——裸字符串在 SDK 侧退化为 message 事件）', () => {
    captureCollabException('raw string', { docName: '-', reason: 'probe', connectionId: '-' });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.anything());
  });
});
