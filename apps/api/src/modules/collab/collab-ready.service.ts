// Y0a-3（spec v2.5 §3.3）：/api/ready 组装——503 判据=PG+租约+collabState（Redis 仅报不 gating）；
// reason collabState 主导派生（W12/P6：isolated→lease-lost；held∧未服务→not-serving；acquiring 才看
// lease diag）；1s 单飞缓存（Z10：探针轮询不吃 PG/Redis）；pending 消费 gateway.computePending
//（必办②同一实现禁复制）；epoch=string；drain 生命周期在 gateway（T5）。
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { CollabReadyReason, CollabReadyResponse } from '@flowweb/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CollabLeaseService } from './collab-lease.service';
import { CollabGateway } from './collab.gateway';
import { CollabSpoolService } from './collab-spool.service';
import { REDIS_CLIENT } from '../../common/redis/managed-redis';

type ReadyResult = { status: number; body: CollabReadyResponse };

@Injectable()
export class CollabReadyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly lease: CollabLeaseService,
    private readonly gateway: CollabGateway,
    private readonly spool: CollabSpoolService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private inflight: Promise<ReadyResult> | null = null;
  private cached: { at: number; v: ReadyResult } | null = null;

  async getReady(): Promise<ReadyResult> {
    if (this.cached && Date.now() - this.cached.at < 1_000) return this.cached.v;   // Z10：1s 缓存
    this.inflight ??= this.computeReady().then((v) => { this.cached = { at: Date.now(), v }; this.inflight = null; return v; });
    return this.inflight;
  }

  private async computeReady(): Promise<ReadyResult> {
    const pending = this.gateway.computePending();
    const base = { pending, spoolQuarantined: this.spool.quarantinedSegments().length };   // T4 勘误：诊断 LIST 取 .length
    let pgOk = true;
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { pgOk = false; }
    if (!pgOk) return { status: 503, body: { ready: false, reason: 'pg-down', redis: await this.redisStatus(), ...base } };
    const diag = await this.lease.diag();
    const phase = this.gateway.getCollabState();
    const common = {
      redis: await this.redisStatus(),
      holder: diag.holder ?? undefined,
      epoch: diag.epoch ?? undefined,
      holderRenewedAgoMs: diag.renewedAt ? Date.now() - diag.renewedAt.getTime() : undefined,
    };
    // P6 优先级（W12 collabState 主导）：draining > lease-error > lease-lost > not-serving
    // > lease-held > lease-not-acquired > spool-unwritable；ready=true 当且仅当全空
    let reason: CollabReadyReason | undefined;
    if (this.gateway.isShuttingDown()) reason = 'draining';
    else if (diag.statementFailed) reason = 'lease-error';
    else if (phase === 'isolated' || diag.state === 'lost' || diag.state === 'revoked') reason = 'lease-lost';
    else if (diag.state === 'held' && phase !== 'serving') reason = 'not-serving';
    else if (diag.state !== 'held' && diag.holder != null && diag.holder !== 'revoked') reason = 'lease-held';
    else if (diag.state !== 'held') reason = 'lease-not-acquired';
    else if (this.gateway.isWritableOrDegraded() !== 'ok') reason = 'spool-unwritable';
    if (reason) return { status: 503, body: { ready: false, reason, ...common, ...base } };
    return { status: 200, body: { ready: true, ...common, ...base } };
  }

  private async redisStatus(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status !== 'ready') await this.redis.connect().catch(() => {});
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<string>((r) => { setTimeout(() => r('timeout'), 500).unref?.(); }),
      ]);
      return pong === 'PONG' ? 'up' : 'down';
    } catch { return 'down'; }
  }
}
