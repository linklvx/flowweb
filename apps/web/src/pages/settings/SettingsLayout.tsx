import { NavLink, Outlet, useNavigate } from 'react-router';
import { useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Navbar } from '@/pages/home/components/Navbar';

export function SettingsLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = useCallback(async () => {
    navigate('/');
    await logout();
  }, [logout, navigate]);

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col overflow-x-hidden">
      <Navbar />
      <div className="flex-1 mx-auto max-w-[1640px] px-5 md:px-10 lg:px-[120px] w-full pt-6">
        <div className="flex h-full min-w-0">
          <nav className="w-48 flex-shrink-0 bg-[#1A1A1A] border-r border-[#333] flex flex-col py-4">
            <NavLink
              to="/settings/profile"
              className={({ isActive }) =>
                `px-4 py-2 text-sm no-underline transition-colors ${
                  isActive ? 'text-[#4ade80] bg-[#4ade80]/10 border-r-2 border-[#4ade80]' : 'text-[#888] hover:text-[#ccc]'
                }`
              }
            >
              个人资料
            </NavLink>
            <NavLink
              to="/settings/credits"
              className={({ isActive }) =>
                `px-4 py-2 text-sm no-underline transition-colors ${
                  isActive ? 'text-[#4ade80] bg-[#4ade80]/10 border-r-2 border-[#4ade80]' : 'text-[#888] hover:text-[#ccc]'
                }`
              }
            >
              积分与余额
            </NavLink>
            <NavLink
              to="/settings/membership"
              className={({ isActive }) =>
                `px-4 py-2 text-sm no-underline transition-colors ${
                  isActive ? 'text-[#4ade80] bg-[#4ade80]/10 border-r-2 border-[#4ade80]' : 'text-[#888] hover:text-[#ccc]'
                }`
              }
            >
              会员中心
            </NavLink>
            <div className="mt-auto border-t border-[#333] pt-4">
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-[#888] hover:text-[#ef4444] bg-transparent border-none cursor-pointer transition-colors"
              >
                退出登录
              </button>
            </div>
          </nav>
          <main className="flex-1 py-8 pl-8 min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
