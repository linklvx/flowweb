// apps/api/src/modules/collab/test-utils/collab-gateway-test-facade.ts
// Y0c T39b B0（Z140③ façade 按操作设计非按成员暴露；控制方裁决 RB2；落位 test-utils/=偏离 62④
// 勘正——RB2 原路径 modules/collab/ 顶层会被 nest build 编入 dist〔tsconfig 仅排除 *.spec.ts 与
// **/test-utils/**〕，test-utils 目录=仓内测试专用模块惯例〔lease-stub/doc-writer-stub 同址〕）。
// collab.gateway 测试专用 façade——**唯一 sanctioned 绕点**（内部单点受控 cast=internals()；
// 生产代码零 import，只被 *.spec.ts 消费）。门禁 check-collab-test-facade.mjs 的豁免依据=
// 本文件非 .spec.ts 后缀天然出扫描面（结构性豁免，脚本内 assert 自证）。
//
// 设计原则（Z140③）：
// - **按操作设计**：方法名=测试操作语义（seedPendingQueue/backdateLastCompactAt/spyListenServer），
//   非成员 1:1 暴露；每个方法注释「替代的成员访问形态」（波 2 机械替换对照面）。
// - **数组身份与 splice 语义保留**：pendingQueueRef 返回 Map 内真实数组引用（非复制）——
//   spec :697 toBe(firstRef)/:1331 toBe(before)/:1393 toBe(qBefore) 身份契约与 :1226/:1288
//   q.unshift 折并交织装置直接操作真实数组。
// - **类型单源**：读面字段类型经 CollabGateway['member'] 索引访问（TS 类型位私有成员合法——
//   gateway 成员演进时 façade 类型自动跟随=编译红漂移面）；写面 stub 入参宽松（unknown/object）
//   +内部受控 cast（本文件即 sanctioned 点）。
// - N=41 方法 vs 试点文件触达 M1=135 处（全域 M1=534/M2=87——收敛比见 T39b B0 报告）。
import { vi } from 'vitest';
import * as Y from 'yjs';
import type { CollabGateway } from '../collab.gateway';

/** gateway 内部成员镜像（测试触达面——类型索引访问单源；写面去 readonly 由 stub 方法内 cast 承担） */
interface GatewayInternals {
  pendingQueues: CollabGateway['pendingQueues'];
  docProject: CollabGateway['docProject'];
  persistRetry: CollabGateway['persistRetry'];
  persistUnhealthy: CollabGateway['persistUnhealthy'];
  retryingPersistDocs: CollabGateway['retryingPersistDocs'];
  lastCompactAt: CollabGateway['lastCompactAt'];
  flushScheduled: CollabGateway['flushScheduled'];
  inFlightProjects: CollabGateway['inFlightProjects'];
  writeFreeze: CollabGateway['writeFreeze'];
  collabState: CollabGateway['collabState'];
  initDone: CollabGateway['initDone'];
  shuttingDown: CollabGateway['shuttingDown'];
  logger: CollabGateway['logger'];
  eventEmitter: CollabGateway['eventEmitter'];
  spool: CollabGateway['spool'];
}

/** 唯一受控 cast 点（sanctioned——门禁豁免面本体） */
function internals(gw: CollabGateway): GatewayInternals {
  return gw as unknown as GatewayInternals;
}

/** 私有方法转发面（直调/替换/spy 对象——方法族经索引访问取签名，运行时 private 仅 TS 层面） */
type GatewayMethods = {
  startCollabAfterLease: CollabGateway['startCollabAfterLease'];
  selfIsolate: CollabGateway['selfIsolate'];
  listenCollab: CollabGateway['listenCollab'];
  listenServer: CollabGateway['listenServer'];
  recheckConnection: CollabGateway['recheckConnection'];
  reconcileSpool: CollabGateway['reconcileSpool'];
  schedulePersistRetry: CollabGateway['schedulePersistRetry'];
  cancelPersistRetry: CollabGateway['cancelPersistRetry'];
  retryPersist: CollabGateway['retryPersist'];
  transition: CollabGateway['transition'];
  closeAllConnections1012: CollabGateway['closeAllConnections1012'];
  storeDocumentSerialized: CollabGateway['storeDocumentSerialized'];
};

