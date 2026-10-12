// apps/web/src/collab/local-cache-key.ts
// Y0b-5 T5：世代可见通道四维缓存键 + 本地缓存库 purge（T8 自研 IDB 适配器的键/清库单源——
// 本任务只落键合成与 purge 触发点，持久化实例归 T8 绑定）。
// 键布局=每 (uid,pid,generation,schemaVersion) 一库（库名=四维键）：
//   uid 隔离 origin 级越权（换账号不读他人库）；generation 隔离 F1 无限刷新循环/F2 静默投毒；
//   schemaVersion 隔离旧 schema 内容（O0b-0 rel→abs 翻转档禁按新 schema 解释）。
// purge 三形态（挂点语义分立）：
//   purgeForeignCaches——世代变化两路（同 uid:pid 异代库清理，当前键保留）；
//   purgePidCaches——terminal 无读权/项目删除/'team disbanded'（该 uid:pid 全部代——权限撤销后
//     本地副本仍在=看得见已无权画布，与 uid 隔离同类泄漏）；
//   purgeUidCaches——登出/切用户（该 uid 全部 pid）。
// 全部 fail-soft：能力不可用/枚举失败/单库删除阻塞均不抛不阻断（四维键世代隔离是正确性主锚，
// purge 是磁盘卫生层）；幂等（无匹配零动作）。
const DB_PREFIX = 'flowweb:collab:';

export interface LocalCacheKeyDims {
  uid: string;
  pid: string;
  generation: number;
  schemaVersion: number;
}

/** 四维键合成（纯函数）。uid/pid 为 cuid 字符集（不含 ':'）——分隔无歧义。 */
export function buildLocalCacheKey({ uid, pid, generation, schemaVersion }: LocalCacheKeyDims): string {
  return `${DB_PREFIX}${uid}:${pid}:g${generation}:s${schemaVersion}`;
}

/** 键逆解析（purge 判据维度）；非本族键/形状不符返回 null。 */
export function parseLocalCacheKey(key: string): LocalCacheKeyDims | null {
  if (!key.startsWith(DB_PREFIX)) return null;
  const m = /^(.+):(.+):g(\d+):s(\d+)$/.exec(key.slice(DB_PREFIX.length));
  if (!m) return null;
  return { uid: m[1], pid: m[2], generation: Number(m[3]), schemaVersion: Number(m[4]) };
}

/** deleteDatabase 单库删除（三回调均 resolve：成功/失败/被阻塞——blocked=他标签页持有连接，
 *  不悬挂等待，该库留待下次 purge；本页自身连接的「先 close 后 purge」义务归 T8 适配器
//（裁定 24⑥尾——多标签 purge 阻塞防线），本模块不持有连接）。 */
function deleteDatabaseQuietly(idb: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;   // onblocked 仅在 IDBOpenDBRequest（deleteDatabase 返回型）
    try {
      req = idb.deleteDatabase(name);
    } catch {
      resolve();
      return;
    }
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** 枚举库并按 matcher 删除。databases() 能力检测：不可用（旧 Safari/Firefox）→跳过（降级不阻断）。 */
async function purgeMatching(matcher: (name: string) => boolean): Promise<void> {
  const idb: IDBFactory | undefined = typeof indexedDB !== 'undefined' ? indexedDB : undefined;
  if (typeof idb?.databases !== 'function') return;
  let dbs: { name?: string }[];
  try {
    dbs = await idb.databases();
  } catch {
    return;   // 枚举失败=信息不可得——零删除返回（fail-soft）
  }
  for (const { name } of dbs) {
    if (typeof name !== 'string' || !matcher(name)) continue;
    await deleteDatabaseQuietly(idb, name);
  }
}

/** 世代变化路径：同 uid:pid 异代库清理（当前键保留——异 generation/schemaVersion 才删）。 */
export function purgeForeignCaches(currentKey: string): Promise<void> {
  const dims = parseLocalCacheKey(currentKey);
  if (!dims) return Promise.resolve();
  return purgeMatching((name) => {
    const d = parseLocalCacheKey(name);
    return d !== null && d.uid === dims.uid && d.pid === dims.pid && name !== currentKey;
  });
}

/** terminal 无读权/项目删除路径：该 uid:pid 全部代（含当前代）。 */
export function purgePidCaches(uid: string, pid: string): Promise<void> {
  return purgeMatching((name) => {
    const d = parseLocalCacheKey(name);
    return d !== null && d.uid === uid && d.pid === pid;
  });
}

/** 登出/切用户路径：该 uid 全部 pid 全部代。 */
export function purgeUidCaches(uid: string): Promise<void> {
  return purgeMatching((name) => {
    const d = parseLocalCacheKey(name);
    return d !== null && d.uid === uid;
  });
}
