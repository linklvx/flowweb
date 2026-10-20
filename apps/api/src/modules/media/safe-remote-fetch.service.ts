// apps/api/src/modules/media/safe-remote-fetch.service.ts —— Y1a+Y1b T5（v11 骨架「MIME/SSRF」原语）
// T6 四处替换 ai-download/ai-image-edit/lighting 的消费原语（fetchBuffer）+media-content 代理消费（open）。
// SSRF 四门：①https-only ②host allowlist 后缀匹配（env 可扩）③DNS 解析任一地址落私网/回环/链路本地段
// 即拒——**undici Agent connect.lookup 钉 IP（T6 收口：解析即连接——lookup 校验过的地址直接连，
// 不二次解析，TOCTOU 闭环）**；字面 IP host 前置拒（免 DNS）④redirect:'error'（重定向禁随）。
// 流式限长：Content-Length 预检 oversize + body 字节超限中途截断（谎报/缺报 content-length 皆兜住）。
// allowlist 默认域来源实证（2026-10-20 grep）：仓内静态外呼 host 唯一=dashscope.aliyuncs.com
// （api-caller.service.ts:112）；provider 结果 CDN host 是运行期值（api-caller :363/:477/:501 透传
// 响应内 URL，仓内零静态样例）——按 provider 域后缀（aliyuncs.com=DashScope 全系、myqcloud.com=腾讯云系）
// 收口，运营经 SAFE_FETCH_HOST_ALLOWLIST 扩展。moonshot（openai-chat）不产媒体 URL 不入默认表。
// T6 收口（顺带）：fetch 用 undici 包实例（与 global fetch 分离——dispatcher 必须同包 Agent 实例）。
import { Injectable } from '@nestjs/common';
import dns from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';

/** 默认 allowlist（消费点单源——zod 不写 default 防双源，env.ts 同款纪律） */
export const DEFAULT_SAFE_FETCH_ALLOWLIST = ['aliyuncs.com', 'myqcloud.com'] as const;
/** 流式限长默认 2GiB（env SAFE_FETCH_MAX_CONTENT_LENGTH 覆盖） */
export const DEFAULT_SAFE_FETCH_MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024;
/** 外呼超时（headers 阶段；body 读取由流式限长与调用方 pipe 生命周期管理） */
const OPEN_TIMEOUT_MS = 30_000;
/** 下载超时默认（fetchBuffer——对齐被替换的 axios 120s 大文件基线） */
const FETCH_BUFFER_TIMEOUT_MS = 120_000;

export interface SafeFetchOpenOptions {
  /** 透传的 Range 头（processing 态视频顺序读——mediabunny UrlSource） */
  range?: string;
}

export interface SafeFetchOpenResult {
  /** Content-Length 预检超限（调用方映射 410+Retry-After——不发流） */
  oversize: boolean;
  upstream: Response | null;
  /** 上游 body 的限长包装流（oversize/无 body 时 null）——读侧超限即 cancel 上游并报 RangeError */
  cappedStream: ReadableStream<Uint8Array> | null;
}

/** 字面 IP 形态（v4 点分十进制/裸 v6——含 [] 已剥）——免 DNS 前置校验 */
function isLiteralIp(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':');
}

@Injectable()
export class SafeRemoteFetchService {
  /** 钉 IP dispatcher：connect.lookup 内完成「解析→私网校验→回传单地址」——校验的 IP 即连接的 IP */
  private readonly dispatcher: Agent;

  /** 单独导出判定（T6 替换面复用——纯函数可单测） */
  isAllowedHost(host: string, allowlist: string[]): boolean {
    const h = host.toLowerCase();
    return allowlist.some((e) => h === e || h.endsWith(`.${e}`));
  }

  constructor() {
    this.dispatcher = new Agent({
      connect: {
        lookup: (hostname: string, _opts: unknown, cb: (err: Error | null, address: string | Array<{ address: string; family: number }>) => void) => {
          dns.promises.lookup(hostname, { all: true }).then(
            (entries) => {
              for (const { address } of entries as Array<{ address: string; family: number }>) {
                if (isPrivateAddress(address)) {
                  cb(new Error(`safe-fetch 私网/保留地址拒: ${hostname} → ${address}`), '');   // err 非 null 时 address 被忽略（node lookup 惯例）
                  return;
                }
              }
              // 钉首地址（校验即连接——后续 A 记录轮换/二次解析不再影响连接目标）
              const first = (entries as Array<{ address: string; family: number }>)[0];
              cb(null, [{ address: first.address, family: first.family }]);
            },
            (e) => cb(new Error(`safe-fetch DNS 解析失败: ${hostname}（${String(e?.message ?? e)}）`), ''),
          );
        },
      },
    });
  }

