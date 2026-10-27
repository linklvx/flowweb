// apps/api/src/modules/collab/collab-upgrade.spec.ts
// Y0b-3 T2：upgrade 面——Origin 403（socket 直写+end）+升级限流+cookie-only+绑定默认翻转。
// 红锚：改前无 onUpgrade 钩子=伪造 Origin 握手成功（红）；authenticate query token 优先=forged 放行（红）；
// TokenBucket 模块不存在（红）；gateway 无 clientIpOf（红）。
// 夹具基座=T1.5 startDualClientServer（真连面）+multi-instance.spec.ts:39 直调 hooks 先例（cookie-only 面）。
import { EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { CollabGateway } from './collab.gateway';
import { TokenBucket } from './token-bucket';
import { parseSessionToken } from '../../common/utils/parse-session-token';
import { startDualClientServer } from '../../test-utils/dual-client-server';
import { createMockRepo } from '../../test-utils/mock-repo';
import { createLeaseStub } from './test-utils/lease-stub';
import { gatewayFacade } from './test-utils/collab-gateway-test-facade';   // Y0c T39b 波 2：内部状态访问经 façade（check-collab-test-facade 门禁）
import { CollabSpoolService } from './collab-spool.service';
import { CANVAS_DOC_SCHEMA_VERSION, CollabAuthReason, CLIENT_PROTOCOL_VERSION } from '@flowweb/shared';
import { register } from 'prom-client';
import { describe, it, expect, afterEach, vi } from 'vitest';

/** 指标现值（label 集求和的 reason 单值；指标未注册=0——改前红=差值 0≠1） */
async function upgradeRejected(reason: string): Promise<number> {
  const m = register.getSingleMetric('collab_upgrade_rejected_total');
  if (!m) return 0;
  return (await m.get()).values.filter((v) => v.labels.reason === reason).reduce((s, v) => s + v.value, 0);
}

/** 原生 ws 连接（Node ws 包 headers 选项——undici 全局 WebSocket 不支持自定义 header，T1.5 探针实证） */
function connectWs(url: string, headers: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers });
  return new Promise((res, rej) => {
    ws.once('open', () => res(ws));
    ws.once('error', (e) => rej(e instanceof Error ? e : new Error(String(e))));
    ws.once('unexpected-response', (_req, r) => rej(new Error(`unexpected response ${r.statusCode}`)));
  });
}

describe('T2 parse-session-token 三形态门（P-R 契约固化）', () => {
  // Step 0 探针结论：better-auth 1.6.11（dist/cookies/index.mjs:20）useSecureCookies 未显式设置时
  // 按 baseURL 协议推断——生产 BETTER_AUTH_URL=https ⇒ cookie 名=__Secure-flowweb.session_token；
  // dev http ⇒ 裸名。现正则 /flowweb\.session_token=([^;]+)/ 非锚定子串匹配**天然兼容前缀变体**
  // （plan 担心的"生产全站静默拒"不成立）——零改动，本组用例固化三形态契约防未来漂移（误加 ^ 锚等）。
  it('三形态解析：①正常 ②__Secure- 前缀变体 ③多 cookie 并存（会话 cookie 不在首位）', () => {
    expect(parseSessionToken('flowweb.session_token=abc; other=1')).toBe('abc');
    expect(parseSessionToken('__Secure-flowweb.session_token=abc')).toBe('abc');
    expect(parseSessionToken('a=1; flowweb.session_token=xyz; b=2')).toBe('xyz');
  });
  it('无 cookie/无匹配 → null（authenticate 判空拒 UNAUTHENTICATED）', () => {
    expect(parseSessionToken(null)).toBeNull();
    expect(parseSessionToken('other=1')).toBeNull();
  });
});

describe('T2 Origin 校验（真连——onUpgrade 钩子 socket 直写形态）', () => {
  afterEach(async () => vi.restoreAllMocks());

  it('伪造 Origin→握手失败（403）+计数 reason=origin（改前红：无钩子=握手成功）', async () => {
    const kit = await startDualClientServer();
    try {
      const before = await upgradeRejected('origin');
      await expect(connectWs(kit.url, { origin: 'https://evil.example' })).rejects.toThrow(/403/);   // I-2：状态码断言敏感化（connectWs unexpected-response 分支已拼 statusCode 进 message）
      expect((await upgradeRejected('origin')) - before).toBe(1);
    } finally {
      await kit.dispose();
    }
  }, 15_000);

  it('合法 Origin（dev 推导表 localhost:5173）→握手成功', async () => {
    const kit = await startDualClientServer();
    try {
      const ws = await connectWs(kit.url, { origin: 'http://localhost:5173' });
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await kit.dispose();
    }
  }, 15_000);

  it('显式 COLLAB_ALLOWED_ORIGINS 注入→白名单外拒/表内放（env save/restore 惯例）', async () => {
    const saved = process.env.COLLAB_ALLOWED_ORIGINS;
    process.env.COLLAB_ALLOWED_ORIGINS = 'https://my-origin.example';
    const kit = await startDualClientServer();
    try {
      await expect(connectWs(kit.url, { origin: 'https://evil.example' })).rejects.toThrow(/403/);   // I-2：状态码断言敏感化（connectWs unexpected-response 分支已拼 statusCode 进 message）
      const ws = await connectWs(kit.url, { origin: 'https://my-origin.example' });
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await kit.dispose();
      if (saved === undefined) delete process.env.COLLAB_ALLOWED_ORIGINS; else process.env.COLLAB_ALLOWED_ORIGINS = saved;
    }
  }, 15_000);

  it('Origin 缺失=拒（非浏览器工具注入不了也就不需要它）+计数 reason=origin', async () => {
    const kit = await startDualClientServer();
    try {
      const before = await upgradeRejected('origin');
      await expect(connectWs(kit.url, {})).rejects.toThrow(/403/);   // I-2：状态码断言敏感化（connectWs unexpected-response 分支已拼 statusCode 进 message）
      expect((await upgradeRejected('origin')) - before).toBe(1);
    } finally {
      await kit.dispose();
    }
  }, 15_000);
});

