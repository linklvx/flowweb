import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Role } from '@flowweb/shared';
import { setMediaCacheUserId, clearMediaUrlCache } from '@/utils/mediaUrlCache';  // v4：分层——认证组件不 import 媒体 hook
// Y0b-5 T5：登出 purge 本地缓存库（纯函数 fail-soft 模块——零 collab provider 依赖，分层同上）
import { purgeUidCaches } from '@/collab/local-cache-key';
// Y5 T7：本地优先证明接线（C1 离线放行/C2 登出同步段/跨标签 storage 监听）
import {
  bindLogoutEpochTeardown, bumpAuthEpoch, clearSessionRows, fetchMeWithProof,
  readAuthSuppressed, setAuthSuppressed,
} from '@/collab/local-session-proof';
import {
  deleteBindingRowsForUid, getSessionRows, purgeUidDbs,
} from '@/collab/local-yjs-store';
import { invokeCollabSessionTeardown } from '@/collab/auth-teardown-registry';

interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean;
  role?: Role; // DB 加列后 /me 必返回；可选以兼容测试 fixture
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType>(null!);

/** `?auth=landed` 一次性消费：仅微信回调重定向落地时出现。返回 true 表示本次挂载是登录
 *  落地（调用方须在证明调用前清 suppressed）；参数随即剥离，刷新不得重放（C2）。 */
function consumeAuthLandedParam(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get('auth') !== 'landed') return false;
  params.delete('auth');
  const query = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  );
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /** C1 离线放行腿（单点）：transient 或证明函数抛错时都走此判据。
   *  T7 评审 I2：suppressed=1 表示本标签已观测到登出（他标签 epoch 事件已 setUser(null)），
   *  此时即便证明行还在（发起标签的清表在 await 之后）也不得复活用户——fail-closed。 */
  const applyOfflinePass = async (): Promise<void> => {
    if (readAuthSuppressed()) { setUser(null); return; }
    try {
      const rows = await getSessionRows();
      if (rows.length === 1 && rows[0].localDeadline > Date.now()) {
        setUser(rows[0].userSnapshot as unknown as User);
        return;
      }
    } catch { /* 读失败按无证明处理 */ }
    setUser(null);
  };

  const refresh = async () => {
    try {
      // Y5 T7（C2）：登录落地清除点——先写 0 再请求（普通挂载不写）
      if (consumeAuthLandedParam()) setAuthSuppressed(false);
      let result: Awaited<ReturnType<typeof fetchMeWithProof>>;
      try {
        result = await fetchMeWithProof();
      } catch {
        // T7 评审 I3b：证明函数抛错（本地写/读炸）只算 transient，不当作 auth 否认
        await applyOfflinePass();
        return;
      }
      if (result.ok) { setUser(result.user as unknown as User); return; }
      if (result.reason === 'transient') { await applyOfflinePass(); return; }
      setUser(null);
    } catch { setUser(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  // Y5 T7：他标签登出（epoch storage 事件）→ 清本页用户态并拆本页协作会话；
  // 不写 session 行、不再次 bump（代次已由发起标签写过）
  useEffect(() => bindLogoutEpochTeardown(() => {
    setUser(null);
    invokeCollabSessionTeardown();
  }), []);

  setMediaCacheUserId(user?.id ?? null);   // 渲染期镜像写入（幂等，不触发 React 更新——父 render 先于子树 render/effect）

  const logout = async () => {
    const uid = user?.id;
    // Y5 T7（C2）同步段：任何 await 之前先 +1 代次并置 suppressed——在途/登出窗内新发的
    // /me 200 既过不了代次检查，也过不了写行前的 suppressed 复读（验收 28）
    bumpAuthEpoch();
    setAuthSuppressed(true);
    // I1：sign-out 失败（离线登出是本地优先的主场景）不得中断本地登出——忽略错误继续 ③④⑤。
    // 只有这一个 fetch 被包；bump/suppressed 仍在任何 await 之前。
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    } catch { /* 服务端 sign-out 失败：本地状态照样清（cookie 可能仍在，下次 /me 决定） */ }
    setUser(null);
    // Y0b-5 T5：登出/切用户清本 uid 全部本地缓存库（G27「登出经页面卸载路径复位」的缓存侧在
    // 登出动作点落位——destroyCollab 无法区分登出/切项目，无差别 purge 会误删他标签在用库）
    if (uid) {
      // Y5 T13（§0.6 登出行）：**先删文档库**（purgeUidDbs 需要 names 行做枚举源；删成功的行随删随去、
      // 删 blocked 的行改写 tombstone:true 留待下次启动直删——C4）。顺序反了会把枚举源先清空=库成
      // 孤儿，或把墓碑行一并删掉=blocked 重试机制失效。
      try {
        await purgeUidDbs(uid);
      } catch { /* fail-soft：本地清理失败不阻断登出 */ }
      // ④ 三表清理（§0.6 登出行）：整张 session 表（I5：单活行只在写时收敛，他 uid 残留行
      //    不得活过登出）+ 该 uid 的 bindings 行（残留 binding 指向已删库会让离线路径复活空库
      //    ——v4 A2）。names 行已由 purgeUidDbs 处理（含 blocked 的墓碑），**此处不再全量删**
      //    （deleteNameRowsForUid 会连墓碑一起清掉=C4 重试失效）。
      await Promise.all([
        clearSessionRows(),
        deleteBindingRowsForUid(uid),
      ]).catch(() => { /* fail-soft：本地清理失败不阻断登出 */ });
    }
    clearMediaUrlCache();                  // 登出显式清空（spec：清空双挂点之一；R2b 补 page.tsx 项目切换分支）
    if (uid) void purgeUidCaches(uid);     // 旧层 flowweb:collab: 库（T14 随层退役）
  };

  const updateUser = (user: User) => setUser(user);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
