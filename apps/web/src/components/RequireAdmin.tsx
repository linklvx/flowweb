import { Navigate, Outlet } from 'react-router';
import { Result, Button, Spin } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@flowweb/shared';

export function RequireAdmin() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="flex justify-center p-16"><Spin /></div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin(user.role)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="需要管理员权限"
        extra={<Button type="primary" href="/">返回首页</Button>}
      />
    );
  }
  return <Outlet />;
}
