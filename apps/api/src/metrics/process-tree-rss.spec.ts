// apps/api/src/metrics/process-tree-rss.spec.ts
// Y0c T29（Z91①/Z117①）：进程树 RSS 合计纯函数单测——fs 读取器注入（ProcFsReader），Windows
// 开发机可测（真实 procfs 只存在于 Linux 服务器/CI）。覆盖：多子进程求和（ffmpeg 子进程面）/
// 孙进程 BFS/非后代隔离/单 pid 消失容忍/comm 含空格括号解析/整体失败与非 Linux 不上报。
import { describe, it, expect } from 'vitest';
import { computeProcessTreeRssBytes, type ProcFsReader } from './process-tree-rss';

interface FakeEntry { ppid?: number; vmRssKb?: number; statRaw?: string; statMissing?: boolean }

function fakeFs(
  entries: Record<string, FakeEntry>,
  opts: { platform?: string; rootPid?: number; listThrows?: boolean } = {},
): ProcFsReader {
  return {
    platform: opts.platform ?? 'linux',
    rootPid: opts.rootPid ?? 100,
    listPids: () => {
      if (opts.listThrows) throw new Error('/proc 不可读（模拟整体失败）');
      return Object.keys(entries);
    },
    readProcFile: (pid, file) => {
      const e = entries[pid];
      if (!e) return null;   // pid 消失（竞态容忍面）
      if (file === 'stat') {
        if (e.statMissing) return null;
        return e.statRaw ?? `${pid} (proc) S ${e.ppid ?? 1} 0 0 0 0`;
      }
      return e.vmRssKb === undefined ? null : `Name:\tproc\nVmRSS:\t${e.vmRssKb} kB\n`;
    },
  };
}

describe('Y0c T29 computeProcessTreeRssBytes（Z91①进程树合计/Z117①失败不上报）', () => {
  it('非 Linux ⇒ null（不上报任何样本——Windows 开发机/非 procfs 平台无假数）', () => {
    expect(computeProcessTreeRssBytes(fakeFs({ 100: { ppid: 1, vmRssKb: 1000 } }, { platform: 'win32' }))).toBeNull();
  });

  it('单进程（仅根）⇒ 根 VmRSS×1024 字节', () => {
    expect(computeProcessTreeRssBytes(fakeFs({ 100: { ppid: 1, vmRssKb: 1000 } }))).toBe(1000 * 1024);
  });

  it('多子进程求和（root+2 children——ffmpeg 子进程面：PM2 不聚合子进程故须树合计）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 1000 },
      201: { ppid: 100, vmRssKb: 300 },
      202: { ppid: 100, vmRssKb: 250 },
    });
    expect(computeProcessTreeRssBytes(fs)).toBe((1000 + 300 + 250) * 1024);
  });

  it('孙进程计入（root→child→grandchild BFS 全后代）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 100 },
      201: { ppid: 100, vmRssKb: 50 },
      301: { ppid: 201, vmRssKb: 25 },
    });
    expect(computeProcessTreeRssBytes(fs)).toBe((100 + 50 + 25) * 1024);
  });

  it('非后代进程不计入（他进程子树隔离——ppid 链不达 root 即排除）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 100 },
      999: { ppid: 1, vmRssKb: 777 },
      998: { ppid: 999, vmRssKb: 888 },
    });
    expect(computeProcessTreeRssBytes(fs)).toBe(100 * 1024);
  });

  it('单 pid 消失容忍跳过（child status 不可读⇒其余求和不炸——procfs 竞态面）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 1000 },
      201: { ppid: 100, vmRssKb: undefined },   // status 无 VmRSS（消失/僵尸档）
      202: { ppid: 100, vmRssKb: 250 },
    });
    expect(computeProcessTreeRssBytes(fs)).toBe((1000 + 250) * 1024);
  });

  it('stat 不可读 pid 不进父子映射但不炸（其子树 ppid 未知不计——容忍跳过）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 1000 },
      201: { ppid: 100, vmRssKb: 300, statMissing: true },
      301: { ppid: 201, vmRssKb: 999 },
    });
    // 201 stat 缺失⇒ppid 未知⇒201/301 均不入树（301 的父 201 不在树内）
    expect(computeProcessTreeRssBytes(fs)).toBe(1000 * 1024);
  });

  it('comm 含空格括号仍正确解析 ppid（/proc/<pid>/stat 第 4 字段——末位 ")" 后解析口径）', () => {
    const fs = fakeFs({
      100: { ppid: 1, vmRssKb: 1000 },
      201: { statRaw: '201 (ffmpeg (x) -enc od) R 100 201 201 0 -1 4194560', vmRssKb: 400 },
    });
    expect(computeProcessTreeRssBytes(fs)).toBe((1000 + 400) * 1024);
  });

  it('整体失败 ⇒ null（listPids 抛——采集失败不上报不给假数 Z117①）', () => {
    expect(computeProcessTreeRssBytes(fakeFs({}, { listThrows: true }))).toBeNull();
  });
});
