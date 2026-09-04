import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Role } from '@flowweb/shared';

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

  const logout = async () => {
    await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'include' });
    setUser(null);
  };

  const updateUser = (user: User) => setUser(user);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
