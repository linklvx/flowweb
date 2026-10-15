// apps/api/src/metrics/process-tree-rss.ts
// Y0c T29（Z91①/Z117①）：进程树 RSS 合计纯函数——Linux procfs 遍历：/proc/<pid>/stat 第 4 字段
// ppid 建父子映射 → 从 rootPid BFS 全后代 → 累加各 /proc/<pid>/status VmRSS。口径：进程树合计
// 含 ffmpeg 子进程（PM2 不聚合子进程——p95(worker_RSS) 改 p95(worker 进程树 RSS 合计)；sharp 为
// 进程内 native 已含主 RSS）。单 pid 消失容忍跳过（procfs 竞态）；整体失败/非 Linux ⇒ null
// （采集失败不上报不给假数——Z117①）。fs 读取器注入（ProcFsReader）⇒ Windows 开发机可单测；
// 真实 procfs 只在 Linux 服务器/CI。
import { readdirSync, readFileSync } from 'node:fs';

export interface ProcFsReader {
  platform: string;
  rootPid: number;
  /** 列 /proc 下数字名条目（pid 候选）。 */
  listPids(): string[];
  /** 读 /proc/<pid>/<file> 全文；pid 消失/不可读 ⇒ null（单点容忍面）。 */
  readProcFile(pid: string, file: 'stat' | 'status'): string | null;
}

/** /proc/<pid>/stat 第 4 字段 ppid——comm 可含空格/括号，末位 ")" 之后解析（fields[0]=state 第 3 字段）。 */
function parsePpid(stat: string): string | null {
  const close = stat.lastIndexOf(')');
  if (close < 0) return null;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  return fields.length >= 2 ? fields[1] : null;
}

/** /proc/<pid>/status 的 VmRSS 行（kB）→ 数值；缺失 ⇒ null。 */
function parseVmRssKb(status: string): number | null {
  const m = status.match(/^VmRSS:\s+(\d+) kB$/m);
  return m ? Number(m[1]) : null;
}

/** 进程树 RSS 合计字节；null=不上报（非 Linux/整体失败）。 */
export function computeProcessTreeRssBytes(reader: ProcFsReader): number | null {
  if (reader.platform !== 'linux') return null;
  try {
    const childrenOf = new Map<string, string[]>();
    for (const pid of reader.listPids()) {
      const stat = reader.readProcFile(pid, 'stat');
      if (stat === null) continue;   // 单 pid 消失容忍
      const ppid = parsePpid(stat);
      if (ppid === null) continue;
      const siblings = childrenOf.get(ppid);
      if (siblings) siblings.push(pid);
      else childrenOf.set(ppid, [pid]);
    }
    const root = String(reader.rootPid);
    let totalBytes = 0;
    const queue = [root];
    const seen = new Set<string>([root]);
    while (queue.length > 0) {
      const pid = queue.shift() as string;
      const status = reader.readProcFile(pid, 'status');
      const kb = status === null ? null : parseVmRssKb(status);
      if (kb !== null) totalBytes += kb * 1024;   // 单 pid 消失容忍跳过
      for (const child of childrenOf.get(pid) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    return totalBytes;
  } catch {
    return null;   // 整体失败不上报不给假数（Z117①）
  }
}

const procFsReader: ProcFsReader = {
  platform: process.platform,
  rootPid: process.pid,
  listPids: () => readdirSync('/proc').filter((e) => /^\d+$/.test(e)),
  readProcFile: (pid, file) => {
    try {
      return readFileSync(`/proc/${pid}/${file}`, 'utf8');
    } catch {
      return null;
    }
  },
};

/** 生产读取入口（MetricsService collect 回调消费）：本进程树 RSS 合计字节；null=不上报。 */
export function readProcessTreeRssBytes(): number | null {
  return computeProcessTreeRssBytes(procFsReader);
}
