// apps/api/src/modules/collab/project-lock.ts
// C1-0（plan Task C1-0——生产就绪收尾批，spec v5 R15/R17）：项目/团队维锁与 fence 单源。
// 自 canvas-doc-update.repository.ts private lockProject 抽出（P23/V26 键单源承继——appendBatch/
// vacuumReplace 两调用方改引，键字节不变）+fenceProject/fenceTeam（FOR SHARE 行锁读）+lockScope
// （scope 维串行化）+ErasureContextService（ALS）+写锁门禁（registry 驱动·测试态 AsyncLocalStorage 断言）。
//
// ═══ 锁序单源（全路径唯一序——乱序取锁即死锁面，禁第二序）═════════════════════════════════
//   ① advisory xact 锁（lockProject/lockScope——事务首语句）
//   ② Team 行锁读（fenceTeam——SELECT status FOR SHARE）
//   ③ CanvasProject 行锁读（fenceProject——SELECT lifecycleState FOR SHARE）
//   ④ 业务行（业务表写）
// xact 锁=事务结束即释放（「持锁跨 stage」不可达——R15：tombstone 行=持久 fence 而非锁）。
//
// ═══ 写锁门禁（R15 机器化禁人记）═════════════════════════════════════════════════════════
// 测试态（vitest/NODE_ENV=test）PrismaService 层 Proxy 自包裹（writeGateProxy）：guarded 模型的
// 非 DELETE 写操作（create/update/upsert/createMany/updateMany 等）在当前 ALS store 无锁标记时即抛
// WriteLockRequiredError——「$transaction 首句 lockProject→同事务查 fence 行→无行才写」纪律的机器执法。
// registry 初始为空（登记面=C4-2 census 接线）→ 生产态直通零开销+测试态既有面零行为。
// DELETE/deleteMany 恒放行（fence 层规则——删除属擦除域合法操作面）；ALS 标记随 $transaction
// 包裹器 run() 作用域生灭（事务结束不残留外层链——泄漏防护由作用域边界承担）。
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** 门禁激活判据（测试态=vitest 进程∨NODE_ENV=test；生产态零开销直通——激活条件单源）。 */
export function writeGateActive(): boolean {
  return process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
}

/** ALS 锁标存储：Set<scopeKey>——门禁事务包裹器内建 store，lock/fence 取锁成功即打标。 */
const writeGateStorage = new AsyncLocalStorage<Set<string>>();

/** 打标：取锁成功后调用。store 不在=事务外/未门禁链——advisory xact 锁随语句事务已释放，
 *  禁虚标（标记谎称持锁比无锁更危险——门禁判据失真）。 */
function markLockHeld(scopeKey: string): void {
  const marks = writeGateStorage.getStore();
  if (marks) marks.add(scopeKey);
}

/** 门禁锁标 scope 键（门禁内部命名——非 docName 面）：经 scopeType 插值构造，与
 *  projectDocName（doc-name.util 单源）词法解耦——census ㉚ 裸构造门只辖 docName 构造面。 */
function lockMarkKey(scopeType: string, scopeId: string): string {
  return `lock:${scopeType}:${scopeId}`;
}

/** 门禁判据：guarded 模型非 DELETE 写操作，当前链无锁标记即抛（fail-closed）。
 *  注：判据=「本链取过锁」而非 scope 精确匹配——args.where 提取与模型级 scope 映射归 C4-2 census 接线。 */
function assertLockHeldForWrite(model: string, operation: string): void {
  const marks = writeGateStorage.getStore();
  if (marks == null || marks.size === 0) {
    throw new WriteLockRequiredError(model, operation);
  }
}

/** guarded 写模型登记面（初始为空——C4-2 census 接线填充；红⓪ 测试内注册证双分支）。
 *  返回 restore：测试用后即弃（防模块级 registry 泄漏跨用例）。 */
const guardedWriteModels = new Set<string>();
export function registerGuardedWriteModels(models: Iterable<string>): () => void {
  const added: string[] = [];
  for (const m of models) {
    if (!guardedWriteModels.has(m)) { guardedWriteModels.add(m); added.push(m); }
  }
  return () => { for (const m of added) guardedWriteModels.delete(m); };
}

/** 门禁断言面=非 DELETE 写操作词表（delete/deleteMany 恒放行——fence 层规则；读操作恒放行）。 */
const WRITE_GATE_MUTATION_OPS = new Set([
  'create', 'update', 'upsert', 'createMany', 'updateMany',
  'createAndReturn', 'updateAndReturn', 'createManyAndReturn', 'updateManyAndReturn',
]);

