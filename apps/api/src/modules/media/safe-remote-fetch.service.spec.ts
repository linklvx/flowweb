// apps/api/src/modules/media/safe-remote-fetch.service.spec.ts —— Y1a+Y1b T5 原语+T6 收口（unit）
// SafeRemoteFetch（T6 四处替换 ai-download/ai-image-edit/lighting 的消费原语）：
// SSRF 四门：①https-only ②host allowlist 后缀匹配（env 可扩）③DNS 解析任一地址落私网/回环/链路
// 本地段即拒——**undici Agent connect.lookup 钉 IP（解析即连接，TOCTOU 闭环）**④redirect:'error'
// （重定向禁随）。流式限长：Content-Length 预检 oversize + body 字节超限中途截断。
// T6 顺带收口（T5 质评登记）：私网清单补 TEST-NET-2/3+2001:db8::/32；字面 IP host 前置拒。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SafeRemoteFetchService, DEFAULT_SAFE_FETCH_ALLOWLIST, isPrivateAddress } from './safe-remote-fetch.service';

// undici mock 面：fetch spy（不真发网）+ Agent 记录构造 opts（connect.lookup 直测——钉 IP 断言）
const h = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  agents: [] as Array<{ opts: { connect?: { lookup?: unknown } } }>,
}));
type MockAgentOpts = { connect?: { lookup?: unknown } };
vi.mock('undici', () => ({
  fetch: (...a: unknown[]) => h.fetchSpy(...(a as [])),
  Agent: class {
    opts: MockAgentOpts;
    constructor(o: MockAgentOpts) { this.opts = o; h.agents.push(this); }
  },
}));

