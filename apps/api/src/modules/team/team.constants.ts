/** 免费版（无 active 订阅）限额——付费档位从 TeamPlan 现算（Task 10 getLimits 统一） */
export const TEAM_FREE_SEAT_LIMIT = 20;
export const TEAM_FREE_STORAGE_LIMIT_BYTES = 6 * 1024 * 1024 * 1024; // 6GiB

/** 团队订单号（Y1c T34 根修自 team-recharge.service 迁入——解 team-subscription ↔ team-recharge
 *  文件环：环下 @Inject(TeamSubscriptionService) 装饰元数据依加载序为 undefined（di-smoke.int 3/3 红
 *  实锤；worker.module:28 求值序锚为同环 workaround）；纯函数零依赖归本文件，两消费方同源单份。 */
export function generateTeamOrderNo(): string {
  const ts = Date.now().toString();
  const random = Math.floor(Math.random() * 100000).toString().padStart(6, '0');
  return `TEAM${ts}${random}`;
}
