// apps/api/src/modules/collab/deletion-barrier.seal.ts
// C3b-4a（plan v3 Task C3b-4a——spec §3.4-4 :77 admission 面 1）：**进程内 admission seal 注册表
// （叶子模块——零本地 import）**。独立成文件的根因：seal 的消费面=SG 热路径（authenticate 最前/
// guardMessageFrame 帧闸）——若 SG import deletion-barrier.service（其 import 链 media-reference
// →referrer registry→media-gc.service→collab-document.service），则在 collab.gateway 模块求值中段
// 经 SG 把 document.service 提前拉入求值，@Inject(CollabGateway) 时刻 gateway 类未完成=token
// undefined（di-real-assembly 真装配红实证）。seal 注册表下沉叶子模块=零环零代价（屏障稀有事件，
// Map O(1) 查——barrier 行翻/清经 deletion-barrier.service 同进程调用）。
// 生命周期：acquire 后置翻（DeletionBarrierService.prepare）/release 清（barrierId 守卫）/惰性过期
//（expiresAt 过即不封——api 进程崩溃=seal 随进程灭，DB 行由 acquire 原位接管兜底）。
// 前视注记（质量评审 M1——单实例 ADR 前提）：**双 api 实例部署时面 1 seal 跨进程不可见**（本注册表
// 进程内——A 实例 acquire 的 seal 对 B 实例的 SG 恒 false）；面 2 appendBatch DB 探针仍全域有效
//（正确性底线不破，代价=B 实例帧经面 2 拒后留队重试）——扩实例须把面 1 改 DB 判定（或共享缓存面）。

/** seal 台账：teamId → {barrierId, pids, expiresAt(ms), acquiredAt(ms)}——pid 反查 Map 免全扫。 */
const sealByTeam = new Map<string, { barrierId: string; pids: ReadonlySet<string>; expiresAt: number; acquiredAt: number }>();
const sealTeamByPid = new Map<string, string>();

/** acquire 后置翻 seal（覆盖同 team 旧过期条目——原位接管/清旧一并进行）。 */
export function sealAdmission(teamId: string, barrierId: string, pids: readonly string[], expiresAtMs: number): void {
  unsealAdmission(teamId, sealByTeam.get(teamId)?.barrierId ?? '');
  sealByTeam.set(teamId, { barrierId, pids: new Set(pids), expiresAt: expiresAtMs, acquiredAt: Date.now() });
  for (const pid of pids) sealTeamByPid.set(pid, teamId);
}

/** barrierId 守卫解封（stale release 不得解后继 barrier 的 seal）——返回持有时长（gauge 置值面）。 */
export function unsealAdmission(teamId: string, barrierId: string): { heldSeconds: number } | null {
  const entry = sealByTeam.get(teamId);
  if (!entry || (barrierId !== '' && entry.barrierId !== barrierId)) return null;
  sealByTeam.delete(teamId);
  for (const pid of entry.pids) if (sealTeamByPid.get(pid) === teamId) sealTeamByPid.delete(pid);
  return { heldSeconds: (Date.now() - entry.acquiredAt) / 1000 };
}

/** 面 1 判定（SG authenticate/guardMessageFrame 消费）——惰性过期（expiresAt 过即不封）。 */
export function isDeletionBarrierSealed(pid: string): boolean {
  const teamId = sealTeamByPid.get(pid);
  if (teamId === undefined) return false;
  const entry = sealByTeam.get(teamId);
  if (entry === undefined || entry.expiresAt <= Date.now()) return false;
  return entry.pids.has(pid);
}