beforeEach(() => {
  h.fetchSpy.mockReset();
  h.agents.length = 0;
  vi.stubEnv('SAFE_FETCH_HOST_ALLOWLIST', 'cdn.example.com,aliyuncs.com');
  vi.stubEnv('SAFE_FETCH_MAX_CONTENT_LENGTH', '1000');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const res = (over: Partial<Response> = {}): Response =>
  ({ status: 200, headers: new Headers(), body: null, ...over } as unknown as Response);

describe('SafeRemoteFetchService（SSRF 四门+流式限长+钉 IP）', () => {
  it('DEFAULT_SAFE_FETCH_ALLOWLIST 含 provider 域（仓内静态外呼 host 实证=api-caller dashscope.aliyuncs.com；结果 CDN 域为运行期值——env 可扩）', () => {
    expect(DEFAULT_SAFE_FETCH_ALLOWLIST.join(',')).toContain('aliyuncs.com');
    expect(DEFAULT_SAFE_FETCH_ALLOWLIST.join(',')).toContain('myqcloud.com');
  });

  it('http:// 一律拒（https-only——明文通道+协议降级面）', async () => {
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('http://cdn.example.com/a.png')).rejects.toThrow(/https/i);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('非白名单 host 拒（allowlist 后缀匹配：精确/子域放行，他域拒）', async () => {
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('https://evil.com/a.png')).rejects.toThrow(/allowlist|白名单/i);
    await expect(svc.open('https://fake-aliyuncs.com.evil.net/a.png')).rejects.toThrow(/allowlist|白名单/i); // 后缀伪造拒
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('白名单子域放行（dashscope-result-xx.oss-cn-beijing.aliyuncs.com 形态）且 fetch 带 redirect:"error"（重定向禁随）+dispatcher（钉 IP Agent 注入）', async () => {
    h.fetchSpy.mockResolvedValueOnce(res());
    const svc = new SafeRemoteFetchService();
    await svc.open('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png');
    expect(h.fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = h.fetchSpy.mock.calls[0] as [string, RequestInit & { dispatcher?: unknown }];
    expect(init.redirect).toBe('error');
    expect(init.dispatcher).toBe(h.agents[0]);   // undici Agent 注入——连接经自定义 lookup
  });

  it('字面 IP host 前置拒（免 DNS——allowlist 放行后 https://10.0.0.5/ 仍私网拒、不发 fetch）', async () => {
    vi.stubEnv('SAFE_FETCH_HOST_ALLOWLIST', 'cdn.example.com,10.0.0.5,127.0.0.1,::1');
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('https://10.0.0.5/a.png')).rejects.toThrow(/私网|private/i);
    await expect(svc.open('https://127.0.0.1/a.png')).rejects.toThrow(/私网|private/i);
    await expect(svc.open('https://[::1]/a.png')).rejects.toThrow(/私网|private/i);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it('门③=Agent connect.lookup 钉校验：域名解析任一地址落私网段即拒（cb Error——连接不发起）', async () => {
    new SafeRemoteFetchService();   // 构造副作用=Agent 注册（h.agents）
    const lookup = h.agents[0].opts.connect?.lookup as
      (hostname: string, opts: unknown, cb: (err: Error | null, addr?: unknown) => void) => void;
    expect(lookup).toBeTruthy();
    await new Promise<void>((done) => {
      lookup('private.test', {}, (err) => {
        expect(err).toBeInstanceOf(Error);
        expect(String(err?.message)).toMatch(/私网|private/i);   // dns stub → 10.0.0.1 → 拒
        done();
      });
    });
  });

  it('钉 IP 一致性：lookup 校验通过时连接地址=dns 解析首地址（单条回传——TOCTOU 闭环：校验的 IP 即连接的 IP）', async () => {
    new SafeRemoteFetchService();   // 构造副作用=Agent 注册（h.agents）
    const lookup = h.agents[0].opts.connect?.lookup as
      (hostname: string, opts: unknown, cb: (err: Error | null, addr?: unknown) => void) => void;
    await new Promise<void>((done) => {
      lookup('good.test', {}, (err, addr) => {
        expect(err).toBeNull();
        expect(addr).toEqual([{ address: '93.184.216.34', family: 4 }]);   // dns stub 公网样例
        done();
      });
    });
  });

  it('Content-Length 预检超限 → oversize:true 不发流（调用方映射 410+Retry-After）', async () => {
    h.fetchSpy.mockResolvedValueOnce(res({ headers: new Headers({ 'content-length': '9999' }) }));
    const svc = new SafeRemoteFetchService();
    const out = await svc.open('https://cdn.example.com/a.mp4');
    expect(out.oversize).toBe(true);
    expect(out.upstream).toBeNull();
  });

  it('body 流字节超限中途截断：读流至 maxBytes 即 cancel 上游（谎报 content-length 的流式防护）', async () => {
    // 无 content-length + 超限 body（1 字节×2000 按需 pull——上限 1000；pull 型使 cap 分支必达）
    let cancelCalled = false;
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(new Uint8Array([1]));
        if (produced >= 2000) controller.close();
      },
      cancel() { cancelCalled = true; },
    });
    h.fetchSpy.mockResolvedValueOnce(res({ body }));
    const svc = new SafeRemoteFetchService();
    const { upstream, cappedStream } = await svc.open('https://cdn.example.com/a.mp4');
    expect(upstream).toBeTruthy();
    expect(cappedStream).toBeTruthy();
    const reader = cappedStream!.getReader();
    let total = 0;
    let loopError: unknown = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value!.length;
      }
    } catch (e) { loopError = e; }
    expect(String((loopError as Error)?.message)).toMatch(/限长|maxBytes|limit/i);   // 限长截断错误
    expect(total).toBeLessThanOrEqual(1000);       // 交付总量恒 ≤ 上限
    expect(produced).toBeLessThan(2000);           // 上游提前停推（未产满 2000）
    expect(cancelCalled).toBe(true);               // 上游流已被 cancel（连接面释放——cap 分支内 await）
  });
});

describe('isPrivateAddress（私网/保留段清单——IANA special-purpose address registry/RFC 6890）', () => {
  it.each([
    ['10.0.0.1', true], ['127.0.0.1', true], ['0.0.0.1', true],            // 0/8、10/8、127/8
    ['100.64.0.1', true], ['169.254.1.1', true], ['172.16.0.1', true],     // CGNAT、link-local、172.16/12
    ['192.168.1.1', true],
    ['192.0.0.9', true], ['192.0.2.1', true],                             // 192.0.0/24（本网络）+192.0.2/24 TEST-NET-1——现状 a===192&&b===0 覆盖 192.0.x 全段
    ['198.18.0.1', true], ['198.19.255.1', true],                         // 198.18/15 benchmark
    ['198.51.100.1', true],                                               // TEST-NET-2（RFC 5737）——T6 补段
    ['203.0.113.1', true],                                                // TEST-NET-3（RFC 5737）——T6 补段
    ['224.0.0.1', true], ['240.0.0.1', true], ['255.255.255.255', true],  // 224/4 multicast+240/4 reserved
    ['::1', true], ['::', true], ['fc00::1', true], ['fd12::1', true],    // v6 回环/未指定/ULA
    ['fe80::1', true], ['::ffff:10.0.0.1', true],                         // link-local+v4-mapped
    ['2001:db8::1', true],                                                // v6 文档段 2001:db8::/32（RFC 3849）——T6 补段
    ['8.8.8.8', false], ['93.184.216.34', false], ['1.1.1.1', false],     // 公网样例
    ['2606:4700:4700::1111', false], ['2400:3200::1', false],             // 公网 v6（2400 段≠240/4 v4）
    ['999.1.1.1', true], ['a.b.c.d', true],                               // 畸形=拒
  ])('isPrivateAddress(%s) === %s', (addr, expected) => {
    expect(isPrivateAddress(addr)).toBe(expected);
  });
});

// dns 单点 stub（本 spec 全 host 覆盖——真 DNS 在 CI 无网/防火墙下不可依赖）：
// 私网样例 private.test→10.0.0.1 / localhost→127.0.0.1，其余一律公网地址 93.184.216.34。
vi.mock('node:dns', () => ({
  default: {
    promises: {
      lookup: vi.fn(async (hostname: string) => {
        if (hostname === 'private.test') return [{ address: '10.0.0.1', family: 4 }];
        if (hostname === 'localhost') return [{ address: '127.0.0.1', family: 4 }];
        return [{ address: '93.184.216.34', family: 4 }];
      }),
    },
  },
}));
