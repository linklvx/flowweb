// apps/api/src/modules/collab/collab-recovery-import.service.ts
// Y1c T25（plan v1.7 Task 25——spec §3.2 v5.4⑱/§4.5）：recovery import REST 服务面——
// client→server 大差量恢复的**唯一接受路径**（HTTP seed 端点废止；DraftEnvelope typed 内容
// ≤8MiB——非 CRDT 裸字节回灌）。契约（DRAFT_IMPORT_CONTRACT）：
//  - 资格=OWNER/EDITOR 且仅本人 draft（controller assertEditor+envelope.projectId 锚定路由项目）；
//  - 幂等键=draftId（重试同结果——结果表回放）+单飞（每项目同时一个导入在飞——并发后到 409）；
//  - 候选 doc 全量校验=「恢复流程非兼容层」：L1 DENY 矩阵+XML 白名单（T16/T24 单表复用——
//    validateFrameDeny/validateXmlL1 与 actor 准入链同谓词）+图结构（悬挂边丢弃报告+#9 逐节点
//    冲突默认 skip/replace）+hash 完整性+8MiB 上限（超限=413 导出文件 fail-closed 不开导入）；
//  - **唯一允许 clone 的场所**（§3.2）：候选=live doc 全量快照 clone（new Y.Doc+applyUpdate），
//    校验全过才 commit——commit=diff 以 origin='import' 直写 live doc（doc_update_origin_total
//    {origin='import'} 计数接线=T24 移交#5；维护写通道 persistence 队列承接 WAL/PG 落定）。
//    mode='read' 会话说明：residency write 路由会把 fn 包进最外层 SERVER_TRANSACT_ORIGIN transact
//    （yjs 嵌套 transact 忽略内层 origin——origin='import' 分类面结构性丢失）；read 会话直执行 fn
//    ——本服务的受理门=入口 lease/vacuum 门（withSession 自带）+本管线全量校验（受控生命周期
//    操作语义〔v5-2〕——与 writeBatch 的 SERVER_TRANSACT_ORIGIN 维护档同族、分类档不同）。
import { BadRequestException, ConflictException, Inject, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import {
  CANVAS_DOC_SCHEMA_VERSION,
  DRAFT_ENVELOPE_MAX_BYTES,
  rebuildCanvasDoc,
  resolveImportNodeConflicts,
  validateFrameDeny,
  validateXmlL1,
  type DraftEnvelope,
  type DraftImportConfirmation,
  type ImportNodeDisposition,
  type NodeIdConflictPolicy,
} from '@flowweb/shared';
import { CollabDocumentService } from './collab-document.service';
import { readCanvasDocHead } from './canvas-doc-head';
import { createCanvasDoc } from './canvas-doc.factory';
import { CollabLifecycleObserverService } from './collab-lifecycle-observer.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Y1c T16/T24：L1 扫描 URL allowlist 单表（同 actor XML_ATTR_URL_ALLOWED_HOSTS——env 注入受控域；
 *  空表=deny-all http(s) 属性 URL）。 */
const RECOVERY_XML_URL_ALLOWED_HOSTS: readonly string[] = (process.env.COLLAB_XML_URL_HOSTS ?? '')
  .split(',').map((h) => h.trim()).filter((h) => h !== '');

/** 幂等结果表 TTL（进程内有界——单实例 ADR instances:1 前提；跨重启幂等由 nodeId 稳定+默认
 *  skip 结构性承载：同 envelope 重导入=全冲突全 skip=零新写）。 */
const RESULT_TTL_MS = 10 * 60_000;

export interface RecoveryImportResult {
  confirmation: DraftImportConfirmation;
  /** 逐节点三分派（#9：冲突默认 skip、显式 replace、非冲突 import）。 */
  dispositions: ImportNodeDisposition[];
  /** 逐边三分派（收口 I-6：同 id 边冲突默认 skip——协作者改过的边禁静默覆盖；非冲突 import）。 */
  edgeDispositions: Array<{ edgeId: string; disposition: 'import' | 'skip' }>;
  /** draftId 幂等回放标记（重试同结果）。 */
  resultReplayed: boolean;
  /** T25b 收口 I-3：B 场景删除确认执行报告（typed REST 承载——禁 doc 写承载裁定）。
   *  微批 M-6：filteredIntersection=deletionNodeIds∩envelope.nodes 滤除数（信封成员面归导入
   *  通道权威——同批互杀收口）。 */
  deletions: { requested: number; applied: number; filteredIntersection: number };
  /** 跨代/跨纪元随行报告（不阻断——typed 内容导入非 CRDT 回灌；C 场景本就跨代）。 */
  epoch: { envelopeGeneration: number; envelopeHistoryId: string; crossGeneration: boolean };
}

/** T25 收口：钉高位空闲写入 client（Y.Map 同 key 冲突大者胜——从 uint32 顶向下找 live SV
 *  未占用的最高位；SV 客户端数有界〔单写者+import 序〕循环步数=在册 client 数）。 */
function pickWriterClientAbove(live: Y.Doc): number {
  // yjs 13.6：decodeStateVector 返回 Map<client, clock> 本体（无 .clients 壳——防御分支恒空=恒钉
  // 0xFFFFFFFF 的回归锚：二次 import 同 client 同 clock 被 SV 滤空=commitDiff 空）
  const taken = Y.decodeStateVector(Y.encodeStateVector(live)) as unknown as Map<number, number>;
  let c = 0xFFFFFFFF;
  while (taken.has(c) && c > 0) c -= 1;
  return c;
}

/** 信封静态校验出口（400 三族：形状/锚定/完整性——校验失败零 clone 零读库）。 */
function assertEnvelopeShape(envelope: DraftEnvelope, projectId: string): void {
  if (envelope == null || typeof envelope !== 'object') {
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_ENVELOPE', message: 'envelope 须为 DraftEnvelope 对象' });
  }
  if (envelope.projectId !== projectId) {
    // 「仅本人 draft」锚定面：信封必须指向路由项目（他人/他项目草稿拒收）
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_PROJECT_MISMATCH', message: `envelope.projectId=${String(envelope.projectId)} ≠ 路由项目 ${projectId}` });
  }
  if (envelope.schemaVersion !== CANVAS_DOC_SCHEMA_VERSION) {
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_SCHEMA_MISMATCH', message: `envelope.schemaVersion=${String(envelope.schemaVersion)} ≠ 当前 ${CANVAS_DOC_SCHEMA_VERSION}（schema 迁移=换代——新代 envelope 应由新代客户端导出）` });
  }
  if (!Array.isArray(envelope.nodes) || !Array.isArray(envelope.edges)) {
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_ENVELOPE', message: 'nodes/edges 须为数组' });
  }
  if (typeof envelope.draftId !== 'string' || envelope.draftId === '' || envelope.draftId.length > 128) {
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_ENVELOPE', message: 'draftId 须为非空 ≤128 字符 string' });
  }
}

function assertEnvelopeIntegrity(envelope: DraftEnvelope, rawBytes: number | undefined): void {
  if ((rawBytes ?? 0) > DRAFT_ENVELOPE_MAX_BYTES) {
    throw new PayloadTooLargeException({ code: 'RECOVERY_IMPORT_TOO_LARGE', message: `信封 ${rawBytes}B 超 ${DRAFT_ENVELOPE_MAX_BYTES}B 上限——导出文件+fail-closed 不开导入` });
  }
  const h = envelope.hashes;
  if (h == null || typeof h.nodes !== 'string' || typeof h.edges !== 'string') {
    throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_ENVELOPE', message: 'hashes 须含 nodes/edges 两 64hex' });
  }
  // 零填充占位（web subtle 缺席档）=完整性摘要不可得——跳过比对诚实放行（占位值恒不可伪造为实摘要碰撞）
  const isPlaceholder = (s: string) => s === '0'.repeat(64);
  if (!isPlaceholder(h.nodes) && !isPlaceholder(h.edges)) {
    const nodesHash = createHash('sha256').update(JSON.stringify(envelope.nodes)).digest('hex');
    const edgesHash = createHash('sha256').update(JSON.stringify(envelope.edges)).digest('hex');
    if (nodesHash !== h.nodes || edgesHash !== h.edges) {
      throw new BadRequestException({ code: 'RECOVERY_IMPORT_INTEGRITY_MISMATCH', message: '信封内容与 hashes 不符（传输损坏/篡改）' });
    }
  }
}

@Injectable()
export class CollabRecoveryImportService {
  /** 单飞台账（projectId→在飞 promise——并发后到 409；同 draftId 等待同结果）。 */
  private readonly inFlight = new Map<string, Promise<RecoveryImportResult>>();
  /** 单飞在飞 draftId（同 draftId 二连发=等待同结果非 409）。 */
  private readonly inFlightDraftIds = new Map<string, string>();
  /** 幂等结果表（pid␟draftId→{result,at}——TTL 有界淘汰）。 */
  private readonly results = new Map<string, { result: RecoveryImportResult; at: number }>();

  constructor(
    @Inject(CollabDocumentService) private readonly docs: CollabDocumentService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    /** 收口 I-5：生命周期观察器（staleFence 标记→下一帧批 presence 重播种）；@Optional=直构测试。 */
    @Optional() @Inject(CollabLifecycleObserverService) private readonly lifecycle?: CollabLifecycleObserverService | null,
  ) {}

  async importEnvelope(
    projectId: string,
    userId: string,
    envelope: DraftEnvelope,
    conflictChoices?: Partial<Record<string, NodeIdConflictPolicy>>,
    rawByteLength?: number,
    /** T25b 收口 I-3：B 场景删除确认经 typed REST 承载（禁 doc 写承载裁定）——用户显式确认删除
     *  的服务端现存节点 id 集（信封缺席面）；幂等：候选缺该 id=跳过（重复导入安全）。 */
    deletionNodeIds?: string[],
  ): Promise<RecoveryImportResult> {
    if (deletionNodeIds !== undefined
      && (!Array.isArray(deletionNodeIds) || deletionNodeIds.some((id) => typeof id !== 'string' || id === ''))) {
      throw new BadRequestException({ code: 'RECOVERY_IMPORT_BAD_BODY', message: 'deletionNodeIds 须为 string[]（B 场景删除确认面）' });
    }
    assertEnvelopeShape(envelope, projectId);
    // 收口 C-2（M-4 并入）：字节计量=Buffer.byteLength（utf8）——JSON.stringify().length 按 UTF-16
    // 码元计 CJK 低估 ~3×（红锚：3M 漢字 charCount<8MiB 放行/字节 9MiB 超限）。
    assertEnvelopeIntegrity(envelope, rawByteLength ?? Buffer.byteLength(JSON.stringify(envelope), 'utf8'));

    // 幂等回放（draftId 键——重试同结果）
    const resultKey = `${projectId}\u0000${envelope.draftId}`;
    const cached = this.results.get(resultKey);
    if (cached && Date.now() - cached.at < RESULT_TTL_MS) return { ...cached.result, resultReplayed: true };

    // 单飞（每项目同时一个导入在飞；同 draftId 在飞=等待同结果）
    const existing = this.inFlight.get(projectId);
    if (existing) {
      if (this.inFlightDraftIds.get(projectId) === envelope.draftId) return existing.then((r) => ({ ...r, resultReplayed: true }));
      throw new ConflictException({ code: 'RECOVERY_IMPORT_IN_FLIGHT', message: '该项目已有导入在飞（单飞——稍后重试）' });
    }

    const promise = this.runImport(projectId, userId, envelope, conflictChoices ?? {}, deletionNodeIds ?? [])
      .then((result) => {
        this.results.set(resultKey, { result, at: Date.now() });
        this.evictResults();
        return result;
      })
      .finally(() => {
        this.inFlight.delete(projectId);
        this.inFlightDraftIds.delete(projectId);
      });
    this.inFlight.set(projectId, promise);
    this.inFlightDraftIds.set(projectId, envelope.draftId);
    return promise;
  }

  private async runImport(
    projectId: string,
    userId: string,
    envelope: DraftEnvelope,
    choices: Partial<Record<string, NodeIdConflictPolicy>>,
    deletionNodeIds: string[],
  ): Promise<RecoveryImportResult> {
    // 维护窗口拒（4413 同源语义——REST 面 503+Retry-After 由全局 throttler/filter 层承载）。
    // 读面=canvas-doc-head 三态读（契约 1 豁免面——禁服务内直查 CanvasDoc 拼装载形态）。
    const head = await readCanvasDocHead(this.prisma, projectId);
    if (head.status === 'found' && head.row.maintenanceId) {
      throw new ServiceUnavailableException({ code: 'RECOVERY_IMPORT_MAINTENANCE', message: '维护窗口内禁导入（maintenance-freeze——稍后重试）' });
    }
    const docRow = head.status === 'found' ? { generation: head.row.generation } : null;

    return this.docs.withSession(projectId, (live) => {
      // ── 唯一允许 clone 的场所（§3.2）：候选=live 全量快照 clone（census ⑯：createCanvasDoc 工厂收编） ──
      const candidate = createCanvasDoc();
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(live));

      const existingIds = new Set<string>(live.getMap('nodes').keys());
      const existingEdgeIds = new Set<string>(live.getMap('edges').keys());
      const envelopeNodeIds = envelope.nodes.map((n) => n.id);
      const dispositions = resolveImportNodeConflicts(existingIds, envelopeNodeIds, choices);   // #9：冲突默认 skip
      const keep = new Set(dispositions.filter((d) => d.disposition !== 'skip').map((d) => d.nodeId));
      // 收口 I-6：同 id 边冲突默认 skip（#9 默认保守侧同律——既有边=协作者态，信封分叉端点禁静默
      // 覆盖；非冲突边照常导入）
      const edgeDispositions = envelope.edges.map((e) =>
        existingEdgeIds.has(e.id) ? { edgeId: e.id, disposition: 'skip' as const } : { edgeId: e.id, disposition: 'import' as const });
      const keepEdgeIds = new Set(edgeDispositions.filter((d) => d.disposition === 'import').map((d) => d.edgeId));

      // replace：先删候选既有节点（后 apply 覆盖——同 nodeId 替换非重映射）
      candidate.transact(() => {
        for (const d of dispositions) {
          if (d.disposition === 'replace') candidate.getMap('nodes').delete(d.nodeId);
        }
      });

      // 收口 I-3：删除确认先于信封并入（信封天然不含删除确认面节点——先删后并零复活；幂等：
      // 候选缺该 id=跳过。删除节点的触达边由下方悬挂边扫除段收敛报告）。
      // 微批 M-6：**先滤 deletionNodeIds ∩ envelope.nodes**（信封成员面归导入通道权威——手工
      // REST 携带交集 id 禁同批先删后并互杀/复活；滤除数进 deletions.filteredIntersection 报告）。
      const envelopeIdSet = new Set(envelope.nodes.map((n) => n.id));
      const effectiveDeletions = deletionNodeIds.filter((id) => !envelopeIdSet.has(id));
      const filteredIntersection = deletionNodeIds.length - effectiveDeletions.length;
      let deletionsApplied = 0;
      if (effectiveDeletions.length > 0) {
        candidate.transact(() => {
          for (const id of effectiveDeletions) {
            if (candidate.getMap('nodes').has(id)) {
              candidate.getMap('nodes').delete(id);
              deletionsApplied += 1;
            }
          }
        });
      }

      // 信封 typed 内容 → temp doc（rebuildCanvasDoc=canonical→Y 单源）→ diff 并入候选。
      // T25 收口根修（I-3 真因——「replace flake」）：Y.Map 同 key 冲突 clientID 大者胜——随机
      // client 的替换项对既有项五五开败北（tombstone 后键空=替换静默丢失，60 次微基准 100% 相关）。
      // 修=钉「高于 live 全部在册 client 的空闲位」写入（replace 项恒胜；逐 import 重算——多次
      // import 各占高位互不冲突）。
      const temp = rebuildCanvasDoc({
        nodes: envelope.nodes.filter((n) => keep.has(n.id)),
        edges: envelope.edges.filter((e) => keepEdgeIds.has(e.id)),
        meta: {},
      }, { clientID: pickWriterClientAbove(live) });
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(temp));

      // ── 图结构收口：悬挂边丢弃（「边指向缺失节点丢弃并报告」）+悬挂 parent 引用剥除 ──
      let danglingEdges = 0;
      let missingParentNodes = 0;
      candidate.transact(() => {
        const nodeIds = new Set<string>(candidate.getMap('nodes').keys());
        const edgesMap = candidate.getMap('edges');
        for (const [edgeId, em] of [...edgesMap.entries()] as Array<[string, Y.Map<unknown>]>) {
          const src = em.get('source');
          const tgt = em.get('target');
          if ((typeof src === 'string' && src !== '' && !nodeIds.has(src))
            || (typeof tgt === 'string' && tgt !== '' && !nodeIds.has(tgt))) {
            edgesMap.delete(edgeId);
            danglingEdges += 1;
          }
        }
        for (const [, nm] of [...candidate.getMap('nodes').entries()] as Array<[string, Y.Map<unknown>]>) {
          const parent = nm.get('parentId');
          if (typeof parent === 'string' && parent !== '' && !nodeIds.has(parent)) {
            nm.delete('parentId');
            missingParentNodes += 1;
          }
        }
      });

      // ── 全量校验（恢复流程非兼容层——L1 同表执法）：commitDiff 过 DENY 矩阵+XML 白名单 ──
      const commitDiff = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(live));
      const shape = validateFrameDeny(commitDiff);
      if (!shape.ok) {
        throw new BadRequestException({ code: 'RECOVERY_IMPORT_CONTENT_REJECTED', message: `候选内容违规（${shape.reason}）——恢复流程非兼容层` });
      }
      const xmlL1 = validateXmlL1(commitDiff, { allowedUrlHosts: RECOVERY_XML_URL_ALLOWED_HOSTS });
      if (!xmlL1.ok) {
        throw new BadRequestException({ code: 'RECOVERY_IMPORT_CONTENT_REJECTED', message: `候选 XML 违规（${xmlL1.reason}）` });
      }

      // ── commit：origin='import' 直写 live doc（分类计数=doc_update_origin_total{origin='import'}；
      //    persistence 维护队列承接 WAL/PG——与 writeBatch 维护档同链） ──
      if (commitDiff.byteLength > 0) Y.applyUpdate(live, commitDiff, 'import');

      // 收口 I-5：import 绕过 actor 帧管线（零 FrameEffects/零 NodeLifecycle 行）——同 doc 实例窗内
      // 导入节点起生成=deliveryFence unregistered fail-closed 拒。修=T26 R-1② form a 机制复用：
      // 事务后标记 staleFenceProjects——actor 任意下一帧批见标记重捕获 presence（同事务重对齐+清标记），
      // 播种自愈链闭合（形态论证：直接 seedPresence=第二写者与 actor flush 的 lifecycleSeq MAX+1
      // 分配无序〔T26 M-3 选型已否决〕；标记面=机制现成同语义——重对齐按 doc presence 真值）。
      if (commitDiff.byteLength > 0 && this.lifecycle) this.lifecycle.markStaleFence(projectId);

      return {
        edgeDispositions,
        /** T25b 收口 I-3：删除确认执行报告（requested=用户确认集；applied=候选现存实删——缺档幂等跳过） */
        deletions: { requested: deletionNodeIds.length, applied: deletionsApplied, filteredIntersection },
        confirmation: {
          contentCounts: { nodeCount: envelope.nodes.length, edgeCount: envelope.edges.length },
          droppedRefs: { danglingEdges, missingParentNodes },
          notRestored: { artifacts: true, executionHistory: true, billingRecords: true },
        },
        dispositions,
        resultReplayed: false,
        epoch: {
          envelopeGeneration: envelope.generation,
          envelopeHistoryId: envelope.historyId ?? '',
          crossGeneration: docRow != null && envelope.generation !== docRow.generation,
        },
      } satisfies RecoveryImportResult;
    }, { mode: 'read' });   // mode 语义见文件头注（origin 分类面）
  }

  private evictResults(): void {
    if (this.results.size <= 128) return;
    const cutoff = Date.now() - RESULT_TTL_MS;
    for (const [k, v] of this.results) if (v.at < cutoff) this.results.delete(k);
  }
}