describe('T2 cookie-only（authenticate query token 通道删除——§1.3 对象 4）', () => {
  // 直调 hooks 形态（multi-instance.spec.ts:39 先例——零网络开销）；kit 装置（onModuleInit 后 serving——
  // 直构不 init 停 initializing 撞 lease 门）。kit prisma stub session.findUnique 恒返 session（不验 token 值）。
  it('伪造 query token+无 cookie→UNAUTHENTICATED 拒（改前红：query 优先=stub 放行）', async () => {
    const kit = await startDualClientServer();
    try {
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams(`?token=forged-token&csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:fx', connectionConfig: {},
      } as any)).rejects.toMatchObject({ reason: CollabAuthReason.UNAUTHENTICATED });
    } finally {
      await kit.dispose();
    }
  });

  it('合法 cookie 放行（query token 同在也只认 cookie——防过度收紧绿守卫）', async () => {
    const kit = await startDualClientServer();
    try {
      await expect(kit.gateway.hooks.onAuthenticate({
        requestHeaders: new Headers({ cookie: 'flowweb.session_token=tok' }),
        requestParameters: new URLSearchParams(`?token=forged-token&csv=${CLIENT_PROTOCOL_VERSION}&sv=${CANVAS_DOC_SCHEMA_VERSION}`),   // Y0b-3 T5 版本门：装置带当前协议版
        documentName: 'project:fx', connectionConfig: {},
      } as any)).resolves.toBeDefined();
    } finally {
      await kit.dispose();
    }
  });
});

describe('T2 TokenBucket（升级限流——DoS 兜底非配额）', () => {
  it('同 IP 超 capacity→false；异 IP 互不影响', () => {
    const bucket = new TokenBucket({ capacity: 20, refillPerMin: 60 });
    for (let i = 0; i < 20; i++) expect(bucket.consume('a')).toBe(true);
    expect(bucket.consume('a')).toBe(false);
    expect(bucket.consume('b')).toBe(true);
  });

  it('时间补充：refillPerMin 按流逝回补（1/60 per ms）', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerMin: 60 });
    expect(bucket.consume('a')).toBe(true);
    expect(bucket.consume('a')).toBe(true);
    expect(bucket.consume('a')).toBe(false);
    await new Promise((r) => setTimeout(r, 60));   // 60ms ⇒ 补 60*(60/60000)=0.06——不足以整消费
    expect(bucket.consume('a')).toBe(false);
    // 大流量位：refillPerMin=6000 ⇒ 100/s——100ms 补 10 ≥ 2
    const fast = new TokenBucket({ capacity: 2, refillPerMin: 6000 });
    fast.consume('a'); fast.consume('a');
    expect(fast.consume('a')).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(fast.consume('a')).toBe(true);
  });

  it('Map 上界 10_000：超界清最旧（防无界键集合——伪造 X-Real-IP 洪泛）', () => {
    const bucket = new TokenBucket({ capacity: 20, refillPerMin: 60 });
    for (let i = 0; i < 10_001; i++) bucket.consume(`ip-${i}`);
    expect(bucket.consume('ip-0')).toBe(true);   // 最旧已被清——容量恢复
    expect(bucket.consume('ip-10000')).toBe(true);   // 最新仍在（半满）
  });

  it('失败分支积分保留：持续快速重试不清零补充进度——按速率可恢复（改前红：refill 整体丢弃→永久 429）', async () => {
    // I-1：标准桶语义 tokens(t)=min(cap, tokens(t0)+rate·Δt)——失败尝试也须落账已积 refill。
    // 300/min=5/s ⇒ 1 枚/200ms；单 gap 2ms refill≈0.01≪1——改前实现每次把进度清零，单 gap 永远
    // 凑不足 1 枚（需一次 ≥200ms 调度停顿才假绿——sleep(2) 抖到 200ms 实际不可能），300 轮内恒 false。
    const bucket = new TokenBucket({ capacity: 2, refillPerMin: 300 });
    bucket.consume('a');
    bucket.consume('a');
    expect(bucket.consume('a')).toBe(false);   // 桶空
    let recovered = false;
    for (let i = 0; i < 300; i++) {   // 被限流客户端持续重试形态（重试间隔 ≪ 补充周期 200ms）
      await new Promise((r) => setTimeout(r, 2));
      if (bucket.consume('a')) { recovered = true; break; }
    }
    expect(recovered).toBe(true);   // 正确语义：累计 200ms 即恢复（约 100 轮内——真实时间流逝不禁 fake timers）
  }, 10_000);
});

/** 直调装置（clientIpOf/handleUpgrade 用例共用——multi-instance.spec.ts:39 直调 hooks 先例） */
function buildGateway(): CollabGateway {
  return new CollabGateway({} as any, new EventEmitter2() as any, createMockRepo() as any,
    createLeaseStub() as any, { resolve: vi.fn() } as any, 48900, 300, undefined, undefined, new CollabSpoolService('unused'));
}

describe('T2 clientIpOf（X-Real-IP 信任双门——peer loopback+COLLAB_TRUSTED_PROXY）', () => {
  it('信任门控：COLLAB_TRUSTED_PROXY 未设→peer 恒信任不启用（限流全站单桶=生产必须设 env——部署告知项）', () => {
    const gw = buildGateway();
    const saved = process.env.COLLAB_TRUSTED_PROXY;
    try {
      delete process.env.COLLAB_TRUSTED_PROXY;
      expect(gw.sessionGuard.clientIpOf({ headers: { 'x-real-ip': '1.2.3.4' } }, { remoteAddress: '127.0.0.1' })).toBe('127.0.0.1');
      process.env.COLLAB_TRUSTED_PROXY = '1';
      expect(gw.sessionGuard.clientIpOf({ headers: { 'x-real-ip': '1.2.3.4' } }, { remoteAddress: '127.0.0.1' })).toBe('1.2.3.4');
      // 非 loopback peer 不信任 X-Real-IP（即使门开——外部直连伪造头无效）
      expect(gw.sessionGuard.clientIpOf({ headers: { 'x-real-ip': '1.2.3.4' } }, { remoteAddress: '10.0.0.5' })).toBe('10.0.0.5');
    } finally {
      if (saved === undefined) delete process.env.COLLAB_TRUSTED_PROXY; else process.env.COLLAB_TRUSTED_PROXY = saved;
    }
  });
});

describe('T2 handleUpgrade 直调（429 限流路径+fail-open 遥测——(gw as any) 直调先例形态）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('429：桶耗尽→socket 直写 429 状态行+end+计数 reason=rate-limited（I-2：改前整条路径零覆盖）', async () => {
    const gw = buildGateway();
    const before = await upgradeRejected('rate-limited');
    const gf = gatewayFacade(gw);
    for (let i = 0; i < 20; i++) expect(gf.consumeUpgradeBucket('127.0.0.1')).toBe(true);   // 同步排空（capacity 20——零 refill 漂移）
    const writes: string[] = [];
    const socket = { write: (s: string) => { writes.push(s); }, end: vi.fn(), remoteAddress: '127.0.0.1' };
    expect(() => gw.sessionGuard.handleUpgrade({ request: { headers: { origin: 'http://localhost:5173' } }, socket } as any)).not.toThrow();   // payload 侧 as any（夹具部分形状——W3a 既有合法形态；受体=gw.sessionGuard 公有非 cast 面）
    expect(writes[0]).toContain('HTTP/1.1 429 Too Many Requests');   // 状态行直写（客户端收到真实 HTTP 响应）
    expect(socket.end).toHaveBeenCalledTimes(1);   // end 替代 destroy（write 后立即 destroy=RST 非 429）
    expect((await upgradeRejected('rate-limited')) - before).toBe(1);
  });

  it('fail-open 兜底：allowedOrigins 抛错（BETTER_AUTH_URL 配垃圾串→new URL TypeError 形态）→吞错放行+logger.warn 留痕', () => {
    // I-3：改前 catch 全吞零遥测——Origin 防线静默失效且运维零可见（红锚=warn 未调）
    const gw = buildGateway();
    gatewayFacade(gw).spyAllowedOrigins().mockImplementation(() => { throw new TypeError('Invalid URL'); });
    const warn = gatewayFacade(gw).spyLogger('warn').mockImplementation(() => {});
    const socket = { write: vi.fn(), end: vi.fn(), remoteAddress: '127.0.0.1' };
    expect(() => gw.sessionGuard.handleUpgrade({ request: { headers: { origin: 'https://x.example' } }, socket } as any)).not.toThrow();   // payload 侧 as any（夹具部分形状——W3a 既有合法形态）
    expect(warn).toHaveBeenCalledTimes(1);
    expect(socket.write).not.toHaveBeenCalled();   // fail-open=不拒（鉴权仍由 onAuthenticate 兜底）
  });
});