function methods(gw: CollabGateway): GatewayMethods {
  return gw as unknown as GatewayMethods;
}

export class GatewayTestFacade {
  constructor(private readonly gw: CollabGateway) {}

  // ── pendingQueues 族（替代形态：(gw as any).pendingQueues.get/set/has/delete——试点 56 处触达
  //    归并为 5 操作；身份引用=真实数组，禁复制） ──

  /** 替代 `(gw as any).pendingQueues.get(pid)`——返回 Map 内真实数组引用（身份契约承载面） */
  pendingQueueRef(pid: string): Uint8Array[] | undefined {
    return internals(this.gw).pendingQueues.get(pid);
  }

  /** 替代 `(gw as any).pendingQueues.get(pid)?.length ?? 0`（长度读归并） */
  pendingQueueLen(pid: string): number {
    return this.pendingQueueRef(pid)?.length ?? 0;
  }

  /** 替代 `(gw as any).pendingQueues.has(pid)` */
  pendingQueueHas(pid: string): boolean {
    return internals(this.gw).pendingQueues.has(pid);
  }

  /** 替代 `(gw as any).pendingQueues.set(pid, frames)`（Y19 projectId 键控装置播种） */
  seedPendingQueue(pid: string, frames: Uint8Array[]): void {
    internals(this.gw).pendingQueues.set(pid, frames);
  }

  /** 替代 `(gw as any).pendingQueues.delete(pid)`（条目丢失模拟/清场） */
  clearPendingQueue(pid: string): void {
    internals(this.gw).pendingQueues.delete(pid);
  }

  // ── docProject 族（替代两跳形态 .pendingQueues.get(.docProject.get(doc))） ──

  /** 替代 `(gw as any).docProject.get(doc)`（Y4 两跳第一跳） */
  docProjectOf(doc: Y.Doc): string | undefined {
    return internals(this.gw).docProject.get(doc);
  }

  /** 替代 `(gw as any).docProject.set(doc, pid)` */
  seedDocProject(doc: Y.Doc, pid: string): void {
    internals(this.gw).docProject.set(doc, pid);
  }

  /** 两跳归并：`(gw as any).pendingQueues.get((gw as any).docProject.get(doc))` 单操作化 */
  pendingQueueRefForDoc(doc: Y.Doc): Uint8Array[] | undefined {
    const pid = this.docProjectOf(doc);
    return pid === undefined ? undefined : this.pendingQueueRef(pid);
  }

  // ── persistRetry 族（退避梯台账） ──

  /** 替代 `(gw as any).persistRetry.get(name)`（entry={rung,timer}——timer 真值断言面） */
  persistRetryEntry(name: string): { rung: number; timer: ReturnType<typeof setTimeout> | null } | undefined {
    return internals(this.gw).persistRetry.get(name);
  }

  /** 替代 `(gw as any).persistRetry.has(name)` */
  persistRetryHas(name: string): boolean {
    return internals(this.gw).persistRetry.has(name);
  }

  /** 替代 `(gw as any).persistRetry.size`（BOI-2 fenced=终态禁梯断言面） */
  persistRetrySize(): number {
    return internals(this.gw).persistRetry.size;
  }

  /** 替代 `(gw as any).persistRetry.set(name, entry)`（FK 收割用例前置装置） */
  seedPersistRetry(name: string, entry: { rung: number; timer: ReturnType<typeof setTimeout> | null }): void {
    internals(this.gw).persistRetry.set(name, entry);
  }

  // ── 状态/台账族 ──

