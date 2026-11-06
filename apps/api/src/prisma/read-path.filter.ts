// apps/api/src/prisma/read-path.filter.ts
// C4-a（plan Task C4-1 红⑦——生产就绪收尾批·project-erasure）：读路径过滤**单点注入**。
// tombstone-only 后 CanvasProject.lifecycleState≠ACTIVE（DELETING）行=用户态「不存在」：全仓
// CanvasProject **读操作**（findUnique/findFirst/findMany/count/OrThrow 族）经本 Proxy 单点注入
// `lifecycleState='ACTIVE'`——百余 project→读径（画布 GET/perm 解析/TeamGuard project 源/teamId
// 反查等）不逐点接线，项目级读径随行 404/列表零出现。
//
// 显式开关（plan：「admin/worker/erasure」）：**ALS 上下文开关** runWithIncludeDeleted（与
// project-lock.ts ErasureContextService.withErasure 同机制——异步链作用域，禁全局布尔）：
//  - admin 面：显式包裹（保留全量看 DELETING/FAILED——C4-c admin 面接线消费）；
//  - worker/erasure：ProjectErasureRunPoller 逐 run 包裹（DELETING 行是工作对象）。
// 作用域边界=泄漏防护（包裹外恢复过滤——与写锁门禁 ALS 标记同语义）。
//
// 形态裁定（Proxy 非 $extends）：PrismaService 构造器 custom return（与 writeGateProxy 同款——
// DI 全链以代理为实例）；$extends 返回新客户端对象需替换全仓注入类型面，Proxy 零涟漪。交互式
// $transaction 回调 tx 同包裹（tx 读径不旁路）；数组形态元素在构造期已过 delegate（读谓词注入
// 于 PrismaPromise 构造时）。写操作/其他模型恒直通——写径互斥=fence/锁序域（project-lock.ts 单源）。
//
// ═══ 关系嵌套读裁定（C4-b——P2-5 泄漏窗收口登记）══════════════════════════════════════════
// **能力边界（Prisma 5.22 实证）**：include/_count 嵌套关系读在 Prisma 引擎内部执行——**不经
// delegate 面**（本 Proxy 与 $extends query 钩子均不可拦截嵌套关系加载；Prisma 官方无嵌套关系读
// 拦截 API）。⇒ 裁定=**include 谓词注入**（可过滤处显式 where）+**白名单登记**（不可过滤处）：
//  - 已收口：team.getMyTeams `_count.projects where lifecycleState='ACTIVE'`（M-8）；
//  - 白名单（嵌套面不滤=设计语义）：Template.project（项目详情只读投影——详情入口已被顶层读
//    过滤 404 先行）、VideoProject.workflow（同——assertEditor 门先行）、team.projects 列举仅存
//    于 getMyTeams 计数（已滤）。新增「include CanvasProject 关系」面=同批补谓词或登记本处。
// read census（C4-b ㊳）=raw SQL CanvasProject 读点白名单（Proxy 旁路面机器执法）。
import { AsyncLocalStorage } from 'node:async_hooks';

/** 读作用域 ALS store（includeDeleted=true=admin/worker/erasure 链）。 */
const readScopeStorage = new AsyncLocalStorage<{ includeDeleted: boolean }>();

/** 显式开关：包裹链内 CanvasProject 读全量（含 DELETING/FAILED）——admin 面/worker/erasure 消费。 */
export function runWithIncludeDeleted<T>(fn: () => Promise<T>): Promise<T> {
  return readScopeStorage.run({ includeDeleted: true }, fn);
}

/** 当前链是否全量读（包裹外=false=默认过滤态）。 */
function includeDeletedReads(): boolean {
  return readScopeStorage.getStore()?.includeDeleted === true;
}

/** 受过滤读操作词表（CanvasProject delegate 面——aggregate/groupBy 现无调用点，出现即此处登记）。 */
const FILTERED_READ_OPS = new Set([
  'findUnique', 'findFirst', 'findMany', 'count', 'findUniqueOrThrow', 'findFirstOrThrow',
]);

/** where 注入：findMany/findFirst/count 族=AND 包裹既有谓词（不吞调用方条件）；findUnique 族=
 *  extendedWhereUnique 形态（唯一键须顶层——AND 包裹唯一条件不被识别）顶层并入。缺省 where=空对象档。 */
function injectLifecycleFilter(args: any, uniqueForm: boolean): any {
  const clause = { lifecycleState: 'ACTIVE' };
  const where = uniqueForm ? { ...(args?.where ?? {}), ...clause } : { AND: [args?.where ?? {}, clause] };
  return { ...args, where };
}

/** CanvasProject delegate 包裹：读操作注入 ACTIVE 谓词；写/其余直通。 */
function filteredDelegate(delegate: any): any {
  return new Proxy(delegate, {
    get(target, prop, receiver) {
      const raw = Reflect.get(target, prop, target);
      if (typeof prop !== 'string' || typeof raw !== 'function' || !FILTERED_READ_OPS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
            return async (...args: any[]) =>
                (raw as (...a: any[]) => Promise<any>).apply(
          delegate,
          includeDeletedReads() ? args : [injectLifecycleFilter(args[0], prop === 'findUnique' || prop === 'findUniqueOrThrow')],
        );
    },
  });
}

/**
 * 读路径过滤 Proxy：`canvasProject` delegate 包裹+交互式 `$transaction` 回调 tx 同包裹。
 * PrismaService 构造器消费（custom return——生产/测试态恒激活；与 writeGateProxy 组合时本过滤
 * 为外层：tx=读过滤(写门禁(rawTx))，读径在两种形态下同过滤）。
 */
export function applyReadPathFilter<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'canvasProject') {
        return filteredDelegate(Reflect.get(target, prop, target));
      }
      if (prop === '$transaction') {
                const raw = Reflect.get(target, prop, target) as (arg: any, opts?: any) => Promise<unknown>;
        return function gatedTransaction(this: unknown, arg: unknown, opts?: unknown): Promise<unknown> {
          if (typeof arg !== 'function') return raw.call(this, arg, opts);
                    return raw.call(this, (rawTx: any) => Promise.resolve(arg(applyReadPathFilter(rawTx))), opts);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
