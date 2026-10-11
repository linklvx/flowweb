/** Y0b-3 T7（P-L）：collab identity 配色单源——COLORS+hash*31 从 apps/web/src/collab/awareness.ts:26-30
 *  原样挪入（api/web 两端 import 同一函数）：服务端 serverIdentityOf 注入 user.color、客户端消费面
 *  读 s.user.color——禁第二实现（fallback 双源驳回：同源算法迁移=等价性保证）。 */
export const COLLAB_USER_COLORS = ['#5DDCFF', '#FF7A9E', '#9EFF8A', '#FFC56D', '#C39EFF', '#7AD7FF'] as const;

export function userColorOfUserId(userId: string | undefined = ''): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return COLLAB_USER_COLORS[Math.abs(hash) % COLLAB_USER_COLORS.length];
}
