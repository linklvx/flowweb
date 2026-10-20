// apps/api/src/modules/media/safe-remote-fetch.service.spec.ts —— Y1a+Y1b T5 红测（unit）
// SafeRemoteFetch 原语（本卡先建；T6 四处替换 ai-download/ai-image-edit/lighting/media-process）：
// SSRF 四门：https-only/host allowlist 后缀匹配/DNS 私网拒/重定向禁随（redirect:'error'）
// + 流式限长（Content-Length 预检超限 oversize + body 字节超限中途截断）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SafeRemoteFetchService, DEFAULT_SAFE_FETCH_ALLOWLIST } from './safe-remote-fetch.service';

// global fetch spy（undici 形态断言用——不真发网）
const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubEnv('SAFE_FETCH_HOST_ALLOWLIST', 'cdn.example.com,aliyuncs.com');
  vi.stubEnv('SAFE_FETCH_MAX_CONTENT_LENGTH', '1000');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const res = (over: Partial<Response> = {}): Response =>
  ({ status: 200, headers: new Headers(), body: null, ...over } as unknown as Response);

describe('SafeRemoteFetchService（SSRF 四门+流式限长）', () => {
  it('DEFAULT_SAFE_FETCH_ALLOWLIST 含 provider 域（仓内静态外呼 host 实证=api-caller dashscope.aliyuncs.com；结果 CDN 域为运行期值——env 可扩）', () => {
    expect(DEFAULT_SAFE_FETCH_ALLOWLIST.join(',')).toContain('aliyuncs.com');
    expect(DEFAULT_SAFE_FETCH_ALLOWLIST.join(',')).toContain('myqcloud.com');
  });

  it('http:// 一律拒（https-only——明文通道+协议降级面）', async () => {
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('http://cdn.example.com/a.png')).rejects.toThrow(/https/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('非白名单 host 拒（allowlist 后缀匹配：精确/子域放行，他域拒）', async () => {
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('https://evil.com/a.png')).rejects.toThrow(/allowlist|白名单/i);
    await expect(svc.open('https://fake-aliyuncs.com.evil.net/a.png')).rejects.toThrow(/allowlist|白名单/i); // 后缀伪造拒
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('白名单子域放行（dashscope-result-xx.oss-cn-beijing.aliyuncs.com 形态）且 fetch 带 redirect:"error"（maxRedirects:0 等价——重定向禁随）', async () => {
    fetchSpy.mockResolvedValueOnce(res());
    const svc = new SafeRemoteFetchService();
    await svc.open('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a.png');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
  });

  it('私网 IP 拒（DNS 解析任一地址落私网/回环/链路本地段即拒——DNS rebinding 面的第一道门）', async () => {
    vi.stubEnv('SAFE_FETCH_HOST_ALLOWLIST', 'localhost,private.test');
    const svc = new SafeRemoteFetchService();
    await expect(svc.open('https://localhost/a.png')).rejects.toThrow(/私网|private/i);   // 127.0.0.1
    await expect(svc.open('https://private.test/a.png')).rejects.toThrow(/私网|private/i); // dns.lookup mock（下方）→ 10.0.0.1
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Content-Length 预检超限 → oversize:true 不发流（调用方映射 410+Retry-After）', async () => {
    fetchSpy.mockResolvedValueOnce(res({ headers: new Headers({ 'content-length': '9999' }) }));
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
    fetchSpy.mockResolvedValueOnce(res({ body }));
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