/** 无锁写入即抛（测试态 fail-closed——纪律=$transaction 首句 lockProject、fenceProject、fenceTeam、lockScope 先行）。 */
export class WriteLockRequiredError extends Error {
  constructor(readonly model: string, readonly operation: string) {
    super(`写锁门禁：guarded 模型 ${model}.${operation} 无锁写入（测试态 fail-closed——写事务首语句 lockProject/fenceProject/fenceTeam/lockScope 先行；登记面=C4-2 census 接线）`);
    this.name = 'WriteLockRequiredError';
  }
}

/** scope 擦除中专用错误（R15 fence 规则 a——app 写路径非 ACTIVE 即抛；HTTP 映射归 C4）。 */
export class ProjectErasingError extends Error {
  constructor(readonly scopeType: 'project' | 'team', readonly scopeId: string, readonly state: string) {
    super(`PROJECT_ERASING：${scopeType} ${scopeId} 擦除进行中（lifecycleState/status=${state}）——该 scope 写路径拒绝（ErasureContext 内豁免擦除态=worker 唯一合法写者；HTTP 映射归 C4）`);
    this.name = 'ProjectErasingError';
  }
}

/** raw SQL 事务客户端最小结构面（lockProject/lockScope 消费——$executeRaw 语义锚）。 */
export type LockableTx = { $executeRaw: (q: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> };
/** 行锁读事务客户端最小结构面（fenceProject/fenceTeam 消费——$queryRaw 泛型语义锚：
 *  PrismaService/TransactionClient/stub 三面可赋——PrismaPromise<T>⊆Promise<T>）。 */
export type FenceTx = { $queryRaw: <T = unknown>(q: TemplateStringsArray, ...values: unknown[]) => Promise<T> };

/** per-project advisory xact 锁（**键字节单源**：`hashtext(${projectId})::bigint`——T12 锚，与 CLI
 *  collab-renumber-layer.mjs 同键互斥；抽出前 canvas-doc-update.repository 两调用方同键，键零变化）。
 *  xact 域=事务结束自动释放；同事务重入 no-op（PG advisory 可重入）。事务外调用锁随语句即释——
 *  不打标（markLockHeld 无 store 即弃），门禁下事务外后写仍拒（truthful 语义）。 */
export async function lockProject(tx: LockableTx, projectId: string): Promise<unknown> {
  const r = await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId})::bigint)`;
  markLockHeld(lockMarkKey('project', projectId));
  return r;
}

/** scope 维 advisory xact 锁（team 维/erasure 请求级串行化）。键空间与 lockProject 不相交：
 *  `scope:` 前缀区分（projectId=cuid 无冒号——两域恒不相交；hashtext 键=字符串全文）。 */
export async function lockScope(tx: LockableTx, scopeType: string, scopeId: string): Promise<unknown> {
  const scopeKey = `scope:${scopeType}:${scopeId}`;
  const r = await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeKey})::bigint)`;
  markLockHeld(scopeKey);
  return r;
}

/** ErasureContext（ALS）：擦除 worker 上下文——withErasure 包裹器内 currentErasingRunId()!=null。
 *  C1-0 只建机制（建好即编译面完成），C4 worker 接线消费；fence 豁免判据单源。 */
const erasureContextStorage = new AsyncLocalStorage<{ erasingRunId: string }>();

/** 当前擦除运行（本异步链）——fenceProject/fenceTeam 豁免判据（非 null=worker 擦除上下文内）。 */
export function currentErasingRunId(): string | null {
  return erasureContextStorage.getStore()?.erasingRunId ?? null;
}

@Injectable()
export class ErasureContextService {
  /** 包裹 erasure worker 执行链（C4 接线：manifest 采集/介质批删/状态机推进全链在 ctx 内）。
   *  ctx 内 DELETING（project）/DISBANDING（team）态写放行——worker=唯一合法擦除态写者。 */
  withErasure<T>(erasingRunId: string, fn: () => Promise<T>): Promise<T> {
    return erasureContextStorage.run({ erasingRunId }, fn);
  }
}

/** ═══ fence 规则三句（R15 单源——runbook §13 承 C4-c，本注释=代码侧钉死）═════════════
 *  a) 非 ACTIVE 抛 ProjectErasingError（app 写路径拒绝——project=DELETING/team=DISBANDING∪DISBANDED）；
 *  b) ErasureContext 内豁免擦除态（project=DELETING/team=DISBANDING——**worker=唯一合法擦除态写者**）；
 *  c) 行缺失折 ACTIVE（FK 守卫域——真缺失行随写 FK 失败，fence 不须双报）。
 *  FOR SHARE 行锁读=并发写序列化点（擦除态置位〔行 UPDATE〕与 app 写事务在此互斥排队）；
 *  DELETE/deleteMany 恒放行（删除属擦除域合法操作面）。census 闭包+别名登记+门禁填充清单=
 *  scope-column.registry.ts 单源（CI ㊲ diff——新增表/列未登记即红）。 */
