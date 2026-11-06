// apps/api/src/modules/collab/project-erasure.manifest.ts
// C4-b（plan Task C4-2——生产就绪收尾批·project-erasure）：erasure manifest=**唯一采集面**（DRAINING
// 首步写——R16 主载体=data-dir 外部绝对路径文件，DB 行只作索引〔manifestPath/manifestSha256〕）。
// **worker 后续 detach/删除只从 manifest 读**（介质执行 saga 归 C4-c——本模块=采集+落盘+读取面）。
//
// 形态（spec R16/plan v3.1 ⑥ manifest-before-detach）：
//  - NDJSON 分片：每 10k 数据行一 shard，片尾随 shard 行（该片数据行 SHA-256——局部完整性可独立
//    校验）；末行 footer=全先行行（header 起）SHA-256（DB 索引列 manifestSha256 同值——
//    restore-reerase 重放前置校验归 C4-c）；
//  - 行段：header（erasureId/scope/projectIds/requestedAt/schemaVersion）→media 行（id/bucket/key/
//    thumbnailKey/objectKey/size——BigInt 恒十进制字符串纪律）→work 行（id/canvasProjectId/videoKey/
//    coverKey）→spool 行（projectId/dir/name）→redis 行（workIds+urlKeys 派生键清单——C4-c
//    purgeWorkCaches 消费）→footer；
//  - 落盘协议：temp→fsync(file)→rename→fsync(dir)（崩溃窗=.tmp 残留——恢复重写幂等覆盖）。
//
// 双失诚实披露（R16）：DB restore（旧备份）时 DB 无擦除行但外部 manifest 文件在=恢复重放锚；
// 两者皆失=恢复脚本 RESIDUAL_RISK（restore-reerase 归 C4-c——不声称零残留）。
import { createHash, type Hash, randomUUID } from 'node:crypto';
import { open, mkdir, rename } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { listSpoolFiles, parseSegFileName } from './collab-spool.service';

/** manifest 格式版本（行形态演进一步一跳——restore-reerase 按此分派）。 */
export const ERASURE_MANIFEST_SCHEMA_VERSION = 1;
/** 每 shard 数据行数（10k——分片粒度=局部 SHA 校验/流式重放单元）。 */
export const MANIFEST_SHARD_ROWS = 10_000;

/** manifest 目录（R16：data-dir 外部绝对路径主载体；显式相对路径=启动拒——COLLAB_SPOOL_DIR 同律）。 */
export function erasureManifestDir(): string {
  const configured = process.env.ERASURE_MANIFEST_DIR;
  if (configured) {
    if (!isAbsolute(configured)) {
      throw new Error(`ERASURE_MANIFEST_DIR 必须为绝对路径（当前：${configured}——CWD 漂移会静默指向另一个目录，manifest=恢复重放锚不容失锚）`);
    }
    return configured;
  }
  return join(process.cwd(), '.data', 'erasure-manifest');
}

/**
 * manifest 采集面（DRAINING 排干临界区内收集）。
 * **冻结域诚实注记（spec 评审 P1——C4-b 勘正）**：行集冻结对 **Canvas 族**成立（fence 已拒
 * appendBatch/admit/claim 等全部 Canvas 维写者）；**Media/VideoWork 不成立**——在飞生成
 * （claim 先于 tombstone 运行数分钟）的 registerInTx 在 finalize 事务内建 Media 行
 * （artifact-commit.service.ts:288/:312）可在采集**后**落新行+新 S3 键；admin updateWork
 * coverKey 换绑同窗。DB 行有 scope 批删兜底，但 **manifest=介质（S3 对象/Redis url 键）唯一
 * 采集面 ⇒ 采集后 finalize 的对象/键泄漏**。契约（C4-c 派发词承接）：PURGING_DB 前置位须
 * **重扫合并**（DRAINING→PURGING_DB 前二扫取并集）**或 DRAINING 前等待在飞 intent 清算**——
 * 二择一归 C4-c 定形；本批=DRAINING stage 骨架+采集面先行（poller PURGING_DB 前置位注释同钉）。
 */
