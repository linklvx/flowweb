// apps/api/src/modules/collab/telemetry.controller.spec.ts
// Y0b-5 T1 红测：POST /api/collab/telemetry（sendBeacon 面**一律 204**——sendBeacon 不可观测
// 响应，4xx/413=客户端盲重试风暴面；spec §5.6 冻结契约 11 白名单 ≤12+detail 受控键域）。
// 红相锚：①TelemetryController/TelemetryService/指标八族未定义 ②@Throttle 独立桶缺失
// ③getTracker 非 cookie 哈希 ④APP_GUARD 注册序无锁（cookie 键源失效模式已发生过两次）。
// 装置三段：
//  A 静态守卫——源码文本断言（video-work.controller.spec:71 / collab-not-serving.filter.http-order.spec 先例）；
//  B getTracker 单元——ThrottlerGuard 默认实现 req.ip 无 this 依赖，直接构造实例可调；
//  C 真实 HTTP 集成——Express ephemeral port + fetch（http-order spec 形态；APP_GUARD 镜像
//    app.module 注册序 TelemetryThrottlerGuard→AuthGuard；SessionService stub 零 DB 依赖——
//    无 cookie 401 路径 touch 恒不被调）。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { register } from 'prom-client';
import { AuthGuard } from '../../auth/auth.guard';
import { SessionService } from '../../auth/session.service';
import { TelemetryController, TelemetryThrottlerGuard } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

const CTRL_SRC = readFileSync(resolve(__dirname, './telemetry.controller.ts'), 'utf8');
const APP_SRC = readFileSync(resolve(__dirname, '../../app.module.ts'), 'utf8');

