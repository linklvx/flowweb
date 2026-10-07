// apps/api/src/modules/collab/collab-lease.service.ts
// Y0a-3（spec v2.5 §3.2/E44/E35）：PG 租约——单实例拓扑的**互斥+接管顺序**机制，非数据完整性、
// 非活性自检。TTL 唯一作用=崩溃后多快被接管（RTO 参数），不参与任何正确性判定——正确性由
// ①CAS 改变 owner ②写语句 owner 断言 ③PG delta 并集+CRDT 幂等 承担。
// SV1：renew/fence 判据 owner-only——CAS 不清过期 owner，"owner=$me ∧ 已过期" ⟺ 从无他人接管
// ⇒ 续租/写入安全（唯一持有者）；被夺 ⟺ owner≠me（真 fenced）。**禁把 TTL 守卫加回**（会把事件
// 循环阻塞>TTL 误判为被夺=单实例永久停服）。
// 状态机：not-acquired → held →（fenced/unknown 到期）lost → rejoin（SV5）；
//         break-glass 撤销 → revoked 终态（不 rejoin——防 1s 内抢回，W7）。
// 单点负责制（W5/P9）：凡 state→held 必经 dispatchAcquired await 启动回调——gateway/fast path/
// acquireLoop/rejoinLoop 均不自行调用；lease-stub 同契约。
// fence 接线（契约 16）：本服务=repo.setLeaseOwner 唯一写者；spool.setOwner 唯一写者
// （失守/释放均不清 spool owner——残余批次仍落本实例目录供 reconciler 收养）。
import { Injectable, Inject, Logger } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasDocUpdateRepository } from './canvas-doc-update.repository';
import { CollabSpoolService } from './collab-spool.service';
import { collabLeaseDeniedTotal, collabLeaseEpoch, collabStartFailureTotal } from './store.metrics';

export const COLLAB_LEASE_SCOPE = 'primary';   // Y7 演进=加行非改架构（容量/scope 常量——T10 登记）
export const REVOKED_OWNER = 'revoked';        // break-glass 哨兵（SV2）：CAS 经 expiresAt<now() 支路立即可得

export type CollabLeaseState = 'not-acquired' | 'held' | 'lost' | 'revoked';
export type LeaseLostCause = 'fenced-by-write' | 'heartbeat-fenced' | 'heartbeat-unknown-expired' | 'revoked';

export interface CollabLeaseDiag {
  state: CollabLeaseState;
  owner: string | null;          // 本进程 owner（not-acquired 未产生=null）
  holder: string | null;         // DB 行当前 owner（ready.holder 源——held 时=owner）
  epoch: string | null;          // String(BigInt)——JSON 可序列化（spec §3.3）
  renewedAt: Date | null;        // ready.holderRenewedAgoMs 源（Z19）
  statementFailed: boolean;      // PG 通但租约语句自身失败（ready lease-error 判据）
}

const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });   // M3：unref——关停后事件循环不被吊住