export interface ErasureManifestInputs {
  erasureId: string;
  scopeType: 'project' | 'team';
  scopeId: string;
  projectIds: string[];
  requestedAt: Date;
  mediaRows: { id: string; bucket: string; key: string; thumbnailKey: string | null; objectKey: string | null; size: bigint }[];
  workRows: { id: string; canvasProjectId: string | null; videoKey: string; coverKey: string | null }[];
  /** spool 段（collectSpoolSegments 产出——dir/name 绝对路径形态）。 */
  spoolSegs: { projectId: string; dir: string; name: string }[];
}

/** header 行（首行）。 */
export interface ManifestHeader {
  type: 'erasure-manifest';
  schemaVersion: number;
  erasureId: string;
  scopeType: string;
  scopeId: string;
  projectIds: string[];
  requestedAt: string;
  generatedAt: string;
}

/** footer 行（末行——sha256=全先行行（header 起含 shard 行）逐行拼接哈希）。 */
export interface ManifestFooter {
  type: 'erasure-manifest-footer';
  sha256: string;
  rows: { media: number; work: number; spool: number; shard: number };
}

/** manifest 读取视图（C4-c 介质 saga/测试消费——readErasureManifest 解析产物）。 */
export interface ErasureManifest {
  header: ManifestHeader;
  media: { id: string; bucket: string; key: string; thumbnailKey: string | null; objectKey: string | null; size: bigint }[];
  work: { id: string; canvasProjectId: string | null; videoKey: string; coverKey: string | null }[];
  spool: { projectId: string; dir: string; name: string }[];
  redis: { workIds: string[]; urlKeys: string[] };
  footer: ManifestFooter;
}

/** 派生 Redis 键清单（manifest redis 行——C4-c purgeWorkCaches/URL 键删除消费面）：
 *  workIds=SCAN 族键首段（`videoWork:process:{workId}:*` 全前缀——R18 workId 映射）；
 *  urlKeys=可具体枚举键（`videoWork:url:{key}`——Media.key/thumbnailKey/objectKey+VideoWork.videoKey/coverKey）。 */
export function deriveRedisKeys(inputs: Pick<ErasureManifestInputs, 'mediaRows' | 'workRows'>): { workIds: string[]; urlKeys: string[] } {
  const workIds = inputs.workRows.map((w) => w.id);
  const urlKeys = [
    ...inputs.workRows.flatMap((w) => [w.videoKey, w.coverKey]),
    ...inputs.mediaRows.flatMap((m) => [m.key, m.thumbnailKey, m.objectKey]),
  ].filter((k): k is string => typeof k === 'string' && k.length > 0)
    .map((k) => `videoWork:url:${k}`);
  return { workIds: [...new Set(workIds)], urlKeys: [...new Set(urlKeys)] };
}

/** spool 段采集（listSpoolFiles R3 单源枚举+parseSegFileName 归属过滤——目录缺失=空集非错）。 */
export async function collectSpoolSegments(spoolDir: string, projectIds: readonly string[]): Promise<{ projectId: string; dir: string; name: string }[]> {
  const wanted = new Set(projectIds);
  try {
    return (await listSpoolFiles(spoolDir))
      .map((f) => ({ f, parsed: parseSegFileName(f.name) }))
      .filter((x) => x.parsed != null && wanted.has(x.parsed.projectId))
      .map((x) => ({ projectId: x.parsed!.projectId, dir: x.f.dir, name: x.f.name }));
  } catch (e) {
    // 目录缺失（ENOENT）=零段（擦除域幂等）；其余 IO 错误（权限/磁盘）warn 留痕折零段——
    // spool 文件泄漏由 C4-c PURGING_DB 前重扫契约兜底（质量评审 Minor#8：静默折空=泄漏无痕）
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(JSON.stringify({ event: 'erasure-manifest-spool-scan-failed', dir: spoolDir, code: (e as NodeJS.ErrnoException).code, message: (e as Error).message }));
    }
    return [];
  }
}

