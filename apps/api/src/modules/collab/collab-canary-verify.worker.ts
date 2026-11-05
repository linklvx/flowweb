// apps/api/src/modules/collab/collab-canary-verify.worker.ts
// C2-2b（plan Task C2-2 比对侧——生产就绪收尾批，spec v5 §3 C2）：replay canary worker verify
// DB poller（**worker 进程**——RetentionSweeperPoller/CollabAppendAuditWorker 同款「OnModuleInit+
// 原生 setInterval unref」形态；重放/hash 移出 api 事件循环〔spec §6 R2 部分采纳面〕——api 只承担
// 有界捕获〔C2-2a〕，重放比对归 worker）。每 tick 管线（单 pin）：
//  ①pin 选择（READY∧expiresAt>now 批读+lifecycle/maintenanceId/docGeneration 随读）+**TTL 续租**
//    （leaseUntil=now()+TTL——pin 选择批单语句延，verify 在途可观测）；
//  ②skip 链：lifecycleState!='ACTIVE'→skip-lifecycle（擦除窗——红⑦）；maintenanceId 在→
//    skip-maintenance（维护窗 DB 行级面——worker 进程无 CollabMaintenanceService 进程内 freeze 面，
//    DB 面 REQUESTED 起覆盖+pin TTL 15min 上界窗）；换代（docGeneration≠pin.generation）→
//    skip-generation+**cursor generation 重置**（旧代行已整删——readAt 折空=假阳性根除）；
//    pin.hashVersion≠当前版→skip-stale-pin（hashVersion 演进不误报——红⑦：旧版口径的 hash 不比对，
//    档=skip 非 mismatch）；
//  ③readAt（快照 PK+增量区间 (stateSeq, pgSeqAt]——pin 坐标锚定：捕获后新帧 pgSeqAt>坐标不入重放面
//    〔红⑦〕）→replayPgSnapshot（快照 state+增量帧重放进 fresh Y.Doc）：pin.snapshotRev≠0∧快照行缺/
//    水位漂移→skip-prune（pin 过期窗 prune 竞态——skip_retry 不误报）；fresh doc pendingStructs!==null
//    →skip-prune（重放帧不完整=缺 struct 引用——删行注入形态同判先于比对拦截）；重放预算超时→
//    skip-budget（大 doc 重放不阻塞 tick——不误报）；
//  ④hash 主判（fresh doc 重算 hash——与捕获同 canonical 口径：encodeCanonicalUpdate+seedStateHash
//    单源〔collab-replay-canary.service〕）；相等→ok；
//  ⑤语义兜底（hash 不等/hashSkipped 档）：**SV 互支判定**（捕获 SV vs 重放 SV 点对点等——同 op 集
//    ⇒ Yjs 确定性 ⇒ 逻辑态必等〔构造实证：同帧集不同应用序 encodeStateAsUpdate 恒等〕；活 doc 不可
//    跨进程，语义比对以 op 集等价为判据）：互支成立→hash-encoding-mismatch（计数不 freeze——
//    spec「语义相等=hash_encoding_mismatch」）/hashSkipped 档 semantic-equal；互支失败→
//    **mismatch→freeze 实弹**（CANARY_FREEZE_ENABLED 生产默认 true——plan v3.1 ⑪ 翻转：charter
//    「不一致告警并冻结」；shadow 只 dev 显式 'false'=只告警+计数不 freeze）+Sentry+结构化日志
//    （节点 canonical JSON 摘要=mismatch 报告面——runbook §14 分诊）；
//  ⑥compare-and-delete pin（DELETE WHERE projectId/pgSeqAt/snapshotRev 坐标谓词——TTL 过期后
//    新 pin 误删根除；skip-lifecycle/maintenance/prune/budget 档保 pin 重试）。
// 指标=collab-canary.metrics.ts 单源（source=worker 3002）；freeze 争用披露：freeze 调用=单 UPDATE
// 语句（gate 行级）非 withFrozenPrefix 临界区——**捕获侧冻结预算 500ms/项目（withFrozenPrefix
// gateBudgetMs 默认）+每项目 ~19h 低频（排程天然）**；runbook §14 处置序归 C2-3。
// 单飞形态：JS running 互斥（单实例 worker 部署——Minor#3 双实例登记同款）；双实例下 per-pin
// 幂等（freeze WHERE state='OPEN' 幂等+compare-and-delete 坐标守卫恰删一次，计数可能双计——登记）。
import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { createCanvasDoc } from './canvas-doc.factory';
import { captureCollabException } from '../../utils/sentry-scrub';
import { projectDocName } from './doc-name.util';
import { freezeOpsGateCompact } from './collab-ops-gate.service';
import { seedStateHash } from './canvas-doc-genesis';
import { encodeCanonicalUpdate, writeCanaryCursor, CANARY_PIN_TTL_MS, CANARY_HASH_VERSION, CANARY_HASH_MAX_BYTES } from './collab-replay-canary.service';
import {
  collabCanaryCheckedTotal, collabCanaryFreezeTotal, collabCanaryHashEncodingMismatchTotal, collabCanaryLastCheckAge,
} from './collab-canary.metrics';

