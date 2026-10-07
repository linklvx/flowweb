// apps/api/scripts/collab-spool-quarantine.ts —— Y0a-2 逃生阀（spec §2.2 v2.4：quarantine=sidecar 标记
// 不搬字节，段内移帧物理不可行；本脚本是唯一删段路径，人工可审计）。
// **先停 gateway 再执行 --delete**（活实例上删除=TOCTOU+内存 index 陈旧——dry-run 可随时跑）。
// 运行：COLLAB_SPOOL_DIR=... pnpm --filter @flowweb/api exec tsx scripts/collab-spool-quarantine.ts <projectId|--all> --dry-run
//       判定后：同命令 --delete --yes-i-understand（不可逆；先 --dry-run 审阅将被删除的字节数）
import { readdir, readFile, unlink } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { join, resolve } from 'node:path';
import * as Y from 'yjs';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0];
  const dryRun = args.includes('--dry-run');
  const del = args.includes('--delete');
  const confirmed = args.includes('--yes-i-understand');
  if (!target || (!dryRun && !del)) {
    console.error('usage: tsx scripts/collab-spool-quarantine.ts <projectId|--all> (--dry-run | --delete --yes-i-understand)');
    console.error('  **先停 gateway 再执行 --delete**（活实例上删除=TOCTOU+内存 index 陈旧——dry-run 可随时跑）');
    console.error('  --dry-run            打印段字节区间+好帧摘要（人工判定）');
    console.error('  --delete             判定后删段（唯一允许删段的路径——不可逆）');
    console.error('  --yes-i-understand   --delete 的二次确认（缺则拒绝执行）');
    process.exit(1);
  }
  if (dryRun && del) {
    console.error('拒绝：--dry-run 与 --delete 互斥（先 --dry-run 审阅；判定后 --delete --yes-i-understand）');
    process.exit(1);
  }
  if (del && !confirmed) {
    console.error('拒绝：--delete 不可逆，需追加 --yes-i-understand（先 --dry-run 审阅将被删除的字节数）');
    process.exit(1);
  }
  const dir = resolve(process.env.COLLAB_SPOOL_DIR ?? join(process.cwd(), '.data', 'collab-spool'));
  let totalDeleteBytes = 0;
  let deleteCount = 0;
  let seen = 0;
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.spool') && !x.startsWith('__probe__')).sort()) {   // Y6：探针段过滤
    const projectId = f.split('.').slice(0, -2).join('.');
    if (target !== '--all' && projectId !== target) continue;
    seen += 1;
    const buf = await readFile(join(dir, f));
    // sidecar 区间（V3 字节口径——与隔离处置同源）
    let quarantinedFromOffset: number | null = null;
    const sidecar = await readFile(join(dir, `${f}.quarantine`), 'utf8')
      .then((t) => t.trim().split('\n').filter(Boolean))
      .catch(() => [] as string[]);
    const last = sidecar[sidecar.length - 1];
    if (last) {
      try { quarantinedFromOffset = JSON.parse(last).quarantinedFromOffset ?? null; } catch { /* 行残缺——按无 sidecar 处理 */ }
    }
    // 帧解析：好帧摘要（节点/边数——人工判定"这段值不值得救"）+首坏偏移（无 sidecar 时现场判定）
    let off = 0, idx = 0, firstBad = -1;
    const goodLines: string[] = [];
    while (off + 8 <= buf.byteLength) {
      const len = buf.readUInt32LE(off);
      if (off + 8 + len > buf.byteLength) { firstBad = off; break; }
      const payload = buf.subarray(off + 8, off + 8 + len);
      if ((crc32(payload) >>> 0) !== buf.readUInt32LE(off + 4)) { firstBad = off; break; }
      const doc = new Y.Doc();
      try { Y.applyUpdate(doc, payload); } catch { /* 摘要尽力而为 */ }
      goodLines.push(`  好 ${idx} @${off}: ${len}B, nodes=${doc.getMap('nodes').size}, edges=${doc.getMap('edges').size}`);
      off += 8 + len;
      idx += 1;
    }
    if (firstBad < 0 && off !== buf.byteLength) firstBad = off;   // 1-7B 残尾同 scan 口径——坏尾必有可观测面
    const badFrom = quarantinedFromOffset ?? (firstBad >= 0 ? firstBad : null);
    const quarantinedBytes = badFrom != null ? buf.byteLength - badFrom : 0;
    console.log(`\n=== ${f} (${buf.byteLength}B) ===`);
    console.log(goodLines.slice(-8).join('\n') || '  （无好帧）');   // 尾部 8 帧（近期编辑——判定主依据）
    if (goodLines.length > 8) console.log(`  …共 ${goodLines.length} 好帧`);
    if (badFrom != null) {
      console.log(`  隔离区间: @${badFrom}→EOF（${quarantinedBytes}B 含坏帧头）${quarantinedFromOffset != null ? '〔sidecar 已记〕' : '〔sidecar 未记——现场解析判定〕'}`);
    } else {
      console.log('  段尾干净（无隔离区间）');
    }
    totalDeleteBytes += buf.byteLength;   // --delete 删整段文件（unlink）——dry-run 合计同口径=全段字节
    deleteCount += 1;
    if (del) {
      await unlink(join(dir, f));
      await unlink(join(dir, `${f}.quarantine`)).catch(() => {});
      console.log(`  → 已删除（${buf.byteLength}B）`);
    } else {
      console.log('  → dry-run（--delete --yes-i-understand 才删）');
    }
  }
  if (seen === 0) console.log('无匹配段（目录为空或目标项目无段文件）');
  if (del) console.log(`\n共删除 ${deleteCount} 段 / ${totalDeleteBytes}B`);
  if (dryRun && seen > 0) console.log(`\n将删除合计 ${deleteCount} 段 / ${totalDeleteBytes}B（--delete --yes-i-understand 执行）`);
}

void main().catch((e) => { console.error(e); process.exitCode = 1; });   // 退出码契约自包含（collab-compact 同款）