/** NDJSON 行写出器（file 全量哈希+shard 局部哈希双喂——行 JSON 紧凑单行）。 */
class ManifestWriter {
  private readonly fileHash = createHash('sha256');
  private shardHash: Hash = createHash('sha256');
  private shardCount = 0;
  private shardIndex = 0;
  constructor(private readonly fh: { write: (s: string) => Promise<unknown> }) {}

  private async line(obj: Record<string, unknown>, feedShard: boolean): Promise<void> {
    const l = `${JSON.stringify(obj)}\n`;
    await this.fh.write(l);
    this.fileHash.update(l);
    if (feedShard) this.shardHash.update(l);
  }

  /** 数据行（进 shard 哈希/计数；满 10k 自动 flush shard 行）。 */
  async dataRow(obj: Record<string, unknown>): Promise<void> {
    await this.line(obj, true);
    this.shardCount += 1;
    if (this.shardCount >= MANIFEST_SHARD_ROWS) await this.flushShard();
  }

  private async flushShard(): Promise<void> {
    if (this.shardCount === 0) return;
    await this.line({ type: 'erasure-manifest-shard', index: this.shardIndex, rows: this.shardCount, sha256: this.shardHash.digest('hex') }, false);
    this.shardHash = createHash('sha256');
    this.shardCount = 0;
    this.shardIndex += 1;
  }

  /** 结构行（header/redis——不进 shard 哈希）。 */
  async metaRow(obj: Record<string, unknown>): Promise<void> { await this.line(obj, false); }

  /** footer（先 flush 尾 shard）——sha256=全先行行（footer 自身不入哈希——读侧复算同口径）。 */
  async footer(rows: ManifestFooter['rows']): Promise<{ footer: ManifestFooter; fileSha256: string }> {
    await this.flushShard();
    const fileSha256 = this.fileHash.copy().digest('hex');   // copy 先摘值——footer 行本身照常入全量哈希链（后续写入无害）
    const footer: ManifestFooter = { type: 'erasure-manifest-footer', sha256: fileSha256, rows: { ...rows, shard: this.shardIndex } };
    await this.line(footer as unknown as Record<string, unknown>, false);
    return { footer, fileSha256 };
  }
}

/** manifest 落盘（temp→fsync(file)→rename→fsync(dir)）。返回 { manifestPath, manifestSha256, rows }。
 *  幂等：同 erasureId 重写=覆盖（kill -9 于 rename 前的重跑窗——.tmp 残留随下次 open('w') 截断）。 */
