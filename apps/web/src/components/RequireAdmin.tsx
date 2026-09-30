import { Navigate, Outlet, useLocation } from 'react-router';
import { Result, Button, Spin } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@flowweb/shared';
import { loginUrl } from '@/utils/loginRedirect';

export function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="flex justify-center p-16"><Spin /></div>;
  }
  // 批2-3 收口：登录后回跳当前页（loginUrl 唯一真相源）
  if (!user) return <Navigate to={loginUrl(location.pathname + location.search)} replace />;
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
