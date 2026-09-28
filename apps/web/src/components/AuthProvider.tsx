import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Role } from '@flowweb/shared';
import { setMediaCacheUserId, clearMediaUrlCache } from '@/utils/mediaUrlCache';  // v4：分层——认证组件不 import 媒体 hook

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
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
    clearMediaUrlCache();                  // 登出显式清空（spec：清空双挂点之一；R2b 补 page.tsx 项目切换分支）
  };

  const updateUser = (user: User) => setUser(user);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
