import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';
import { loginUrl } from '@/utils/loginRedirect';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="text-text p-8 text-center">加载中...</div>;
  // 批2-3 收口：登录后回跳当前页（loginUrl 唯一真相源——next 白名单在 login 页收口）
  if (!user) return <Navigate to={loginUrl(location.pathname + location.search)} replace />;

  return <Outlet />;
}