  /** 替代 `(gw as any).lastCompactAt.set(pid, ms)`（批3-4 compact 时间门回拨装置） */
  backdateLastCompactAt(pid: string, ms: number): void {
    internals(this.gw).lastCompactAt.set(pid, ms);
  }

  /** 替代 `(gw as any).lastCompactAt.has(pid)` */
  lastCompactAtHas(pid: string): boolean {
    return internals(this.gw).lastCompactAt.has(pid);
  }

  /** 替代 `(gw as any).persistUnhealthy.add(name)` */
  addPersistUnhealthy(name: string): void {
    internals(this.gw).persistUnhealthy.add(name);
  }

  /** 替代 `(gw as any).persistUnhealthy.has(name)` */
  persistUnhealthyHas(name: string): boolean {
    return internals(this.gw).persistUnhealthy.has(name);
  }

  /** 替代 `(gw as any).retryingPersistDocs?.add(name)`（I-2 per-doc 在飞集合装置） */
  addRetryingPersistDoc(name: string): void {
    internals(this.gw).retryingPersistDocs?.add(name);
  }

  /** 替代 `(gw as any).retryingPersist = true`（I-2 双形态装置红绿同源——旧代码单布尔字段，
   *  新代码字段不存在写幻影属性无害；语义=模拟旧代码在飞布尔被 A 项目置位的红相条件） */
  seedLegacyRetryingFlag(): void {
    (this.gw as unknown as Record<string, unknown>).retryingPersist = true;
  }

  /** 替代 `(gw as any).flushScheduled.has(pid)`（X10 软阈闩锁断言面） */
  flushScheduledHas(pid: string): boolean {
    return internals(this.gw).flushScheduled.has(pid);
  }

  /** 替代 `(gw as any).inFlightProjects.has(pid)`（X2 在飞口径断言面） */
  inFlightHas(pid: string): boolean {
    return internals(this.gw).inFlightProjects.has(pid);
  }

  /** 替代 `(gw as any).initDone`（V9 四步全成置位断言面；读=public getCollabState() 不入 façade） */
  isInitDone(): boolean {
    return internals(this.gw).initDone;
  }

  /** 替代 `(gw as any).collabState = state`（测试强置状态机——生产写点唯一 transition()，
   *  本操作=白盒装置非生产路径；state 值域同 collab.gateway.ts:32 CollabState） */
  forceCollabState(state: string): void {
    internals(this.gw).collabState = state as GatewayInternals['collabState'];
  }

  /** 替代 `(gw as any).shuttingDown = true`（V11 关停闸模拟——onApplicationShutdown 步骤 1 等价） */
  forceShuttingDown(): void {
    internals(this.gw).shuttingDown = true;
  }

  // ── writeFreeze 族（Q-A v5 冻结层单源） ──

  /** 替代 `(gw as any).writeFreeze.set(conn, { pid, reasons: new Set([...]) })`（连接形态装置） */
  seedWriteFreeze(conn: object, pid: string, reasons: string[]): void {
    const map = internals(this.gw).writeFreeze as unknown as Map<object, { pid: string; reasons: Set<string> }>;
    map.set(conn, { pid, reasons: new Set(reasons) });
  }

  /** 替代 `(gw as any).writeFreeze.get(conn)?.reasons.has(reason)` */
  hasWriteFreezeReason(conn: object, reason: string): boolean {
    const map = internals(this.gw).writeFreeze as unknown as Map<object, { pid: string; reasons: Set<string> }>;
    return map.get(conn)?.reasons.has(reason) ?? false;
  }

  // ── stub 族（依赖整体替换——白盒故障注入） ──

  /** 替代 `(gw as any).spool = fake`（清理钩子永不抛用例的内部依赖炸装置） */
  stubSpool(fake: unknown): void {
    (internals(this.gw) as { spool: unknown }).spool = fake;
  }

  /** 替代 `gw.transition = fn`（V11 终审收口用例的非法迁移捕获装置——transition 是方法，
   *  实例属性赋值遮蔽原型方法） */
  stubTransition(fn: (next: string, cause?: string) => void): void {
    (this.gw as unknown as Record<string, unknown>).transition = fn;
  }