function assertScopeActiveOrErasing(
  scopeType: 'project' | 'team', scopeId: string,
  state: string | null, erasingState: string,
): void {
  const s = state ?? 'ACTIVE';
  if (s === 'ACTIVE') return;
  if (s === erasingState && currentErasingRunId() != null) return;
  throw new ProjectErasingError(scopeType, scopeId, s);
}

/** CanvasProject fence（FOR SHARE 行锁读——lifecycleState 非 ACTIVE 即拒；DELETING 仅
 *  ErasureContext 内放行）。消费面：project/team-scoped 写事务（C4 四入口接线——事务内
 *  lockProject 首句后随行调用，本卡只建机制不接线）。 */
export async function fenceProject(tx: FenceTx, projectId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ lifecycleState: string | null }[]>`
    SELECT "lifecycleState" FROM "CanvasProject" WHERE "id" = ${projectId}::text FOR SHARE`;
  markLockHeld(lockMarkKey('project', projectId));
  assertScopeActiveOrErasing('project', projectId, rows[0]?.lifecycleState ?? null, 'DELETING');
}

/** Team fence（FOR SHARE 行锁读——status 非 ACTIVE 即拒：DISBANDING=擦除进行态（本批笔一加值）、
 *  DISBANDED=已解散终态恒拒）。 */
export async function fenceTeam(tx: FenceTx, teamId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ status: string | null }[]>`
    SELECT "status" FROM "Team" WHERE "id" = ${teamId}::text FOR SHARE`;
  markLockHeld(lockMarkKey('team', teamId));
  assertScopeActiveOrErasing('team', teamId, rows[0]?.status ?? null, 'DISBANDING');
}

// ═══ 门禁 Proxy（测试态 PrismaService 自包裹消费——生产态 writeGateProxy 直通原 client）═══════

/** guarded 模型 delegate 包裹：非 DELETE 写操作过 assertLockHeldForWrite，读/DELETE 直通。
 *  async 包装使断言 throw 归一为 rejected promise（await 面统一）。 */
function writeGateDelegate(model: string, delegate: object): object {
  return new Proxy(delegate, {
    get(target, prop) {
      const raw = Reflect.get(target, prop, target);
      if (typeof raw !== 'function' || typeof prop !== 'string' || !WRITE_GATE_MUTATION_OPS.has(prop)) {
        return raw;
      }
      return async (...args: unknown[]) => {
        assertLockHeldForWrite(model, prop);
        // 评审加固（2026-11-05 Important）：delegate 方法以 delegate 为 this 调用（.apply 显式绑定）——
        // Prisma 5.22 model action 现为闭包捕获 client 无 this 依赖，属未成文外部不变量；红⓪ 的
        // vi.fn stub 锁不住 this 面，C4-2 registry 填充后 guarded 写首穿此包装打真 Prisma。
        return (raw as (...a: unknown[]) => Promise<unknown>).apply(delegate, args);
      };
    },
  });
}

/** $transaction 门禁包裹：交互式（回调）形态在 ALS run(new Set) 作用域内执行——事务内
 *  lock/fence 打标→写放行；事务结束 run 退出→标记不残留外层链（泄漏防护=作用域边界）。
 *  数组形态直传（元素构造期已过 delegate 门禁面——数组事务无首句锁位=guarded 写即抛，
 *  fail-closed 语义一致）。嵌套事务继承外层标记（seed=外层集拷贝——合法嵌套写不误伤）。 */
function writeGateTransaction(raw: (arg: unknown, opts?: unknown) => Promise<unknown>) {
  return function gatedTransaction(this: unknown, arg: unknown, opts?: unknown): Promise<unknown> {
    if (typeof arg !== 'function') return raw.call(this, arg, opts);
    const seed = writeGateStorage.getStore();
    return writeGateStorage.run(new Set(seed), () =>
      raw.call(
        this,
        (rawTx: object) => Promise.resolve((arg as (tx: object) => Promise<unknown>)(writeGateProxy(rawTx))),
        opts,
      ));
  };
}

/** 写锁门禁 Proxy：guarded 模型 delegate 包裹 + $transaction ALS 作用域包裹；其余全直通。
 *  测试态激活（PrismaService 构造器消费）；生产态原 client 直返（零开销）。 */
export function writeGateProxy<T extends object>(client: T): T {
  if (!writeGateActive()) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return writeGateTransaction(
          Reflect.get(target, prop, target) as unknown as (arg: unknown, opts?: unknown) => Promise<unknown>,
        );
      }
      if (typeof prop === 'string' && guardedWriteModels.has(prop)) {
        return writeGateDelegate(prop, Reflect.get(target, prop, target) as object);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}