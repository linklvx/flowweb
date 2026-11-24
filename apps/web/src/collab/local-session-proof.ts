// apps/web/src/collab/local-session-proof.ts
// Y5 T6：客户端证明模块——/me 单函数+跨标签登出 epoch+suppressed 键（spec §0.3.3/§0.1.4）。
// 证明唯一载体=session 行 localDeadline（不另立 auth 表、不存服务器绝对时间）：
// localDeadline = Date.now() + (sessionExpiresAt − serverNow)，把证明长度钉死为服务器剩余寿命。
// 两个 localStorage 键串联：epoch 挡旧代次响应（登出先 +1）、suppressed 挡代次之后新发的请求
// （登出同步段写 1，putSessionRow 前复读）。storage 事件只挂 window 监听——登录代次不是文档
// 同步通道，不新开 BroadcastChannel。本函数不读 AuthProvider state（自持 epoch 快照）。
import {
  deleteSessionRow, getSessionRows, putSessionRow, snapshotFromUser,
} from './local-yjs-store';

const AUTH_EPOCH_KEY = 'flowweb:auth-epoch';
const AUTH_SUPPRESSED_KEY = 'flowweb:auth-suppressed';

/** 登出代次（localStorage 整数）：缺失/非整数一律 0。 */
export function readAuthEpoch(): number {
  const raw = localStorage.getItem(AUTH_EPOCH_KEY);
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isInteger(value) ? value : 0;
}

/** 登出同步段第一步：代次 +1 并写回（写动作天然触发他标签 storage 事件）。 */
export function bumpAuthEpoch(): number {
  const next = readAuthEpoch() + 1;
  localStorage.setItem(AUTH_EPOCH_KEY, String(next));
  return next;
}

/** suppressed=1 表示登出窗内（sign-out await 期间）：/me 200 不得写 session 行。 */
export function readAuthSuppressed(): boolean {
  return localStorage.getItem(AUTH_SUPPRESSED_KEY) === '1';
}

/** 登出同步段写 true；三处登录落地（表单/注册页跳转前/?auth=landed）写 false。 */
export function setAuthSuppressed(v: boolean): void {
  if (v) localStorage.setItem(AUTH_SUPPRESSED_KEY, '1');
  else localStorage.removeItem(AUTH_SUPPRESSED_KEY);
}

/** 删全表 session 行（200+null / 401 的显式否认路径——单活行下至多一行）。 */
async function deleteAllSessionRows(): Promise<void> {
  for (const row of await getSessionRows()) {
    await deleteSessionRow(row.uid);
  }
}

/** 双时间戳硬性（§0.3.3）：两个都必须是有限毫秒数，缺任一本次不改证明。 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * /me 单函数（每次 200 且带 user 的调用点，含 15min 探活）：
 * 发出记 epoch → 响应时 epoch 不符整体丢弃（不写不删，transient）→ 200+user 先复读
 * suppressed（true 则不写行直接返回 ok）→ 双时间戳齐才算证明；差值≤0 删行；缺字段不改证明。
 * 200+null / 401 = 显式否认删行；403/404（项目级路由归 T9）与无 status/408/429/5xx 均
 * transient 且不动行（Task 7 离线放行判据）。任何网络失败不抛出。
 */
export async function fetchMeWithProof(): Promise<
  { ok: true; user: object } | { ok: false; reason: 'null-user' | 'http-401' | 'transient' }
> {
  const epochAtSend = readAuthEpoch();
  let response: Response;
  try {
    // 与 AuthProvider/探活同款调用形态（不引入第二 HTTP 客户端）
    response = await fetch('/api/auth/me', { credentials: 'include' });
  } catch {
    return { ok: false, reason: 'transient' };
  }

  // 发出后代次已变（他标签/本标签登出）→ 响应整体丢弃，不写也不删 session 行
  if (readAuthEpoch() !== epochAtSend) return { ok: false, reason: 'transient' };

  if (response.status === 401) {
    await deleteAllSessionRows();
    return { ok: false, reason: 'http-401' };
  }
  if (response.status !== 200) {
    // 403/404 是项目级路由信号（T9），此处不当作证明来源；408/429/5xx 同属 transient
    return { ok: false, reason: 'transient' };
  }

  let data: { user?: object | null; sessionExpiresAt?: unknown; serverNow?: unknown };
  try {
    data = (await response.json()) as { user?: object | null; sessionExpiresAt?: unknown; serverNow?: unknown };
  } catch {
    return { ok: false, reason: 'transient' };
  }
  const user = data.user;
  if (user === null || user === undefined) {
    // 200+null = 无会话（auth.controller 的显式否认）→ 删行
    await deleteAllSessionRows();
    return { ok: false, reason: 'null-user' };
  }

  // suppressed（C2）：登出同步段之后新发的请求过得了 epoch 检查——写行前复读该键，
  // 为 true 时不写也不删已有行，直接返回 ok（请求本身是成功的）
  if (readAuthSuppressed()) return { ok: true, user };

  const { sessionExpiresAt, serverNow } = data;
  if (!isFiniteNumber(sessionExpiresAt) || !isFiniteNumber(serverNow)) {
    // 字段硬性：缺任一/非数字本次不改证明（禁用 now+7d 臆造）
    return { ok: true, user };
  }

  const userObj = user as Record<string, unknown>;
  const remainingMs = sessionExpiresAt - serverNow;
  if (remainingMs <= 0) {
    // 服务器侧会话已死——证明不成立，删行（不写负寿命行）
    await deleteSessionRow(userObj.id as string);
    return { ok: true, user };
  }
  await putSessionRow({
    uid: userObj.id as string,
    localDeadline: Date.now() + remainingMs,
    userSnapshot: snapshotFromUser(userObj),
  });
  return { ok: true, user };
}

/** 他标签登出（storage 事件 key=flowweb:auth-epoch）→ 拆协作会话回调；返回解绑。
 *  只按 key 匹配，不比较数值——一次 bump 恒有意义。 */
export function bindLogoutEpochTeardown(onEpochChange: () => void): () => void {
  const handler = (event: StorageEvent): void => {
    if (event.key !== AUTH_EPOCH_KEY) return;
    onEpochChange();
  };
  window.addEventListener('storage', handler);
  return () => { window.removeEventListener('storage', handler); };
}
