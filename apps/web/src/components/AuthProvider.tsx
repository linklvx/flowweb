import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Role } from '@flowweb/shared';
import { setMediaCacheUserId, clearMediaUrlCache } from '@/utils/mediaUrlCache';  // v4：分层——认证组件不 import 媒体 hook
// Y0b-5 T5：登出 purge 本地缓存库（纯函数 fail-soft 模块——零 collab provider 依赖，分层同上）
import { purgeUidCaches } from '@/collab/local-cache-key';
// Y5 T7：本地优先证明接线（C1 离线放行/C2 登出同步段/跨标签 storage 监听）
import {
  bindLogoutEpochTeardown, bumpAuthEpoch, fetchMeWithProof, setAuthSuppressed,
} from '@/collab/local-session-proof';
import { deleteSessionRow, getSessionRows } from '@/collab/local-yjs-store';
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

  const refresh = async () => {
    try {
      // Y5 T7（C2）：登录落地清除点——先写 0 再请求（普通挂载不写）
      if (consumeAuthLandedParam()) setAuthSuppressed(false);
      const result = await fetchMeWithProof();
      if (result.ok) { setUser(result.user as unknown as User); return; }
      if (result.reason === 'transient') {
        // C1 离线放行：恰好一行且未过期才放行；缺失/过期/多行歧义一律 fail-closed
        const rows = await getSessionRows();
        if (rows.length === 1 && rows[0].localDeadline > Date.now()) {
          setUser(rows[0].userSnapshot as unknown as User);
          return;
        }
      }
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
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
    // Y0b-5 T5：登出/切用户清本 uid 全部本地缓存库（G27「登出经页面卸载路径复位」的缓存侧在
    // 登出动作点落位——destroyCollab 无法区分登出/切项目，无差别 purge 会误删他标签在用库）
    if (uid) {
      // ④ 本 uid session 行清理（names/bindings 行删除 API 未产出——三表清理归 Task 13；
      //    此处失败不回滚登出主链）
      try { await deleteSessionRow(uid); } catch { /* fail-soft：本地清理失败不阻断登出 */ }
      // Task 13 回填点：await purgeUidDbs(uid)（文档库删除+blocked→names 墓碑；实装见
      // local-yjs-store 计划接口）
    }
    clearMediaUrlCache();                  // 登出显式清空（spec：清空双挂点之一；R2b 补 page.tsx 项目切换分支）
    if (uid) void purgeUidCaches(uid);     // fail-soft（purge 不阻断登出主链）
  };

  const updateUser = (user: User) => setUser(user);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