@Injectable()
export class CollabLeaseService {
  private readonly logger = new Logger(CollabLeaseService.name);
  /** W4/V4：owner 同时是 spool 子目录名——文件系统安全形态（Windows 禁 ':'）且**长度有界**
   *  （host 段 ≤24：K8s 长 pod 名不得撞 setOwner 的 64 上限 throw=半 held 僵尸）；唯一性=pid+ts+rand。 */
  readonly owner = `${hostname().replace(/[^A-Za-z0-9_-]/g, 'x').slice(0, 24)}-${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  private state: CollabLeaseState = 'not-acquired';
  private epoch: bigint | null = null;
  private renewedAt: Date | null = null;
  private statementFailedFlag = false;
  private halted = false;
  private everHeld = false;           // V5/I2：本进程曾进入 held——rejoin 时对 revoked 行执行行政终态门
  private acquireLoopRunning = false; // V7：单飞闸——防 fast-path 兜底/5s 重试/看门狗多源并发起循环（双 CAS→双 listen 自撞）
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unknownRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenewOkMono = 0n;   // Z2：单调钟——unknown 到期判据不混 DB/应用双时钟域
  private readonly ttlMs: number;
  private readonly heartbeatMs: number;
  /** gateway 接线（W5 单点）：获取成功→启动 collab 面（dispatchAcquired 统一 await）；
   *  失守/撤销→gateway.selfIsolate。回调异常不损租约事实。 */
  onAcquired?: () => void | Promise<void>;
  onLost?: (cause: LeaseLostCause) => void;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CanvasDocUpdateRepository) private readonly repo: CanvasDocUpdateRepository,
    private readonly spool: CollabSpoolService,
  ) {
    this.ttlMs = Number(process.env.COLLAB_LEASE_TTL_MS) || 10_000;
    this.heartbeatMs = Number(process.env.COLLAB_LEASE_HEARTBEAT_MS) || 3_000;
    if (!(this.ttlMs > 0 && this.heartbeatMs > 0 && this.heartbeatMs * 2 <= this.ttlMs))
      throw new Error(`COLLAB_LEASE_TTL_MS/HEARTBEAT_MS 不变式破坏（需 TTL>0 ∧ 0<HB≤TTL/2）：ttl=${this.ttlMs} hb=${this.heartbeatMs}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(this.owner))
      throw new Error(`lease owner 非文件系统安全形态: ${this.owner}`);   // V4：构造期 fail-fast——起不来好过起一个半 held 僵尸
  }

  isServing(): boolean { return this.state === 'held'; }
  getState(): CollabLeaseState { return this.state; }

  /** P9 快路径：一次有界 CAS——健康态一轮往返即获取；成功即由本方法 await 启动回调（W5 单点）。 */
  async tryAcquireFast(): Promise<boolean> {
    if (this.state === 'held') return true;
    const ok = await this.attemptAcquire();
    if (ok) await this.dispatchAcquired();
    return ok;
  }

  private async dispatchAcquired(): Promise<void> {
    if (this.halted) {   // V7：关停在飞获取——立即放行（防关停期起 collab 面）
      await this.release().catch(() => {});
      return;
    }
    try { await this.onAcquired?.(); }
    catch (e) { this.logger.error(`onAcquired 回调失败（gateway 侧应有自身 catch——此为 belt）: ${(e as Error).message}`); }
  }

  /** P10：急重试 30×1s（覆盖 TTL 接管窗）→passive 按行到期等待（W/P2-3：SELECT expiresAt→
   *  sleep min(剩余+100ms,5s)+10% 抖动——卡死进程 RTO=ttl+ε 而非 30s）。 */
  async acquireLoop(): Promise<void> {
    if (this.acquireLoopRunning) return;   // V7 单飞：多源（onModuleInit 兜底/5s 重试/看门狗）只跑一个循环
    this.acquireLoopRunning = true;
    try {
    for (let i = 0; i < 30; i++) {
      if (this.halted || this.state !== 'not-acquired') return;
      await sleep(1_000);
      if (this.halted || this.state !== 'not-acquired') return;
      try { if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; } }
      catch (e) { this.logger.error(`lease acquire attempt ${i + 1} failed: ${(e as Error).message}`); }
    }
    this.logger.error('lease 急重试 30 次耗尽——passive 按行到期续试（ready=lease-not-acquired/lease-held/lease-error）');
    for (;;) {
      if (this.halted || this.state !== 'not-acquired') return;
      let waitMs = 5_000;
      try {
        const row = await this.prisma.$queryRaw<{ expiresAt: Date | null }[]>`
          SELECT "expiresAt" FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
        if (row[0]?.expiresAt) {
          const remain = row[0].expiresAt.getTime() - Date.now() + 100;
          waitMs = Math.max(200, Math.min(remain, 5_000));
        }
      } catch { /* 行读失败按 5s */ }
      await sleep(waitMs * (0.9 + Math.random() * 0.2));
      if (this.halted || this.state !== 'not-acquired') return;
      try { if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; } } catch { /* passive 续试 */ }
    }
    } finally { this.acquireLoopRunning = false; }
  }

  /** CAS 一语句组（自愈 seed+revoked 门同事务）——语句层 $transaction 有界（N3：PG 黑洞时 promise 必然
   *  settle，onModuleInit/HTTP 绑定不被拖死——替代 2s race，消灭"后台悄悄成功"僵尸窗口）。 */
  private async attemptAcquire(): Promise<boolean> {
    if (this.halted) return false;
    const ttl = this.ttlMs;
    let revokedGate = false;
    try {
      this.statementFailedFlag = false;
      const rows = await this.prisma.$transaction(
        async (tx) => {
          // Z17 自愈 seed：行缺失自重建（获取路径 leaseRowMissing 结构性不可达——写路径保留区分）
          await tx.$executeRaw`INSERT INTO "CollabLease" (scope, owner, epoch, "expiresAt", "renewedAt")
            VALUES (${COLLAB_LEASE_SCOPE}, NULL, 0, NULL, NULL) ON CONFLICT (scope) DO NOTHING`;
          // V5/I2/I6：everHeld 进程对 revoked 行执行行政终态门——break-glass 的运维意图（让位新实例）
          // 不得被本进程 rejoin 经 expiresAt<now() 支路抢回（新进程 everHeld=false 照常可夺）。
          // unknown-expired 隔离不查行——此门是 revoked 检查的唯一 held 入口对称面。
          if (this.everHeld) {
            const row = await tx.$queryRaw<{ owner: string | null }[]>`
              SELECT owner FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
            if (row[0]?.owner === REVOKED_OWNER) { revokedGate = true; this.revoke(); return []; }
          }
          return tx.$queryRaw<{ epoch: bigint }[]>`
            UPDATE "CollabLease" SET owner = ${this.owner}, epoch = epoch + 1,
              "expiresAt" = now() + make_interval(secs => ${ttl / 1000}), "renewedAt" = now()
            WHERE scope = ${COLLAB_LEASE_SCOPE}
              AND (owner IS NULL OR owner = ${this.owner} OR "expiresAt" < now())
            RETURNING epoch`;
        },
        { timeout: 2_000, maxWait: 500 },
      );
      if (rows.length === 0) { collabLeaseDeniedTotal.inc({ reason: revokedGate ? 'revoked' : 'contention' }); return false; }
      await this.onHeld(rows[0].epoch);
      return true;
    } catch (e) {
      this.statementFailedFlag = true;
      collabLeaseDeniedTotal.inc({ reason: 'error' });
      throw e;
    }
  }

  /** V4/I1 原子：state='held' ⟺ 心跳在跑 ∧ repo/spool 接线完成——接线失败即释放租约行并抛
   *  （调用方见 start-failed 语义，绝不留"持有租约但无心跳/无 spool owner"的半态僵尸）。
   *  释放为 await：acquireLoop 1s 后以同 owner 重试，fire-and-forget 的无界释放若迟到落行，
   *  WHERE owner=$me 仍命中→清掉重取后的行=假 heartbeat-fenced；await 保证释放先于重试完成。 */
  private async onHeld(epoch: bigint): Promise<void> {
    this.epoch = epoch;
    this.renewedAt = new Date();
    try {
      this.repo.setLeaseOwner(this.owner);   // 契约 16：唯一写者
      this.spool.setOwner(this.owner);       // R3：写路径切每实例子目录（构造期已保 owner 合法——此为防御断点）
    } catch (e) {
      this.state = 'not-acquired';
      collabStartFailureTotal.inc();
      this.logger.error(`lease onHeld 接线失败——释放租约行拒当僵尸: ${(e as Error).message}`);
      await this.prisma.$queryRaw`
        UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL
        WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}`.catch(() => {});
      throw e;
    }
    this.state = 'held';
    this.everHeld = true;
    collabLeaseEpoch.set(Number(epoch));
    this.lastRenewOkMono = process.hrtime.bigint();
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => { void this.heartbeat().catch(() => {}); }, this.heartbeatMs);
    this.heartbeatTimer.unref?.();   // E35：独立 unref timer——进程退出不被阻
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.unknownRetryTimer) { clearTimeout(this.unknownRetryTimer); this.unknownRetryTimer = null; }
  }

  /** 心跳三态（E35/SV1）：renewed=续期；0 行→classifyZeroRow（fenced|revoked|lease-error）；
   *  unknown（抛错）=PG 抖动≠被接管——1s 重试直到**单调钟到期**（ttl+hb 无成功）才隔离。
   *  **禁把 unknown 当 fenced**（一次 PG 1s 抖动不得踢全队）；**禁加回 TTL 守卫**。 */
  private async heartbeat(): Promise<void> {
    if (this.state !== 'held' || this.halted || this.unknownRetryTimer) return;
    if (this.lastRenewOkMono !== 0n
      && process.hrtime.bigint() - this.lastRenewOkMono >= BigInt(this.ttlMs + this.heartbeatMs) * 1_000_000n)
      return this.isolate('heartbeat-unknown-expired');
    try {
      const rows = await this.prisma.$transaction(
        (tx) => tx.$queryRaw<{ renewedAt: Date }[]>`
          UPDATE "CollabLease" SET "expiresAt" = now() + make_interval(secs => ${this.ttlMs / 1000}), "renewedAt" = now()
          WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}
          RETURNING "renewedAt"`,
        { timeout: 2_000, maxWait: 500 },
      );
      if (rows.length === 0) return void this.classifyZeroRow().catch(() => { this.statementFailedFlag = true; });
      this.lastRenewOkMono = process.hrtime.bigint();
      this.renewedAt = rows[0].renewedAt;
    } catch {
      this.scheduleUnknownRetry();
    }
  }

  /** renew 0 行分流（W7/N2②）：owner='revoked'（break-glass 撤销）→revoked 终态不 rejoin；
   *  行缺失→statementFailed（lease-error 档——不隔离不伪装 fenced，§0.5）；他人持有→真 fenced。 */
  private async classifyZeroRow(): Promise<void> {
    const row = await this.prisma.$queryRaw<{ owner: string | null }[]>`
      SELECT owner FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
    if (row.length === 0) { this.statementFailedFlag = true; return; }
    if (row[0]?.owner === REVOKED_OWNER) return this.revoke();
    this.isolate('heartbeat-fenced');
  }

  private scheduleUnknownRetry(): void {
    if (this.unknownRetryTimer || this.state !== 'held') return;
    this.unknownRetryTimer = setTimeout(() => { this.unknownRetryTimer = null; void this.heartbeat(); }, 1_000);
    this.unknownRetryTimer.unref?.();
  }

  /** 自隔离（E35 不自杀不硬撑）：repo fence 收口（owner=null=断言恒败）+gateway.onLost（关 WS/listener）。
   *  计数单源=gateway.selfIsolate（{cause} 标签——一次失守至多计 1）。lost→rejoinLoop（SV5）。 */
  private isolate(cause: LeaseLostCause): void {
    if (this.state === 'lost' || this.state === 'revoked') return;
    this.state = 'lost';
    this.statementFailedFlag = false;
    this.stopHeartbeat();
    collabLeaseEpoch.set(0);            // V6：不再持有——gauge 复位（值班不读旧实例 epoch）
    this.repo.setLeaseOwner(null);   // 契约 16 fail-closed（spool.setOwner 不清——P19）
    this.logger.error(JSON.stringify({ event: 'collab_lease_lost', cause, note: 'rejoin 退避重获取中（B7 re-listen 可行）' }));
    try { this.onLost?.(cause); } catch (e) { this.logger.warn(`onLost callback failed: ${(e as Error).message}`); }
    void this.rejoinLoop().catch(() => {});
  }

  /** break-glass 撤销终态（SV2/W7）：运维行政性降级——不 rejoin（防 1s 内抢回）；重启才重新参与。 */
  private revoke(): void {
    if (this.state === 'revoked') return;
    const wasHeld = this.state === 'held';
    this.state = 'revoked';
    this.statementFailedFlag = false;
    this.stopHeartbeat();
    collabLeaseEpoch.set(0);            // V6
    this.repo.setLeaseOwner(null);
    this.logger.error(JSON.stringify({ event: 'collab_lease_revoked', note: 'break-glass 撤销——终态不 rejoin，进程重启才重新参与' }));
    if (wasHeld) try { this.onLost?.('revoked'); } catch { /* gateway 侧幂等 */ }
  }

  /** SV5：lost→退避 [1,2,5,15,30]s 封顶 30s 重获取——owner=$me 支路使"未被夺"场景立即复得；
   *  被夺则等 TTL/释放。halted/状态迁移即退出。 */
  private async rejoinLoop(): Promise<void> {
    const backoff = [1_000, 2_000, 5_000, 15_000, 30_000];
    for (let i = 0; ; i++) {
      if (this.halted || this.state !== 'lost') return;
      await sleep(backoff[Math.min(i, backoff.length - 1)]);
      if (this.halted || this.state !== 'lost') return;
      try {
        if (await this.attemptAcquire()) { await this.dispatchAcquired(); return; }
      } catch { /* 续试 */ }
    }
  }

  /** 显式释放（§2.4 步骤 6 ≤2s）：owner=NULL 使下实例 CAS 立即命中（RTO 不吃 TTL）；
   *  SIGKILL 截断则下实例等 TTL（过期支路兜底）。非 held 态 no-op。 */
  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.state !== 'held') return;
    try {
      await this.prisma.$queryRaw`
        UPDATE "CollabLease" SET owner = NULL, "expiresAt" = NULL, "renewedAt" = NULL
        WHERE scope = ${COLLAB_LEASE_SCOPE} AND owner = ${this.owner}`;
    } catch (e) { this.logger.warn(`lease release failed（下实例将等 TTL 接管）: ${(e as Error).message}`); }
    this.state = 'not-acquired';
    collabLeaseEpoch.set(0);   // V6
    this.repo.setLeaseOwner(null);
  }

  /** W9/M3/N9：关停闸——halt 后 acquireLoop/rejoinLoop/心跳全部退出（防关停期抢租约留死 owner）；
   *  sleep 均 unref（"坏版本部署/PG 长故障期重启"不被吊到 kill_timeout SIGKILL）。 */
  halt(): void { this.halted = true; this.stopHeartbeat(); }

  /** ready 诊断（§3.3）：held 时 owner/epoch/renewedAt 本地即得；否则读 DB 行（lease-held 取证）。
   *  行读取失败静默（pg-down 由 ready 的 SELECT 1 先判）。 */
  async diag(): Promise<CollabLeaseDiag> {
    let holder: string | null = null;
    let epoch: string | null = null;
    let renewedAt: Date | null = null;
    if (this.state === 'held') {
      holder = this.owner;
      epoch = this.epoch?.toString() ?? null;
      renewedAt = this.renewedAt;
    } else {
      try {
        const row = await this.prisma.$queryRaw<{ owner: string | null; epoch: bigint; renewedAt: Date | null }[]>`
          SELECT owner, epoch, "renewedAt" FROM "CollabLease" WHERE scope = ${COLLAB_LEASE_SCOPE}`;
        holder = row[0]?.owner ?? null;
        epoch = row[0]?.epoch != null ? row[0].epoch.toString() : null;
        renewedAt = row[0]?.renewedAt ?? null;
      } catch { /* pg-down 分流 */ }
    }
    return {
      state: this.state,
      owner: this.state !== 'not-acquired' ? this.owner : null,
      holder, epoch, renewedAt,
      statementFailed: this.statementFailedFlag,
    };
  }
}
