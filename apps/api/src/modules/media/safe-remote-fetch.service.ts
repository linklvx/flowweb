// apps/api/src/modules/media/safe-remote-fetch.service.ts —— Y1a+Y1b T5（v11 骨架「MIME/SSRF」原语）
// 本卡先建原语（processing 态 content 代理消费）；T6 四处替换 ai-download/ai-image-edit/lighting/media-process+census。
// SSRF 四门：①https-only ②host allowlist 后缀匹配（env 可扩）③DNS 解析任一地址落私网/回环/链路本地段即拒
// ④redirect:'error'（maxRedirects:0 等价——重定向禁随）。流式限长：Content-Length 预检 oversize +
// body 字节超限中途截断（谎报/缺报 content-length 皆兜住）。
// allowlist 默认域来源实证（2026-10-20 grep）：仓内静态外呼 host 唯一=dashscope.aliyuncs.com
// （api-caller.service.ts:112）；provider 结果 CDN host 是运行期值（api-caller :363/:477/:501 透传
// 响应内 URL，仓内零静态样例）——按 provider 域后缀（aliyuncs.com=DashScope 全系、myqcloud.com=腾讯云系）
// 收口，运营经 SAFE_FETCH_HOST_ALLOWLIST 扩展。moonshot（openai-chat）不产媒体 URL 不入默认表。
import { Injectable } from '@nestjs/common';
import dns from 'node:dns';

/** 默认 allowlist（消费点单源——zod 不写 default 防双源，env.ts 同款纪律） */
export const DEFAULT_SAFE_FETCH_ALLOWLIST = ['aliyuncs.com', 'myqcloud.com'] as const;
/** 流式限长默认 2GiB（env SAFE_FETCH_MAX_CONTENT_LENGTH 覆盖） */
export const DEFAULT_SAFE_FETCH_MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024;
/** 外呼超时（headers 阶段；body 读取由流式限长与调用方 pipe 生命周期管理） */
const OPEN_TIMEOUT_MS = 30_000;

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

@Injectable()
export class SafeRemoteFetchService {
  /** 单独导出判定（T6 替换面复用——纯函数可单测） */
  isAllowedHost(host: string, allowlist: string[]): boolean {
    const h = host.toLowerCase();
    return allowlist.some((e) => h === e || h.endsWith(`.${e}`));
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

  /** DNS 解析任一地址落私网/保留段即拒（SSRF 门③——解析期检查；连接期 rebinding 由 allowlist 收窄面兜底） */
  private async assertNotPrivateIp(hostname: string): Promise<void> {
    let entries: Array<{ address: string; family: number }>;
    try {
      entries = await dns.promises.lookup(hostname, { all: true }) as never;
    } catch {
      throw new Error(`safe-fetch DNS 解析失败: ${hostname}`);
    }
    for (const { address } of entries) {
      if (isPrivateAddress(address)) {
        throw new Error(`safe-fetch 私网/保留地址拒: ${hostname} → ${address}`);
      }
    }
  }

  async open(url: string, opts: SafeFetchOpenOptions = {}): Promise<SafeFetchOpenResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`safe-fetch 非法 URL: ${url}`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`safe-fetch 仅允许 https（拒绝 ${parsed.protocol}//）`);
    }
    if (!this.isAllowedHost(parsed.hostname, this.allowlist())) {
      throw new Error(`safe-fetch host 不在 allowlist: ${parsed.hostname}`);
    }
    await this.assertNotPrivateIp(parsed.hostname);

    const res = await fetch(url, {
      redirect: 'error',                       // 门④：重定向禁随
      headers: opts.range ? { Range: opts.range } : undefined,
      signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
    });

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes()) {
      await res.body?.cancel().catch(() => {});
      return { oversize: true, upstream: null, cappedStream: null };
    }
    return { oversize: false, upstream: res, cappedStream: res.body ? this.capStream(res.body, this.maxBytes()) : null };
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

/** 私网/回环/链路本地/保留段判定（v4 全段+v6 常见段+v4-mapped） */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;            // fc00::/7 ULA
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
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
  if (a === 192 && b === 0) return true;                                          // 192.0.0/24 + 192.0.2/32 (TEST-NET 段族)
  if (a === 198 && (b === 18 || b === 19)) return true;                           // 198.18/15 benchmark
  if (a >= 224) return true;                                                      // 224/4 multicast + 240/4 reserved
  return false;
}
