import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) return <div className="text-[#ccc] p-8 text-center">加载中...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}
