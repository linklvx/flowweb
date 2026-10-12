import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Role } from '@flowweb/shared';
import { setMediaCacheUserId, clearMediaUrlCache } from '@/utils/mediaUrlCache';  // v4：分层——认证组件不 import 媒体 hook
// Y0b-5 T5：登出 purge 本地缓存库（纯函数 fail-soft 模块——零 collab provider 依赖，分层同上）
import { purgeUidCaches } from '@/collab/local-cache-key';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      setUser(data.user || null);
    } catch { setUser(null); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  setMediaCacheUserId(user?.id ?? null);   // 渲染期镜像写入（幂等，不触发 React 更新——父 render 先于子树 render/effect）

  const logout = async () => {
    // Y0b-5 T5：登出/切用户清本 uid 全部本地缓存库（G27「登出经页面卸载路径复位」的缓存侧在
    // 登出动作点落位——destroyCollab 无法区分登出/切项目，无差别 purge 会误删他标签在用库）
    const uid = user?.id;
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
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