  private allowlist(): string[] {
    const parsed = (process.env.SAFE_FETCH_HOST_ALLOWLIST ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return parsed.length > 0 ? parsed : [...DEFAULT_SAFE_FETCH_ALLOWLIST];
  }

  private maxBytes(): number {
    const v = Number(process.env.SAFE_FETCH_MAX_CONTENT_LENGTH);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SAFE_FETCH_MAX_CONTENT_LENGTH;
  }

  /** 门①②③（字面 IP 面）校验——域名私网面由 dispatcher lookup 承担（解析即连接） */
  private assertAllowed(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`safe-fetch 非法 URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`safe-fetch 仅允许 https（拒绝 ${parsed.protocol}//）`);
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');   // WHATGW URL v6 hostname 带括号——归一化
    if (!this.isAllowedHost(host, this.allowlist())) {
      throw new Error(`safe-fetch host 不在 allowlist: ${host}`);
    }
    if (isLiteralIp(host) && isPrivateAddress(host)) {
      throw new Error(`safe-fetch 私网/保留地址拒: ${host}`);
    }
    return parsed;
  }

  /** 基础 init（门④ redirect 禁随+钉 IP dispatcher+超时） */
  private baseInit(timeoutMs: number, range?: string) {
    return {
      redirect: 'error' as const,               // 门④：重定向禁随
      dispatcher: this.dispatcher,              // 门③连接面：lookup 钉 IP（TOCTOU 闭环）
      headers: range ? { Range: range } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    };
  }

  async open(url: string, opts: SafeFetchOpenOptions = {}): Promise<SafeFetchOpenResult> {
    this.assertAllowed(url);
    const res = await undiciFetch(url, this.baseInit(OPEN_TIMEOUT_MS, opts.range)) as unknown as Response;

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes()) {
      await res.body?.cancel().catch(() => {});
      return { oversize: true, upstream: null, cappedStream: null };
    }
    return { oversize: false, upstream: res, cappedStream: res.body ? this.capStream(res.body, this.maxBytes()) : null };
  }

  /** 整段下载（T6 三处替换消费：ai-download/ai-image-edit/lighting 的 provider 结果 URL）。
   *  四门同 open；超限（预检或读侧截断）抛 RangeError、非 2xx 抛 Error——调用方按 job 失败处理。 */
  async fetchBuffer(url: string, timeoutMs = FETCH_BUFFER_TIMEOUT_MS): Promise<{ buffer: Buffer; contentType: string | null }> {
    this.assertAllowed(url);
    const res = await undiciFetch(url, this.baseInit(timeoutMs)) as unknown as Response;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes()) {
      await res.body?.cancel().catch(() => {});
      throw new RangeError(`safe-fetch 流式限长超限（>${this.maxBytes()} bytes）`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`safe-fetch HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type');
    if (!res.body) return { buffer: Buffer.alloc(0), contentType };
    // 读侧限长（谎报 content-length 兜底）：cap 后聚合
    const reader = this.capStream(res.body, this.maxBytes()).getReader();
    const chunks: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value!));
    }
    return { buffer: Buffer.concat(chunks), contentType };
  }

  private capStream(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    let received = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) { controller.close(); return; }
        const remaining = maxBytes - received;
        if (value.length > remaining) {
          // 限长截断：交付剩余量后 cancel 上游+报错（总量恒 ≤ maxBytes）
          if (remaining > 0) controller.enqueue(value.subarray(0, remaining));
          received = maxBytes;
          await reader.cancel().catch(() => {});
          controller.error(new RangeError(`safe-fetch 流式限长超限（>${maxBytes} bytes）`));
          return;
        }
        received += value.length;
        controller.enqueue(value);
      },
      cancel(reason) { return reader.cancel(reason); },
    });
  }
}

/** 私网/回环/链路本地/保留段判定（v4 全段+v6 常见段+v4-mapped）。
 *  段表出处：IANA IPv4/IPv6 Special-Purpose Address Registry（RFC 6890 汇编+RFC 5737 TEST-NET-2/3+
 *  RFC 3849 v6 文档段）。注意 `a===192&&b===0` 实际覆盖 192.0.x.x 全段（192.0.0/24 本网络+192.0.2/24
 *  TEST-NET-1 等皆入）——超出注册表的 192.0.1/24 等一并拒=保守侧收口（非放行面）。 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;            // fc00::/7 ULA
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
    if (lower.startsWith('2001:db8')) return true;                                // 2001:db8::/32 文档段（RFC 3849）
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);                  // v4-mapped
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;  // 畸形=拒
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;                              // 0/8、10/8、127/8
  if (a === 100 && b >= 64 && b <= 127) return true;                              // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true;                                        // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true;                               // 172.16/12
  if (a === 192 && b === 168) return true;                                        // 192.168/16
  if (a === 192 && b === 0) return true;                                          // 192.0.x 全段（192.0.0/24 本网络+192.0.2/24 TEST-NET-1）
  if (a === 198 && (b === 18 || b === 19)) return true;                           // 198.18/15 benchmark
  if (a === 198 && b === 51) return true;                                         // 198.51.100/24 TEST-NET-2（RFC 5737）
  if (a === 203 && b === 0 && parts[2] === 113) return true;                      // 203.0.113/24 TEST-NET-3（RFC 5737）
  if (a >= 224) return true;                                                      // 224/4 multicast + 240/4 reserved
  return false;
}
