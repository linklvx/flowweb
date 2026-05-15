import { NavLink, Outlet, Link } from 'react-router';
import { useAuth } from '@/components/AuthProvider';

export function SettingsLayout() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex flex-col">
      <div className="h-12 flex items-center px-4 border-b border-[#333]">
        <Link to="/canvas" className="text-xs text-[#888] hover:text-[#ccc] no-underline">
          ← 返回画布
        </Link>
        <span className="ml-auto text-[#4ade80] font-bold text-sm">🧠 FlowAI</span>
      </div>
      <div className="flex flex-1">
        <nav className="w-48 bg-[#1A1A1A] border-r border-[#333] flex flex-col py-4">
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
            积分余额
          </NavLink>
          <div className="mt-auto border-t border-[#333] pt-4">
            <button
              onClick={() => logout()}
              className="w-full text-left px-4 py-2 text-sm text-[#888] hover:text-[#ef4444] bg-transparent border-none cursor-pointer transition-colors"
            >
              退出登录
            </button>
          </div>
        </nav>
        <main className="flex-1 p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