/** prom-client 计数现值（collab-backpressure.spec 同款） */
async function counterOf(name: string, labels: Record<string, string> = {}): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T1 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => Object.entries(labels).every(([k, v]) => s.labels[k] === v))?.value ?? 0;
}
async function metricDelta(name: string, labels: Record<string, string>, fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await counterOf(name, labels);
  await fn();
  return (await counterOf(name, labels)) - before;
}
/** 直方图观测次数/总和（_count/_sum 采样） */
async function observeOf(name: string, field: 'count' | 'sum'): Promise<number> {
  const metric: any = register.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} 未定义（T1 未实现——红相）`);
  return (await metric.get()).values.find((s: any) => s.metricName === `${name}_${field}`)?.value ?? 0;
}
async function observeDelta(name: string, field: 'count' | 'sum', fn: () => Promise<unknown> | unknown): Promise<number> {
  const before = await observeOf(name, field);
  await fn();
  return (await observeOf(name, field)) - before;
}

// ---------- A 静态守卫（装饰器与全局注册序——源码文本断言） ----------

describe('Y0b-5 T1 telemetry 端点（静态守卫）', () => {
  it('@Throttle 独立桶 120/min（覆盖全局 300/min——sendBeacon 面专用容量）', () => {
    expect(CTRL_SRC).toContain('@Throttle({ default: { limit: 120, ttl: 60_000 } })');
  });

  it('限流守卫必须先于 AuthGuard 注册（边缘限流不依赖 req.user 的安全不变量——cookie 键源失效模式已发生过两次，5 行锁死）', () => {
    // 照抄 http-order spec 形态：严格断言完整 APP_GUARD 注册列表（新增 guard 必须显式更新本守卫）
    const guards = [...APP_SRC.matchAll(/provide: APP_GUARD, useClass: (\w+)/g)].map((m) => m[1]);
    expect(guards).toEqual(['TelemetryThrottlerGuard', 'AuthGuard', 'AdminGuard']);
  });

  it('路由装饰器与 TELEMETRY_PATH 常量静态锁（漂移则 getTracker 匹配失效→静默回落 req.ip 全站共享单桶——collab-shrink.spec:535 先例）', () => {
    expect(CTRL_SRC).toContain("@Controller('api/collab')");
    expect(CTRL_SRC).toContain("@Post('telemetry')");
  });

  it('@NoTransform+@HttpCode(204)（TransformInterceptor 会包 {code:0,data}——sendBeacon 面恒空体）', () => {
    expect(CTRL_SRC).toContain('@HttpCode(204)');
    expect(CTRL_SRC).toContain('@NoTransform()');
  });

  it('断言无客户端自由字符串进任何 labelNames（服务端枚举唯一来源——反向 grep 型）', () => {
    const allowed = new Set(['type', 'code', 'reason', 'from', 'to']);
    const fam = register.getMetricsAsArray().filter((m) => m.name.startsWith('collab_telemetry_'));
    // 十一族齐备（以实际注册全名为准——check-spec-consistency.mjs 与 spec §10 同集；
    // T2 控制器裁决扩 hydration/reconnect 两直方图——buckets [50,250,1000,5000,15000]，无 label；
    // T8 扩 client_doc_bytes 直方图——buckets 至 8MB 闸界，无 label）
    expect(fam.map((m) => m.name).sort()).toEqual([
      'collab_telemetry_auth_reject_total', 'collab_telemetry_client_doc_bytes', 'collab_telemetry_close_total',
      'collab_telemetry_events_total', 'collab_telemetry_hydration_ms', 'collab_telemetry_projection_ms',
      'collab_telemetry_reconnect_ms', 'collab_telemetry_rejected_total', 'collab_telemetry_unknown_total',
      'collab_telemetry_ws_reason_total', 'collab_telemetry_ws_transition_total',
    ]);
    for (const m of fam) {
      for (const l of (m as any).labelNames ?? []) {
        expect(allowed.has(l), `${m.name} 的 label "${l}" 不在受控枚举 {type,code,reason,from,to}`).toBe(true);
      }
    }
    // 两 SLO 直方图 bucket 边界钉死（裁决给定 [50,250,1000,5000,15000]——漂移=口径漂移；ms 桶同 projection_ms 先例）
    for (const name of ['collab_telemetry_hydration_ms', 'collab_telemetry_reconnect_ms']) {
      const h: any = register.getSingleMetric(name);
      expect(h?.buckets).toEqual([50, 250, 1000, 5000, 15000]);
    }
  });
});

// ---------- B getTracker 单元（cookie 哈希——不依赖 req.user ⇒ 与 APP_GUARD 顺序解耦） ----------

describe('Y0b-5 T1 TelemetryThrottlerGuard.getTracker（cookie 哈希分桶）', () => {
  const guard = new TelemetryThrottlerGuard([] as any, {} as any, {} as any);
  const getTracker = (req: Record<string, any>) => (guard as any).getTracker(req) as Promise<string>;

  it('telemetry 路由+cookie → sha256(parseSessionToken)[0:16]（req.headers.cookie 直接读）', async () => {
    const token = 'tok-abc123';
    const hashed = createHash('sha256').update(token).digest('hex').slice(0, 16);
    await expect(getTracker({ path: '/api/collab/telemetry', headers: { cookie: `other=1; flowweb.session_token=${token}` }, ip: '9.9.9.9' })).resolves.toBe(hashed);
  });

  it('缺 cookie → 回落 req.ip；非 telemetry 路由 → super（req.ip——全局其余路由行为不变）', async () => {
    await expect(getTracker({ path: '/api/collab/telemetry', headers: {}, ip: '9.9.9.9' })).resolves.toBe('9.9.9.9');
    await expect(getTracker({ path: '/api/works', headers: { cookie: 'flowweb.session_token=tok-abc123' }, ip: '9.9.9.9' })).resolves.toBe('9.9.9.9');
  });
});

// ---------- B2 TelemetryService 单元：invariant_violation 事件级结构化日志（Y0b-5 T2 审查修复） ----------

describe('Y0b-5 T2 审查修复（登记裁决）：invariant_violation log-only 键事件级日志——Y5 前可诊断兑现', () => {
  it('dispatch 对该 type 打 {event:collab_telemetry_invariant,entries:[{where,name,frame,n}]}（sanitize 后 detail）——n=事件级聚合计数不丢（M-1：30s 窗 40 次与 1 次不同形）；无 n 键缺省不出现', () => {
    const svc = new TelemetryService();
    const logSpy = vi.spyOn((svc as any).logger, 'log');
    svc.ingest({ events: [
      { type: 'invariant_violation', at: 1, n: 40, detail: { where: 'react-boundary', name: 'TypeError', frame: 'CanvasPage.tsx:42' } },
      { type: 'invariant_violation', at: 2, detail: { where: 'applyBootstrap', name: 'ProjectionMismatch', frame: 'canvasCollabRuntime.ts:1339' } },
    ] });
    const lines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('collab_telemetry_invariant'));
    expect(lines).toHaveLength(2);   // 逐条结构化日志（罕见事件不聚合服务端再摊平）
    expect(JSON.parse(lines[0]!)).toEqual({
      event: 'collab_telemetry_invariant',
      entries: [{ where: 'react-boundary', name: 'TypeError', frame: 'CanvasPage.tsx:42', n: 40 }],
    });
    // 无 n（非聚合/旧客户端）——JSON.stringify 剥 undefined，键缺省不出现
    expect(JSON.parse(lines[1]!)).toEqual({
      event: 'collab_telemetry_invariant',
      entries: [{ where: 'applyBootstrap', name: 'ProjectionMismatch', frame: 'canvasCollabRuntime.ts:1339' }],
    });
  });
});

// ---------- C 真实 HTTP 集成（http-order spec 形态——镜像 app.module 的 APP_GUARD 注册序） ----------

describe('Y0b-5 T1 telemetry 端点（真实 HTTP 集成）', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],   // 镜像 app.module 全局桶
      controllers: [TelemetryController],
      providers: [
        TelemetryService,
        { provide: SessionService, useValue: { touch: vi.fn(async () => ({ user: { id: 't1' } })) } },
        { provide: APP_GUARD, useClass: TelemetryThrottlerGuard },   // 镜像注册序：边缘限流先于鉴权
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => { await app.close(); });

  const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    fetch(`${base}/api/collab/telemetry`, {
      method: 'POST',
      headers: { cookie: 'flowweb.session_token=tok-t1', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('合法批次（含 detail 受控值）→204 空体（@NoTransform+@HttpCode(204)——TransformInterceptor 会包 {code:0,data}）', async () => {
    const delta = await metricDelta('collab_telemetry_events_total', { type: 'hydration_fail' }, async () => {
      const res = await post({ events: [{ type: 'hydration_fail', at: 1 }], clientBuild: 'v1.2.3', csv: '3', generation: 'g1' });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });
    expect(delta).toBe(1);
  });

  it('close_code→collab_telemetry_close_total{code="4408"} 计数；code 越界值→{code="other"}（防基数）', async () => {
    await post({ events: [
      { type: 'close_code', at: 1, detail: { code: 4408 } },
      { type: 'close_code', at: 2, detail: { code: 9999 } },
    ] });
    await expect(counterOf('collab_telemetry_close_total', { code: '4408' })).resolves.toBeGreaterThanOrEqual(1);
    await expect(counterOf('collab_telemetry_close_total', { code: 'other' })).resolves.toBeGreaterThanOrEqual(1);
  });

  it('auth_reject→collab_telemetry_auth_reject_total{reason="draining"}；未知 reason→{reason="other"}', async () => {
    await post({ events: [
      { type: 'auth_reject', at: 1, detail: { reason: 'draining' } },
      { type: 'auth_reject', at: 2, detail: { reason: 'zzz-not-a-reason' } },
    ] });
    await expect(counterOf('collab_telemetry_auth_reject_total', { reason: 'draining' })).resolves.toBeGreaterThanOrEqual(1);
    await expect(counterOf('collab_telemetry_auth_reject_total', { reason: 'other' })).resolves.toBeGreaterThanOrEqual(1);
  });

  it('projection_duration.ms→collab_telemetry_projection_ms Histogram observe；ws_status.reason=unsynced-lag→collab_telemetry_ws_reason_total{reason}；from/to→ws_transition_total', async () => {
    const observed = await observeDelta('collab_telemetry_projection_ms', 'count', async () => {
      await post({ events: [
        { type: 'projection_duration', at: 1, detail: { ms: 42 } },
        { type: 'ws_status', at: 2, detail: { reason: 'unsynced-lag', from: 'connecting', to: 'connected' } },
      ] });
    });
    expect(observed).toBe(1);
    await expect(observeOf('collab_telemetry_projection_ms', 'sum')).resolves.toBeGreaterThanOrEqual(42);
    await expect(counterOf('collab_telemetry_ws_reason_total', { reason: 'unsynced-lag' })).resolves.toBeGreaterThanOrEqual(1);
    await expect(counterOf('collab_telemetry_ws_transition_total', { from: 'connecting', to: 'connected' })).resolves.toBeGreaterThanOrEqual(1);
  });

  it('Y0b-5 T2（控制器裁决）SLO 两直方图分派：ws_status 带 ms 且 from/to=hydration 迁移形态→hydration_ms observe；disconnected→connected→reconnect_ms；真实迁移（不带 ms）不 observe', async () => {
    const hSum = await observeDelta('collab_telemetry_hydration_ms', 'sum', async () => {
      const hCount = await observeDelta('collab_telemetry_hydration_ms', 'count', async () => {
        await post({ events: [
          { type: 'ws_status', at: 1, detail: { from: 'connecting', to: 'connected', ms: 800 } },     // hydration 形态
          { type: 'ws_status', at: 2, detail: { from: 'disconnected', to: 'connected', ms: 2500 } },  // reconnect 形态
          { type: 'ws_status', at: 3, detail: { from: 'connected', to: 'disconnected' } },            // 真实迁移不带 ms
          { type: 'ws_status', at: 4, detail: { from: 'connecting', to: 'connected', ms: '42' } },    // 非 number 剥键→不 observe
        ] });
      });
      expect(hCount).toBe(1);   // 仅 ms:800 一条到达 hydration 直方图
    });
    expect(hSum).toBe(800);
    await expect(observeOf('collab_telemetry_reconnect_ms', 'count')).resolves.toBeGreaterThanOrEqual(1);
    await expect(observeOf('collab_telemetry_reconnect_ms', 'sum')).resolves.toBeGreaterThanOrEqual(2500);
    // 不带 ms 的真实迁移仍进 transition 计数（直方图零 observe——上式 count 不含它）
    await expect(counterOf('collab_telemetry_ws_transition_total', { from: 'connected', to: 'disconnected' })).resolves.toBeGreaterThanOrEqual(1);
  });

  it('Y0b-5 T8 docBytes→collab_telemetry_client_doc_bytes Histogram observe（E33 指定的 E26 重建触发源——与 from/to 迁移面独立可单独成事件；非 number 剥键不 observe）', async () => {
    const count = await observeDelta('collab_telemetry_client_doc_bytes', 'count', async () => {
      const sum = await observeDelta('collab_telemetry_client_doc_bytes', 'sum', async () => {
        await post({ events: [
          { type: 'ws_status', at: 1, detail: { docBytes: 1_048_576 } },   // docBytes 单独成事件
          { type: 'ws_status', at: 2, detail: { docBytes: '8388608' } },   // 非 number 剥键
        ] });
      });
      expect(sum).toBe(1_048_576);
    });
    expect(count).toBe(1);
  });

  it('未知 type→204 且只计 collab_telemetry_unknown_total（禁 4xx——sendBeacon 不可观测响应，413 同为重试风暴面；超限同样 204+collab_telemetry_rejected_total{reason}）', async () => {
    const events6 = (t: string) => Array.from({ length: 6 }, (_, i) => ({ type: t, at: i }));
    const unknownDelta = await metricDelta('collab_telemetry_unknown_total', {}, async () => {
      const res = await post({ events: [{ type: 'mischief-free-string', at: 1 }] });
      expect(res.status).toBe(204);   // 未知 type 不 4xx
    });
    expect(unknownDelta).toBe(1);
    // 未知 type 值是客户端自由字符串——禁进 events_total 的 type label
    await expect(counterOf('collab_telemetry_events_total', { type: 'mischief-free-string' })).resolves.toBe(0);

    // 超 12 条→204+batch-size（整批拒）
    const batchDelta = await metricDelta('collab_telemetry_rejected_total', { reason: 'batch-size' }, async () => {
      const res = await post({ events: Array.from({ length: 13 }, (_, i) => ({ type: 'hydration_fail', at: i })) });
      expect(res.status).toBe(204);
    });
    expect(batchDelta).toBe(1);

    // 单条 stringify>512B→204+event-bytes（逐条拒，批内其余照常）
    const bytesDelta = await metricDelta('collab_telemetry_rejected_total', { reason: 'event-bytes' }, async () => {
      const res = await post({ events: [
        { type: 'hydration_fail', at: 1, detail: { junk: 'x'.repeat(600) } },   // 表外键+超字节——先按原始条目判字节
        { type: 'hydration_fail', at: 2 },
      ] });
      expect(res.status).toBe(204);
    });
    expect(bytesDelta).toBe(1);

    // 单 type 单 flush 窗 ≤5（降频防单一事件刷屏）
    const capEvents = events6('recover_triggered');
    const sampleDelta = await metricDelta('collab_telemetry_rejected_total', { reason: 'sample-cap' }, async () => {
      const res = await post({ events: capEvents });
      expect(res.status).toBe(204);
    });
    expect(sampleDelta).toBe(1);   // 6 条同 type→1 条被截断
  });

  it('Content-Type text/plain→204 零计数（Nest json parser 不解析=预检防线维持——禁加 Parser 容错）', async () => {
    const postPlain = () => post('not-json', { 'content-type': 'text/plain' }).then((r) => {
      expect(r.status).toBe(204);   // 空/异形 body 同样一律 204
    });
    await expect(metricDelta('collab_telemetry_events_total', { type: 'hydration_fail' }, postPlain)).resolves.toBe(0);
    await expect(metricDelta('collab_telemetry_unknown_total', {}, postPlain)).resolves.toBe(0);
    await expect(metricDelta('collab_telemetry_rejected_total', { reason: 'batch-size' }, postPlain)).resolves.toBe(0);
  });

  it('AuthGuard：无 cookie 401（sendBeacon 唯一凭据面）', async () => {
    const res = await fetch(`${base}/api/collab/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },   // 无 cookie
      body: JSON.stringify({ events: [{ type: 'hydration_fail', at: 1 }] }),
    });
    expect(res.status).toBe(401);
  });
});
