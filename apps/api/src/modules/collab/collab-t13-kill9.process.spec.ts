// apps/api/src/modules/collab/collab-t13-kill9.process.spec.ts
// Y1c T13（G6a）：kill -9 演练——**真子进程形态**（spawn+SIGKILL——纪律：不得只 mock「模拟崩溃」）。
// 子进程=纯 node fs 写手（stdin JSON 指令：段字节 base64+分阶段信号+挂起窗），父进程在物理写入
// 时序点发 SIGKILL（write 后 sync 前/sync 后/撕裂尾半写），随后对同一磁盘目录跑真 recoverScan
// （ADR-01 §3 恢复顺序）断言帧前缀恢复/截断裁定/续号无洞——证明进程死亡后磁盘字节的真实恢复语义
// （进程内 seam 形态见 collab-t10-g2.int.spec；本套件=崩溃物理性的实弹补充——T8 spec 进程级测试
// 先例的 spawn+signal 等价形态）。
import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CollabSpoolService, encodeWalSegmentBytes, walSegmentFileName } from './collab-spool.service';
import { makeSpoolDir } from '../../test-utils/spool-dir';
import { WAL_SEGMENT_HEADER_SIZE, WAL_FRAME_FIXED_BYTES, type WalSegmentHeader, type WalFrameFixtureInput } from '@flowweb/shared';

const HISTORY = 'kill9-history';
const OWNER = 'kill9-owner';

/** 子进程脚本（纯 node 零依赖）：stdin 收 JSON 指令→写段文件（可半写/可 sync）→stdout 信号→挂起等 kill。
 *  信号协议：WROTE=全部文件已落（含指令内 sync）；HOLDING=进入挂起窗（父进程此刻 SIGKILL）。 */
const CHILD_SCRIPT = `
const fs = require('node:fs/promises');
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', async () => {
  try {
    const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    for (const f of job.files) {
      await fs.mkdir(require('node:path').dirname(f.path), { recursive: true });
      const buf = Buffer.from(f.b64, 'base64');
      const fh = await fs.open(f.path, 'w');
      const n = f.writeBytes == null ? buf.length : Math.min(f.writeBytes, buf.length);
      await fh.write(buf, 0, n, 0);
      if (f.sync !== false) await fh.sync();
      await fh.close();
    }
    process.stdout.write('WROTE\\n');
    if (job.hold) { process.stdout.write('HOLDING\\n'); setInterval(() => {}, 1000); }
    else process.exit(0);
  } catch (e) { process.stdout.write('CHILD_ERR ' + e.message + '\\n'); process.exit(1); }
});
`;

/** 跑子进程到指定信号点后 SIGKILL（真进程崩溃——非 mock）。 */
async function runUntilKilled(job: unknown, signal: 'WROTE' | 'HOLDING'): Promise<void> {
  const child: ChildProcess = spawn(process.execPath, ['-e', CHILD_SCRIPT], { stdio: ['pipe', 'pipe', 'inherit'] });
  const got = new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString('utf8');
      if (out.includes(signal)) resolve();
      if (out.includes('CHILD_ERR')) reject(new Error(out));
    });
    child.on('exit', (code) => { if (!out.includes(signal)) reject(new Error(`child exited early code=${code} out=${out}`)); });
  });
  child.stdin!.write(JSON.stringify(job));
  child.stdin!.end();
  await got;
  child.kill('SIGKILL');   // 真 kill -9（Windows TerminateProcess 等价）
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
}

function headerOf(pid: string, gen = 1): WalSegmentHeader {
  return { projectId: pid, generation: gen, historyId: HISTORY, createdAtMs: Date.now(), lastWriteAtMs: Date.now() };
}

function framesOf(n: number): WalFrameFixtureInput[] {
  return Array.from({ length: n }, (_, i) => ({ walSeq: BigInt(i + 1), generation: 1, payload: new Uint8Array([0x61 + i, i, 0x42]) }));
}

const sysHist = { historyId: HISTORY, epochStartedAtMs: Date.now() - 3_600_000 };
const pgSeqOf = () => 0n;