  // ── spy 族（vi.spyOn 私有成员——字符串成员形态的门禁替代面） ──

  /** 替代 `vi.spyOn((gw as any).logger, level)` */
  spyLogger(level: 'error' | 'warn') {
    return vi.spyOn(internals(this.gw).logger, level);
  }

  /** 替代 `vi.spyOn((gw as any).eventEmitter, 'emit')` */
  spyEventEmit() {
    return vi.spyOn(internals(this.gw).eventEmitter, 'emit');
  }

  /** 替代 `vi.spyOn(gw as any, 'listenServer')`（W5 listen 单点断言面） */
  spyListenServer() {
    return vi.spyOn(methods(this.gw), 'listenServer');
  }

  /** 替代 `vi.spyOn(gw as any, 'closeAllConnections1012')`（1012 面免真关装置） */
  spyCloseAll1012() {
    return vi.spyOn(methods(this.gw), 'closeAllConnections1012');
  }

  /** 替代 `vi.spyOn(gw as any, 'storeDocumentSerialized')`（M-4(a) 排程计数白盒） */
  spyStoreSerialized() {
    return vi.spyOn(methods(this.gw), 'storeDocumentSerialized');
  }

  // ── 私有方法直调转发（测试驱动私有流程——操作即语义，签名经索引访问单源） ──

  /** 替代 `(gw as any).startCollabAfterLease()`（onAcquired 唯一入口直调） */
  startCollabAfterLease(): ReturnType<GatewayMethods['startCollabAfterLease']> {
    return methods(this.gw).startCollabAfterLease();
  }

  /** 替代 `(gw as any).selfIsolate(cause)`（G-3b 写路径隔离直调） */
  selfIsolate(...args: Parameters<GatewayMethods['selfIsolate']>): ReturnType<GatewayMethods['selfIsolate']> {
    return methods(this.gw).selfIsolate(...args);
  }

  /** 替代 `(gw as any).listenCollab()`（I4 rejoin 重入执行点） */
  listenCollab(): ReturnType<GatewayMethods['listenCollab']> {
    return methods(this.gw).listenCollab();
  }

  /** 替代 `(gw as any).recheckConnection(conn, name)`（H-5×E13 复验直调） */
  recheckConnection(...args: Parameters<GatewayMethods['recheckConnection']>): ReturnType<GatewayMethods['recheckConnection']> {
    return methods(this.gw).recheckConnection(...args);
  }

  /** 替代 `(gw as any).reconcileSpool()`（I4 收养回收闭环直调） */
  reconcileSpool(): ReturnType<GatewayMethods['reconcileSpool']> {
    return methods(this.gw).reconcileSpool();
  }

  /** 替代 `(gw as any).schedulePersistRetry(name)`（Y19 梯排程直调） */
  schedulePersistRetry(documentName: string): void {
    methods(this.gw).schedulePersistRetry(documentName);
  }

  /** 替代 `(gw as any).cancelPersistRetry(name)`（梯清场直调） */
  cancelPersistRetry(documentName: string): void {
    methods(this.gw).cancelPersistRetry(documentName);
  }

  /** 替代 `(gw as any).retryPersist(name)`（M-2 FK 收割直调） */
  retryPersist(documentName: string): ReturnType<GatewayMethods['retryPersist']> {
    return methods(this.gw).retryPersist(documentName);
  }

  /** 替代 `(gw as any).transition(next, cause)`（V33 状态机单点直调——非法迁移点名日志面） */
  transitionState(...args: Parameters<GatewayMethods['transition']>): void {
    methods(this.gw).transition(...args);
  }
}

/** 工厂（spec 消费形态：const g = gatewayFacade(kit.gateway)） */
export function gatewayFacade(gw: CollabGateway): GatewayTestFacade {
  return new GatewayTestFacade(gw);
}