/** tick 周期（env 可调——COMPACT_POLL/RETENTION_SWEEP 同族形态：值经 dotenv 先行在位、Number()||
 *  默认缺省档、消费面=worker 轮询周期非部署档位）。 */
export const CANARY_VERIFY_INTERVAL_MS = Number(process.env.CANARY_VERIFY_INTERVAL_MS) || 60_000;
/** 每 tick verify 上界（重放=CPU 密集——批上界保 tick 有界；捕获节奏 ~1/min 稳态远低于本界）。 */
const CANARY_VERIFY_BATCH = 8;
/** 单 pin 重放+比对预算（超时 skip-budget 不误报——大 doc 重放不阻塞 tick；pin TTL 15min 上界窗内重试）。 */
export const CANARY_VERIFY_BUDGET_MS = 10_000;
/** last_check_age gauge 维护面失败保持最后值（refreshOpsGateFrozenAgeGauge 同族——error 不回 0 掩盖）。 */
let lastKnownCheckAgeSeconds = 0;

/** verify 结果闭集（collab_canary_checked_total{result}——plan「verify 结果闭集」：
 *  ok=hash 主判相等 / mismatch=语义不等（hash 红∧SV 互支失败——freeze 面）/ semantic-equal=
 *  hashSkipped 档 SV 互支成立（语义判等）/ hash-encoding-mismatch=hash 红而 SV 互支成立
 *  （编码序差异不 freeze）/ skip-prune=pin 过期窗 prune 竞态（skip_retry）/ skip-generation=
 *  换代（cursor generation 重置）/ skip-maintenance=维护窗 / skip-lifecycle=擦除窗 /
 *  skip-stale-pin=hashVersion 演进 / skip-budget=重放预算超时 / error=verify 异常。 */
export type CanaryVerifyResult =
  | 'ok' | 'mismatch' | 'semantic-equal' | 'hash-encoding-mismatch'
  | 'skip-prune' | 'skip-generation' | 'skip-maintenance' | 'skip-lifecycle' | 'skip-stale-pin' | 'skip-budget' | 'error';

/** pin+doc 随读行（选择 SQL 投影——worker 侧 skip 链单读面）。 */
interface VerifyPinRow {
  projectId: string;
  pinGeneration: number;
  snapshotRev: bigint;
  stateSeq: bigint;
  pgSeqAt: bigint;
  contentHash: string | null;
  hashSkipped: boolean;
  hashVersion: number;
  stateVector: Buffer | null;
  inactive: boolean;
  maintenanceId: string | null;
  docGeneration: number | null;
}