describe('Y1c T13 G6a：kill -9 真子进程演练（spawn+SIGKILL——ADR-01 §3 恢复顺序实弹）', () => {
  it('P1 fsync 后 kill：子进程完整写段+fsync→SIGKILL→recoverScan 全帧恢复（进程死亡后磁盘字节存活）', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-p1-');
    try {
      const bytes = encodeWalSegmentBytes(headerOf('p-kill1'), framesOf(3));
      const path = join(dir, OWNER, walSegmentFileName('p-kill1', 1, 0));
      await runUntilKilled({ files: [{ path, b64: bytes.toString('base64'), sync: true }], hold: true }, 'HOLDING');
      // 「重启」=新服务实例对同一目录恢复扫描
      const s = new CollabSpoolService(dir);
      s.setOwner(OWNER);
      const report = await s.recoverScan({ systemHistory: sysHist, pgSeq: pgSeqOf });
      expect(report.projects[0]!.replayPrefix, 'fsync 完成帧全数恢复').toEqual([1n, 2n, 3n]);
      const frames = await s.peek('p-kill1');
      expect(frames.map((f) => f.walSeq)).toEqual([1n, 2n, 3n]);
      expect(s.peekNextWalSeq('p-kill1'), '续号承接（无洞）').toBe(4n);
      expect(report.projects[0]!.pgPrefixViolation, '零 violation（正常崩溃恢复）').toHaveLength(0);
    } finally { await cleanup(); }
  }, 20_000);

  it('P2 撕裂尾：子进程只写段字节前半（write 后未完成）→SIGKILL→recoverScan 判 truncated→完整前缀保留+截断裁定+续号无洞', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-p2-');
    try {
      const bytes = encodeWalSegmentBytes(headerOf('p-kill2'), framesOf(3));
      // 物理撕裂点=段头+帧 1 完整（52B 头+3B 载荷）+帧 2 前 20B——帧 1 完整保留、帧 2/3 撕裂
      const half = WAL_SEGMENT_HEADER_SIZE + (WAL_FRAME_FIXED_BYTES + 3) + 20;
      const path = join(dir, OWNER, walSegmentFileName('p-kill2', 1, 0));
      await runUntilKilled({ files: [{ path, b64: bytes.toString('base64'), writeBytes: half, sync: false }], hold: true }, 'HOLDING');
      const s = new CollabSpoolService(dir);
      s.setOwner(OWNER);
      const report = await s.recoverScan({ systemHistory: sysHist, pgSeq: pgSeqOf });
      // 撕裂尾=帧级 fatal truncated→丢的全是 walSeq>pgSeq=0 的帧→完整有效前缀截断续跑（ADR-01 §3.2）
      expect(report.projects[0]!.replayPrefix, '撕裂前完整帧保留（帧 1）').toEqual([1n]);
      expect(report.projects[0]!.pgPrefixViolation, '零 violation（丢帧全为未承诺 Durable 档）').toHaveLength(0);
      const frames = await s.peek('p-kill2');
      expect(frames.length, '可重放前缀=完整帧').toBe(report.projects[0]!.replayPrefix.length);
      const seqs = frames.map((f) => f.walSeq);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i], '前缀密集无洞').toBe(seqs[i - 1]! + 1n);
      expect(s.peekNextWalSeq('p-kill2'), '续号=前缀尾+1（截断复用不跳号）').toBe(seqs[seqs.length - 1]! + 1n);
    } finally { await cleanup(); }
  }, 20_000);

  it('P3 多项目（S4 决策落地验证）：子进程写 3 项目段→SIGKILL→recoverScan per-project 前缀正确互不干扰', async () => {
    const { dir, cleanup } = await makeSpoolDir('y1c-t13-p3-');
    try {
      const files = ['p-a', 'p-b', 'p-c'].map((pid) => ({
        path: join(dir, OWNER, walSegmentFileName(pid, 1, 0)),
        b64: encodeWalSegmentBytes(headerOf(pid), framesOf(2)).toString('base64'),
        sync: true,
      }));
      await runUntilKilled({ files, hold: true }, 'HOLDING');
      const s = new CollabSpoolService(dir);
      s.setOwner(OWNER);
      const report = await s.recoverScan({ systemHistory: sysHist, pgSeq: pgSeqOf });
      const byPid = new Map(report.projects.map((p) => [p.projectId, p]));
      for (const pid of ['p-a', 'p-b', 'p-c']) {
        expect(byPid.get(pid)?.replayPrefix, `${pid} 前缀独立恢复`).toEqual([1n, 2n]);
        expect((await s.peek(pid)).map((f) => f.walSeq)).toEqual([1n, 2n]);
        expect(s.peekNextWalSeq(pid), `${pid} 续号承接`).toBe(3n);
      }
      // 水位三元重建（appliedSeq=spoolHeadSeq=链尾；pgSeq=0）
      for (const pid of ['p-a', 'p-b', 'p-c']) {
        const w = s.watermark(pid)!;
        expect({ pgSeq: w.pgSeq, appliedSeq: w.appliedSeq, spoolHeadSeq: w.spoolHeadSeq }).toEqual({ pgSeq: 0n, appliedSeq: 2n, spoolHeadSeq: 2n });
      }
    } finally { await cleanup(); }
  }, 20_000);
});
