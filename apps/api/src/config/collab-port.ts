// TD-32/C2 T16：端口解析单源（spec §4.2.1）——严格十进制、'0'=ephemeral、blank=未设回退。
// 使用点三处：collab.module（COLLAB_PORT 注入）/collab-server.factory（内层回退）/drill-server（DRILL_HTTP_PORT）。
export interface CollabPortEnv {
  NODE_ENV?: string;
  COLLAB_PORT?: number;
  COLLAB_ALLOW_EPHEMERAL?: '0' | '1';
}

/** 严格十进制（0x10/1e3/负号/带尾缀一律拒——静默回退会掩盖部署配置错误）；空串=未设→回退。 */
export function resolveCollabPort(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`端口值非法 "${raw}"：要求严格十进制整数 0-65535（禁 0x/科学记数/符号——fail-fast）`);
  }
  const port = Number(trimmed);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error(`端口值非法 "${raw}"：要求严格十进制整数 0-65535（fail-fast）`);
  }
  return port;
}

/** production ∧ COLLAB_PORT=0 拒启（ephemeral 口不对外服务）；drill/test 显式 COLLAB_ALLOW_EPHEMERAL=1 豁免。 */
export function assertProductionCollabPort(env: CollabPortEnv): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.COLLAB_PORT !== 0) return;
  if (env.COLLAB_ALLOW_EPHEMERAL === '1') return;
  throw new Error('production 禁止 COLLAB_PORT=0（ephemeral 口不对外——仅 drill/test 显式 COLLAB_ALLOW_EPHEMERAL=1）');
}
