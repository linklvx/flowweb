// apps/api/src/modules/collab/collab-frame-gate.service.ts
// Y1c T9（plan v1.7 Task 9）：FrameGate——guardSyncFrame 自 collab-doc-registry.service **收编重写**
// （偏离 38③：apply 归属=CollabProjectActor——gate 提交帧并 await 其 promise；beforeSync resolve=
// 帧已 fsync+apply，库随后的重放=幂等零事件+恰一 SyncStatus(true)——S1 验收①）。
//
// 分层序（生产 guardSyncFrame 前半保留+尾部换轨提交）：
//  SS1 读路径零成长（Y1c T12：preVacuumSv SV 代际门**退役**〔偏离 27〕——SV clock 关系层防不住
//  Update 帧路径〔S2 Phase C〕且形态②〔全 clock<pre〕结构性放行；世代执法改道 docName 段
//  auth/load 双校验〔admitDocNameForGeneration——装载先于任何帧，SS1 到达前已拦〕）→⓪帧闸
//  （Update>2×maxTxBytes 1009 terminal／SS2>maxDocBytes+ALLOWANCE 4404 doc-over-quota——VIEWER
//  巨帧也过闸）→⓪′bytes 速率桶（1008——独立于权限态）→②③④配额判定（DR.admitFrameQuota——
//  truth/冻结族单一所有者仍 DR）→actor.submit（⓪ readOnly/writeFreeze/quota 短路最先+世代权威
//  +P1 shape+pending 区间预检+去重+WAL fsync+apply 归 actor 串行段——APPLY_ADMISSION_STAGES）。
//  readOnly 短路面**后置 actor ⓪**（库 readOnly 检查在 beforeSync 之后 esm:264-276——gate 若先
//  apply 则 VIEWER 帧已入 doc，F-5；本 gate 不 apply，短路在 actor apply 之前语义等价且计数在彼）。
import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import type { beforeSyncPayload } from '@hocuspocus/server';
import { messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from 'y-protocols/sync';
import { CollabCloseCode, DOC_OVER_QUOTA_TERMINAL_REASON, FRAME_ALLOWANCE_BYTES } from '@flowweb/shared';
import { parseDocName } from './doc-name.util';
import { CollabDocRegistryService, type QuotaConfig } from './collab-doc-registry.service';
import { CollabProjectActorService } from './collab-project-actor.service';
import { collabBytesRateExceededTotal, collabQuotaFrameRejectedTotal, yjsInboundFrameBytes } from './store.metrics';
import type { CollabConnection } from './collab.gateway';

/** gate host 最小接口（bindHost 后置绑定——SG 能力三位经 gateway 1 行转发；DR host 同款形态）。 */
export interface CollabFrameGateHost {
  readonly logger: Logger;
  /** code 权威投递关闭（SG 能力——webSocket.close 先行，throw 仅兜底中止帧）。 */
  hardClose(conn: CollabConnection | undefined | null, code: number, reason: string): void;
  /** bytes 速率桶扣减（⓪′——桶 SG 所有）。 */
  consumeBytesBucket(socketId: string, bytes: number): boolean;
}

@Injectable()
export class CollabFrameGateService {
  private host!: CollabFrameGateHost;

  constructor(
    @Inject(CollabDocRegistryService) private readonly docRegistry: CollabDocRegistryService,
    @Inject(CollabProjectActorService) private readonly actor: CollabProjectActorService,
    @Optional() quota?: Partial<QuotaConfig>,
  ) {
    // 配额四值经 DR 单源（gate 帧闸阈值=DR.activeQuota——防双源 P3；注入覆盖仅测试缝）
    void quota;
  }

  bindHost(host: CollabFrameGateHost): void { this.host = host; }

  private get quota(): QuotaConfig { return this.docRegistry.activeQuota; }

  /** beforeSync 唯一入口（gateway hooks.beforeSync 接线——收编自 DR.guardSyncFrame）。 */
  async guardSyncFrame({ type, payload, document, connection }: beforeSyncPayload): Promise<void> {
    const pid = parseDocName((document as unknown as { name: string }).name)?.projectId ?? '';
    if (type === messageYjsSyncStep1) {
      // Y1c T12（偏离 27）：SS1=读路径零成长——preVacuumSv SV 代际门退役（SV clock 关系层防不住
      // Update 帧路径且形态②〔全 clock<pre〕结构性放行——S2 Phase C/D 实证）；世代执法=docName 段
      // auth/load 双校验（admitDocNameForGeneration——装载先于任何帧，陈旧世代名到不了本钩子）。
      return;
    }
    const bytes = payload.byteLength;
    const conn = connection as unknown as CollabConnection;
    // ⓪ 帧闸（Q-E v5+Y0b-5 T8 裁定 24⑧）：Update>2×maxTxBytes=1009 DoS 档；SS2>maxDoc+ALLOWANCE=
    // 4404 doc-over-quota（terminal 自救档——离线合并回灌合法帧≠DoS）
    if (type === messageYjsUpdate && bytes > 2 * this.quota.maxTxBytes) {
      collabQuotaFrameRejectedTotal.inc({ reason: 'frame-too-large' });
      this.host.hardClose(conn, CollabCloseCode.LIB_MESSAGE_TOO_BIG, 'frame-too-large');
      throw Object.assign(new Error('frame too large'), { code: CollabCloseCode.LIB_MESSAGE_TOO_BIG, reason: 'frame-too-large' });
    }
    if (type === messageYjsSyncStep2 && bytes > this.quota.maxDocBytes + FRAME_ALLOWANCE_BYTES) {
      collabQuotaFrameRejectedTotal.inc({ reason: 'doc-over-quota' });
      try { conn?.sendStateless?.(JSON.stringify(this.docRegistry.buildDocStatus(pid))); } catch { /* 先通告尽力 */ }
      this.host.hardClose(conn, CollabCloseCode.DOC_OVER_QUOTA, DOC_OVER_QUOTA_TERMINAL_REASON);
      throw Object.assign(new Error('doc over quota'), { code: CollabCloseCode.DOC_OVER_QUOTA, reason: DOC_OVER_QUOTA_TERMINAL_REASON });
    }
    yjsInboundFrameBytes.observe(bytes);
    // ⓪′ bytes 速率桶（T6 H-3——帧闸后 readOnly 短路前：速率闸独立于权限态；SyncStep2 与 Update
    // 同桶同键 sid；容量=maxDocBytes——离线合并回灌合法帧首扣由容量吸收）
    if (!this.host.consumeBytesBucket(conn?.socketId ?? '', bytes)) {
      collabBytesRateExceededTotal.inc();
      this.host.hardClose(conn, CollabCloseCode.RATE_LIMITED_CLOSE, 'bytes-rate-exceeded');
      throw Object.assign(new Error('bytes rate exceeded'), { code: CollabCloseCode.RATE_LIMITED_CLOSE, reason: 'bytes-rate-exceeded' });
    }
    // ②③④ 配额判定（DR truth/冻结族——over 短路/f快路径/账面实测+冻结决策）。
    //  Y1c T9 修正：frozen 档**不在此短路**——交 actor ⓪ noop 放行+丢帧计数+overPush 升级判定
    //  （DR.noteReadOnlyDrop 单点：gate 层早退会绕过 writes_dropped/4404 升级台账=计数断链）。
    this.docRegistry.admitFrameQuota(pid, bytes, document);
    // ═══ T9 换轨：提交 actor（准入链 ⓪-⑤+一次 WAL appendBatch+fsync→逐帧 apply→resolve 本 promise）═══
    // resolve=帧已 fsync+apply（spool 先于 apply——ACK 时帧必已 fsync）；reject=FrameRejectError
    // （码权威投递 hardClose 已由 actor 完成先行——本 throw 仅中止帧+清同批后续）。
    try {
      await this.actor.submit(pid, payload, conn, type === messageYjsSyncStep2 ? 'ss2' : 'update');
    } catch (err) {
      const e = err as { code?: number; reason?: string };
      throw Object.assign(new Error(e?.reason ?? 'frame rejected'), { code: e?.code ?? CollabCloseCode.FRAME_MALFORMED, reason: e?.reason ?? 'frame-malformed' });
    }
  }
}