/** 节点/边 canonical JSON 稳定序列化（语义比对/摘要面——Y 值域经 toJSON 先折 plain〔Y.Map/Y.YText
 *  递归转换+环切断〕；键排序+undefined 过滤；lighting.service stableStringify 同族形态）。 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const asToJSON = value as { toJSON?: () => unknown };
  if (typeof asToJSON.toJSON === 'function') return stableStringify(asToJSON.toJSON());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 语义相等判定（plan「decodeStateAsUpdate 两侧→节点/边 canonical JSON 深比」的工具面）：两 Y.Doc
 *  的 nodes/edges 两根 canonical JSON 深比。worker 侧比对判据=SV 互支（活 doc 不可跨进程——同 op 集
 *  ⇒逻辑态等价的确定性代理）；本谓词=两 doc 同在手的语义真值面（红⑥-a 两 doc 构造直证/api 侧可
 *  消费）——doc 生命周期归调用方（本函数不 destroy）。 */
export function semanticEqualDocs(a: Y.Doc, b: Y.Doc): boolean {
  const view = (d: Y.Doc): string => (['nodes', 'edges'] as const)
    .map((r) => `${r}:${stableStringify(Object.fromEntries(d.getMap(r).entries()))}`)
    .join('|');
  return view(a) === view(b);
}

/** 重放语义摘要（mismatch 结构化报告面——nodes 根 canonical JSON 的 SHA-256 前 16 hex，分诊比对用）。 */
export function semanticViewDigest(doc: Y.Doc): string {
  return createHash('sha256').update(stableStringify(Object.fromEntries(doc.getMap('nodes').entries()))).digest('hex').slice(0, 16);
}

/** SV 互支判定（捕获 SV vs 重放 SV——同 op 集=两侧互含：decodeStateVector 点对点 client→clock
 *  全等）。同 op 集 ⇒ Yjs 确定性 ⇒ 逻辑态必等（构造实证：同帧集不同应用序 encodeStateAsUpdate
 *  恒等）；互支失败=重放缺 op（删行）/payload 改携异 client clock（红⑥-b）⇒ mismatch。 */
export function svMutuallySupported(captureSv: Buffer, replayDoc: Y.Doc): boolean {
  const a = Y.decodeStateVector(new Uint8Array(captureSv));
  const b = Y.decodeStateVector(Y.encodeStateVector(replayDoc));
  const clients = new Set([...a.keys(), ...b.keys()]);
  for (const c of clients) {
    if ((a.get(c) ?? 0) !== (b.get(c) ?? 0)) return false;
  }
  return true;
}

/** 快照 state+增量帧重放进 fresh Y.Doc（readAt 输出消费面——compact ② 前缀重放同形：state 先铺
 *  增量按序追加；genesis/懒建档折空形态 state=null 全量重放）。预算超时 throw（调用方折 skip-budget）。 */
export function replayPgSnapshot(state: Buffer | null, updates: readonly Buffer[], budgetMs: number): Y.Doc {
  const doc = createCanvasDoc();
  const deadline = Date.now() + budgetMs;
  if (state != null) Y.applyUpdate(doc, new Uint8Array(state));
  for (let i = 0; i < updates.length; i++) {
    Y.applyUpdate(doc, new Uint8Array(updates[i]));
    if ((i & 63) === 63 && Date.now() > deadline) {   // 每 64 帧查预算（重放 CPU 密集——tick 有界）
      doc.destroy();
      throw new Error(`replay budget exceeded (${budgetMs}ms at row ${i + 1}/${updates.length})`);
    }
  }
  return doc;
}

