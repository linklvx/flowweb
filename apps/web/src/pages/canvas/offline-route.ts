// apps/web/src/pages/canvas/offline-route.ts
// Y5 T9：项目请求失败后的离线分型路由（纯函数——无 React/store/网络/时钟读取）。
// 决定表（优先级自上而下，spec §0.2 步 1）：
//   1. 401 ⇒ http-expired（现有 httpExpired 行为；本地三合取再全也不得覆盖显式否认）
//   2. 403/404 ⇒ no-read-access（保持既有无权/不存在分支）
//   3. 无 projectId ⇒ unavailable（无本地项目可开——禁 createUntitledProject）
//   4. 仅瞬态失败（无 status/408/429/5xx）继续；其余状态 ⇒ unavailable
//   5. session 表必须恰一行且 localDeadline > now（缺失/过期/多行一律 fail-closed）
//   6. binding 三合取：binding 存在 ∧ binding.uid===session.uid ∧ historyId===binding.historyToken
//   7. 全成立 ⇒ open-local（name/teamId 取 binding——验收 17）

/** 离线分型决定（本任务只产出决定，页面接线在 T10）。 */
export type OfflineRouteDecision =
  | { kind: 'http-expired' }
  | { kind: 'no-read-access' }
  | { kind: 'unavailable' }
  | {
      kind: 'open-local';
      binding: {
        uid: string;
        generation: number;
        schemaVersion: number;
        historyToken: string;
        name: string;
        teamId: string | null;
      };
    };

export interface OfflineRouteInput {
  projectId: string | null;
  /** 失败项目请求的 HTTP 状态；undefined=无状态（网络错误/超时）。 */
  status: number | undefined;
  /** meta 库读出的全部 session 行（0/1/多行）。 */
  sessionRows: Array<{ uid: string; localDeadline: number; userSnapshot: unknown }>;
  /** (uid,pid) 的 binding 行；调用方按 session uid 查过，缺失为 null。 */
  binding: {
    uid: string;
    generation: number;
    schemaVersion: number;
    historyToken: string;
    name: string;
    teamId: string | null;
  } | null;
  /** localStorage 的全局单一 collab history id；缺失 undefined。 */
  historyId: string | undefined;
  now: number;
}

/** 瞬态失败判定：无状态/408/429/5xx 才允许走本地开库（400/402/409 等一律「暂不可用」）。 */
function isTransient(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export function decideOfflineRoute(input: OfflineRouteInput): OfflineRouteDecision {
  const { projectId, status, sessionRows, binding, historyId, now } = input;

  // 1/2：服务端显式否认优先——任何本地凭证都不能翻案
  if (status === 401) return { kind: 'http-expired' };
  if (status === 403 || status === 404) return { kind: 'no-read-access' };

  // 3：无 projectId 无本地项目可开——停「暂不可用」，绝不新建
  if (projectId === null) return { kind: 'unavailable' };

  // 4：非瞬态失败（如 400/402/409）不是离线场景
  if (!isTransient(status)) return { kind: 'unavailable' };

  // 5：session 单活行且未过期（缺失/过期/多行全 fail-closed）
  if (sessionRows.length !== 1) return { kind: 'unavailable' };
  const session = sessionRows[0];
  if (session.localDeadline <= now) return { kind: 'unavailable' };

  // 6：binding 三合取——行存在+uid 同源+historyId 与 historyToken 对齐
  if (binding === null) return { kind: 'unavailable' };
  if (binding.uid !== session.uid) return { kind: 'unavailable' };
  if (historyId === undefined || historyId !== binding.historyToken) return { kind: 'unavailable' };

  // 7：六字段逐项回传（name/teamId 来自 binding——验收 17）
  return {
    kind: 'open-local',
    binding: {
      uid: binding.uid,
      generation: binding.generation,
      schemaVersion: binding.schemaVersion,
      historyToken: binding.historyToken,
      name: binding.name,
      teamId: binding.teamId,
    },
  };
}