export async function writeErasureManifest(inputs: ErasureManifestInputs, dir = erasureManifestDir()): Promise<{ manifestPath: string; manifestSha256: string; rows: ManifestFooter['rows'] }> {
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, `${inputs.erasureId}.ndjson`);
  // 随机后缀（质量评审 Minor#6）：多实例租约过期重叠时两写者同 path '.tmp' 交错可发布损坏文件——
  // pid+random 隔离写者（读侧 SHA 复算仍兜底）；残留 .tmp 归 run 目录周期清理（C4-c）
  const tmpPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  const fh = await open(tmpPath, 'w');
  let footer: ManifestFooter;
  let fileSha256: string;
  const rows: ManifestFooter['rows'] = { media: 0, work: 0, spool: 0, shard: 0 };
  try {
    const w = new ManifestWriter(fh);
    await w.metaRow({
      type: 'erasure-manifest', schemaVersion: ERASURE_MANIFEST_SCHEMA_VERSION,
      erasureId: inputs.erasureId, scopeType: inputs.scopeType, scopeId: inputs.scopeId,
      projectIds: inputs.projectIds, requestedAt: inputs.requestedAt.toISOString(),
      generatedAt: new Date().toISOString(),
    });
    for (const m of inputs.mediaRows) {
      await w.dataRow({ section: 'media', id: m.id, bucket: m.bucket, key: m.key, thumbnailKey: m.thumbnailKey, objectKey: m.objectKey, size: m.size.toString() });
      rows.media += 1;
    }
    for (const wk of inputs.workRows) {
      await w.dataRow({ section: 'work', id: wk.id, canvasProjectId: wk.canvasProjectId, videoKey: wk.videoKey, coverKey: wk.coverKey });
      rows.work += 1;
    }
    for (const s of inputs.spoolSegs) {
      await w.dataRow({ section: 'spool', projectId: s.projectId, dir: s.dir, name: s.name });
      rows.spool += 1;
    }
    await w.metaRow({ section: 'redis', ...deriveRedisKeys(inputs) });
    ({ footer: footer!, fileSha256: fileSha256! } = await w.footer(rows));
    await fh.sync();   // fsync(file)——rename 前数据先落盘
  } finally {
    await fh.close().catch(() => undefined);
  }
  await rename(tmpPath, manifestPath);
  // fsync(dir)——rename 目录项落盘（目录句柄 fsync——Windows best-effort）
  const dh = await open(dir, 'r').catch(() => null);
  if (dh) { await dh.sync().catch(() => undefined); await dh.close().catch(() => undefined); }
  return { manifestPath, manifestSha256: fileSha256, rows: footer.rows };
}

/** manifest 读取（C4-c 介质 saga/红⑧a 消费——footer.sha256 复算不等=诚实披露抛错）。 */
export async function readErasureManifest(manifestPath: string): Promise<ErasureManifest> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(manifestPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (lines.length < 3) throw new Error(`manifest 形态违规（行数 ${lines.length}<3）: ${manifestPath}`);
  const header = JSON.parse(lines[0]!) as ManifestHeader;
  if (header.type !== 'erasure-manifest') throw new Error(`manifest 首行非 header: ${manifestPath}`);
  const footer = JSON.parse(lines[lines.length - 1]!) as ManifestFooter;
  if (footer.type !== 'erasure-manifest-footer') throw new Error(`manifest 末行非 footer: ${manifestPath}`);
  const hash = createHash('sha256');
  for (const l of lines.slice(0, -1)) hash.update(`${l}\n`);
  const recomputed = hash.digest('hex');
  if (recomputed !== footer.sha256) {
    throw new Error(`manifest footer SHA-256 复算不等（manifest 损坏——R16 诚实披露不假绿）: ${manifestPath}`);
  }
  const out: ErasureManifest = { header, media: [], work: [], spool: [], redis: { workIds: [], urlKeys: [] }, footer };
  for (const l of lines.slice(1, -1)) {
    const row = JSON.parse(l) as Record<string, unknown>;
    if (row.section === 'media') out.media.push({ id: String(row.id), bucket: String(row.bucket), key: String(row.key), thumbnailKey: typeof row.thumbnailKey === 'string' ? row.thumbnailKey : null, objectKey: typeof row.objectKey === 'string' ? row.objectKey : null, size: BigInt(row.size as string) });
    else if (row.section === 'work') out.work.push({ id: String(row.id), canvasProjectId: typeof row.canvasProjectId === 'string' ? row.canvasProjectId : null, videoKey: String(row.videoKey), coverKey: typeof row.coverKey === 'string' ? row.coverKey : null });
    else if (row.section === 'spool') out.spool.push({ projectId: String(row.projectId), dir: String(row.dir), name: String(row.name) });
    else if (row.section === 'redis') out.redis = { workIds: (row.workIds as string[]) ?? [], urlKeys: (row.urlKeys as string[]) ?? [] };
    // shard 行=校验结构（footer 全量哈希已覆盖——读取面不复算局部片）
  }
  return out;
}