@Injectable()
export class CollabCanaryVerifyWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CollabCanaryVerifyWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 单飞互斥（setInterval 漏 tick 防叠跑）。 */
  private running = false;
  /** freeze 实弹开关（plan v3.1 ⑪：生产默认 true——charter「不一致告警并冻结」；shadow 只 dev 显式
   *  CANARY_FREEZE_ENABLED='false'=只告警+计数不 freeze。测试缝=实例直构覆写——红⑥-b 实弹演练面）。 */
  freezeEnabled = process.env.CANARY_FREEZE_ENABLED !== 'false';
  /** 项目宇宙测试隔离缝（C1-1 auditScope/c22a captureScope 同族——int 套件串行文件共享 dev 库）。 */
  verifyScope: readonly string[] | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
  ) {}

  /** boot 即跑首 tick（last_check_age gauge 在 3002 可服务前落定——append-audit boot 首 tick 同款）；
   *  失败不阻启动。 */
  async onModuleInit(): Promise<void> {
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, CANARY_VERIFY_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.verifyPins();
    } catch (e) {
      this.logger.error(`canary verify tick 失败: ${(e as Error).message}`);
    } finally {
      await this.refreshLastCheckAge().catch(() => undefined);   // 维护面每 tick（error 保持最后值）
      this.running = false;
    }
  }

  private async verifyPins(): Promise<void> {
    const scopeSql = this.verifyScope ? Prisma.sql` AND pin."projectId" = ANY(${this.verifyScope}::text[])` : Prisma.empty;
    const pins = await this.prisma.$queryRaw<VerifyPinRow[]>`
      SELECT pin."projectId", pin.generation AS "pinGeneration", pin."snapshotRev", pin."stateSeq", pin."pgSeqAt",
             pin."contentHash", pin."hashSkipped", pin."hashVersion", pin."stateVector",
             (p."lifecycleState" IS DISTINCT FROM 'ACTIVE') AS "inactive",
             d."maintenanceId", d.generation AS "docGeneration"
      FROM "CanaryPin" pin
      JOIN "CanvasProject" p ON p.id = pin."projectId"
      LEFT JOIN "CanvasDoc" d ON d."projectId" = pin."projectId"
      WHERE pin.status = 'READY' AND pin."expiresAt" > now()${scopeSql}
      LIMIT ${CANARY_VERIFY_BATCH}`;
    if (pins.length === 0) return;
    // TTL 续租（选择批单语句——leaseUntil=now()+TTL；verify 在途可观测，expired 面归 poller 清扫）
    await this.prisma.$executeRaw`
      UPDATE "CanaryPin" SET "leaseUntil" = now() + make_interval(secs => ${CANARY_PIN_TTL_MS / 1000})
      WHERE status = 'READY' AND "expiresAt" > now() AND "projectId" = ANY(${pins.map((p) => p.projectId)}::text[])`;
    for (const pin of pins) await this.verifyOne(pin);
  }

  private async verifyOne(pin: VerifyPinRow): Promise<void> {
    const pid = pin.projectId;
    // ② skip 链（红⑦ 维护/擦除窗+换代+hashVersion 演进）——pin 保档（TTL/换代承接）上方 return
    if (pin.inactive) {
      collabCanaryCheckedTotal.inc({ result: 'skip-lifecycle' });
      return;   // 擦除窗：pin 保（TTL 到期清扫承接——擦除项目 pin 无消费意义，不主动删）
    }
    if (pin.maintenanceId != null) {
      collabCanaryCheckedTotal.inc({ result: 'skip-maintenance' });
      return;   // 维护窗：pin 保重试（REBUILDING 换代完成后→换代档处置）
    }
    if (pin.docGeneration == null || pin.docGeneration !== pin.pinGeneration) {
      collabCanaryCheckedTotal.inc({ result: 'skip-generation' });
      // 换代：旧代增量行已整删（readAt 折空=假阳性根除）——stale pin 删+cursor generation 重置
      await this.deletePin(pin);
      await writeCanaryCursor(this.prisma, pid, pin.docGeneration ?? pin.pinGeneration, 'skip-generation', CANARY_VERIFY_INTERVAL_MS / 1000).catch(() => undefined);
      return;
    }
    if (pin.hashVersion !== CANARY_HASH_VERSION || pin.stateVector == null) {
      collabCanaryCheckedTotal.inc({ result: 'skip-stale-pin' });
      // 旧版 hash 口径不可比（红⑦ hashVersion 演进不误报）/捕获 ④ 遗漏 SV 的布景异常——重捕
      await this.deletePin(pin);
      await writeCanaryCursor(this.prisma, pid, pin.pinGeneration, 'skip-stale-pin', CANARY_VERIFY_INTERVAL_MS / 1000).catch(() => undefined);
      return;
    }
    // ③ readAt（pin 坐标锚定——捕获后新帧 pgSeqAt>坐标不入重放面）+重放
    let doc: Y.Doc;
    let canonical: Buffer | null;
    try {
      const read = await this.repo.readAt(pid, pin.pinGeneration, pin.snapshotRev, pin.pgSeqAt);
      if (pin.snapshotRev !== 0n && (read.state == null || read.stateSeq !== pin.stateSeq)) {
        // pinned 快照行缺/水位漂移=pin 过期窗 prune 竞态（skip_retry 不误报——存活谓词窗外的形态）
        collabCanaryCheckedTotal.inc({ result: 'skip-prune' });
        return;
      }
      doc = replayPgSnapshot(read.state, read.updates, CANARY_VERIFY_BUDGET_MS);
      if (doc.store.pendingStructs !== null) {
        // 重放帧不完整（缺 struct 引用）——删行注入/prune 竞态同判：先于比对拦截（skip_retry 不误报）
        doc.destroy();
        collabCanaryCheckedTotal.inc({ result: 'skip-prune' });
        return;
      }
      canonical = encodeCanonicalUpdate(doc, CANARY_HASH_MAX_BYTES);
    } catch (e) {
      if (/replay budget exceeded/.test((e as Error).message)) {
        collabCanaryCheckedTotal.inc({ result: 'skip-budget' });
        return;
      }
      collabCanaryCheckedTotal.inc({ result: 'error' });
      this.logger.warn(`canary verify readAt/重放失败 project=${pid}: ${(e as Error).message}`);
      return;
    }
    // ④hash 主判+⑤语义兜底（SV 互支）——判定与副作用（freeze/delete）分离
    let verdict: CanaryVerifyResult;
    if (pin.hashSkipped) {
      verdict = svMutuallySupported(pin.stateVector, doc) ? 'semantic-equal' : 'mismatch';
    } else if (pin.contentHash == null || canonical == null) {
      verdict = 'skip-stale-pin';   // 防御档：非 hashSkipped 而 contentHash 空/重放超尺寸=布景异常不比对
    } else {
      verdict = seedStateHash(canonical) === pin.contentHash
        ? 'ok'
        : (svMutuallySupported(pin.stateVector, doc) ? 'hash-encoding-mismatch' : 'mismatch');
    }
    collabCanaryCheckedTotal.inc({ result: verdict });
    if (verdict === 'hash-encoding-mismatch') collabCanaryHashEncodingMismatchTotal.inc();
    if (verdict === 'mismatch') await this.onMismatch(pin, doc, canonical);
    doc.destroy();
    // ⑥ compare-and-delete（ok/语义等/编码差异/mismatch 档=pin 使命完成；skip 档上方已 return 保 pin）
    await this.deletePin(pin);
  }

  /** mismatch 处置：freeze 实弹（红⑥-b 调用面）+Sentry+结构化日志（语义摘要=runbook §14 分诊面）。 */
  private async onMismatch(pin: VerifyPinRow, doc: Y.Doc, canonical: Buffer | null): Promise<void> {
    const pid = pin.projectId;
    const failure = {
      projectId: pid, generation: pin.pinGeneration,
      snapshotRev: pin.snapshotRev.toString(), stateSeq: pin.stateSeq.toString(), pgSeqAt: pin.pgSeqAt.toString(),
      hashSkipped: pin.hashSkipped, canonicalBytes: canonical?.length ?? null,
      semanticDigest: semanticViewDigest(doc),   // 节点 canonical JSON 摘要（比对分诊面）
    };
    this.logger.error(`canary verify MISMATCH（hash 红∧SV 互支失败——语义不等，freeze 实弹）: ${JSON.stringify(failure)}`);
    captureCollabException(
      new Error(`canary replay mismatch project=${pid} generation=${pin.pinGeneration} pgSeqAt=${pin.pgSeqAt}`),
      { docName: projectDocName(pid), reason: 'canary-replay-mismatch', connectionId: '-' },
    );
    if (!this.freezeEnabled) {
      // shadow 档（dev 显式 CANARY_FREEZE_ENABLED='false'）：只告警+计数不 freeze（plan v3.1 ⑪）
      collabCanaryFreezeTotal.inc({ reason: 'freeze-suppressed' });
      return;
    }
    try {
      const r = await freezeOpsGateCompact(this.prisma, {
        projectId: pid, frozenBy: 'canary-verify',
        reason: `replay mismatch g=${pin.pinGeneration} pgSeqAt=${pin.pgSeqAt} digest=${failure.semanticDigest}`,
      });
      collabCanaryFreezeTotal.inc({ reason: r.frozen ? 'semantic-mismatch' : 'already-frozen' });
    } catch (e) {
      collabCanaryFreezeTotal.inc({ reason: 'freeze-error' });
      this.logger.error(`canary freeze 调用失败（mismatch 已告警——gate 未冻结，pin 已删〔TTL 兜底〕，runbook §14 人工处置）project=${pid}: ${(e as Error).message}`);
    }
  }

  /** compare-and-delete：坐标谓词（projectId+pgSeqAt+snapshotRev）——TTL 过期后新 pin 误删根除。 */
  private async deletePin(pin: Pick<VerifyPinRow, 'projectId' | 'pgSeqAt' | 'snapshotRev'>): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "CanaryPin"
      WHERE "projectId" = ${pin.projectId}::text AND "pgSeqAt" = ${pin.pgSeqAt}::bigint AND "snapshotRev" = ${pin.snapshotRev}::bigint`
      .catch((e: unknown) => {
        this.logger.warn(`canary pin compare-and-delete 失败 project=${pin.projectId}: ${(e as Error).message}（TTL 清扫兜底）`);
      });
  }

  /** last_check_age gauge 维护面（全局 max 秒——活跃项目宇宙〔updatedAt>now−7d∧ACTIVE〕的
   *  COALESCE(cursor.lastCheckedAt, doc.updatedAt) 最老年龄；never-checked 项目以 doc.updatedAt
   *  起算=新项目不虚高。spec「>24h 告警 P1」判定面=check-collab-health CANARY_CHECKS〔THRESHOLDS
   *  同名条目声明面〕）。失败保持最后值（ops-gate frozen_age 同族）。 */
  private async refreshLastCheckAge(): Promise<void> {
    const scopeSql = this.verifyScope ? Prisma.sql` AND d."projectId" = ANY(${this.verifyScope}::text[])` : Prisma.empty;
    try {
      const rows = await this.prisma.$queryRaw<{ age: number | null }[]>`
        SELECT EXTRACT(EPOCH FROM (now() - MIN(chk)))::float8 AS age FROM (
          SELECT LEAST(COALESCE(c."lastCheckedAt", d."updatedAt"), now()) AS chk
          FROM "CanvasDoc" d
          JOIN "CanvasProject" p ON p.id = d."projectId"
          LEFT JOIN "CollabCanaryCursor" c ON c."projectId" = d."projectId"
          WHERE p."lifecycleState" = 'ACTIVE' AND d."updatedAt" > now() - interval '7 days'${scopeSql}
        ) t`;
      lastKnownCheckAgeSeconds = rows[0]?.age ?? 0;
    } catch { /* 保持最后值 */ }
    collabCanaryLastCheckAge.set(lastKnownCheckAgeSeconds);
  }
}
