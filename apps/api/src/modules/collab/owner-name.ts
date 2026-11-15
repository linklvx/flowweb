// TD-33/C1a T1：owner 目录名单源。格式（唯一权威——从右解析的定界序列）：
//   o-<sanitizedHost≤24>-<hostKey8>-<pid>-<ts36>-<rand6>
// hostKey=全 hostname sha256 前 8 hex：sanitized host 只留前 24 字符，前 24 字符相同的两台
// host 靠它区分（GC 同 host 判据的数据源）。`o-` 前缀=「非 owner 目录」的判据——同根下
// tmp/owner-A/旧格式目录一律 parse=unknown，GC 对其零处置（宁可漏回收不可误删）。
import { hostname } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'o-';
const HOST_MAX = 24;
const HOST_RE = /^[A-Za-z0-9_-]{1,24}$/;
const HOST_KEY_RE = /^[0-9a-f]{8}$/;
const PID_RE = /^[1-9][0-9]{0,9}$/;
const TS_RE = /^[0-9a-z]{1,10}$/;
const RAND_RE = /^[0-9a-f]{6}$/;

export interface ParsedOwnerName {
  /** 所属进程 pid（存活判据：isPidAlive——ESRCH=死，EPERM/unknown=保守跳过）。 */
  pid: number;
  /** 全 hostname 短 hash（同 host 判据——与 sanitized 前缀不同粒度）。 */
  hostKey: string;
}

const sanitizeHost = (host: string) => host.replace(/[^A-Za-z0-9_-]/g, 'x').slice(0, HOST_MAX);
const hostKeyOf = (host: string) => createHash('sha256').update(host).digest('hex').slice(0, 8);

/** 本机 host 的 hostKey（收录面「同 host」判据单源——与 parseOwnerName 返回的 hostKey 同域）。 */
export function currentHostKey(): string {
  return hostKeyOf(hostname());
}

/** 名字上限 64：lease 构造期 `/^[A-Za-z0-9_-]{1,64}$/` 与 spool.setOwner 同界。 */
export function buildOwnerName(host: string = hostname(), pid: number = process.pid): string {
  return `${PREFIX}${sanitizeHost(host)}-${hostKeyOf(host)}-${pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/** 严格解析：前缀/四段终字段形态/宿主段任一不符即 null（unknown=保留不处置）。 */
export function parseOwnerName(name: string): ParsedOwnerName | null {
  if (!name.startsWith(PREFIX)) return null;
  const segs: string[] = [];
  let rest = name.slice(PREFIX.length);
  for (let i = 0; i < 4; i++) {
    const cut = rest.lastIndexOf('-');
    if (cut <= 0) return null;   // cut<0=缺段；cut=0=host 为空
    segs.unshift(rest.slice(cut + 1));
    rest = rest.slice(0, cut);
  }
  const [hostKey, pidSeg, tsSeg, randSeg] = segs;
  if (!HOST_KEY_RE.test(hostKey) || !PID_RE.test(pidSeg) || !TS_RE.test(tsSeg) || !RAND_RE.test(randSeg)) return null;
  if (!HOST_RE.test(rest)) return null;
  return { pid: Number(pidSeg), hostKey };
}
