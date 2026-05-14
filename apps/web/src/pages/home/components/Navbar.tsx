import { NavActionKey } from '@flowweb/shared';
import { StarOutlined } from '@ant-design/icons';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { Link } from 'react-router';

interface NavAction {
  key: NavActionKey;
  label: string;
  variant: 'outline' | 'ghost';
  icon?: React.ReactNode;
}

const defaultActions: NavAction[] = [
  { key: NavActionKey.Templates, label: '模板广场', variant: 'outline' },
  { key: NavActionKey.Membership, label: '开通会员', variant: 'outline', icon: <StarOutlined /> },
];

interface Props {
  onAction?: (key: NavActionKey) => void;
}

export function Navbar({ onAction }: Props) {
  const { user, logout } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => { if (json.code === 0) setCredits(json.data.credits); })
      .catch(() => {});
  }, []);

  // Listen for real-time credit updates from Socket.io
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (typeof ce.detail === 'number') setCredits(ce.detail);
    };
    window.addEventListener('credits:update', handler);
    return () => window.removeEventListener('credits:update', handler);
  }, []);

  return (
    <nav className="h-16 bg-[#1A1A1A] flex items-center justify-between px-6 shadow-md border-b border-[#333]">
      <div className="text-[#4ade80] font-bold text-lg select-none">
        🧠 FlowAI
      </div>
      {credits !== null && (
        <div className="text-xs text-[#f59e0b] flex-shrink-0">
          ⚡ {credits} 积分
        </div>
      )}
      <div className="flex gap-3 items-center">
        {user ? (
          <>
            <span className="text-xs text-[#f59e0b]">⚡ {credits} 积分</span>
            <span className="text-xs text-[#ccc]">{user.name || user.email}</span>
            <button onClick={logout} className="px-3 py-1.5 rounded-md text-xs border border-[#888] text-[#ccc] bg-transparent cursor-pointer hover:border-[#ef4444] hover:text-[#ef4444] transition-colors">
              退出
            </button>
          </>
        ) : (
          <Link to="/login" className="px-3 py-1.5 rounded-md text-xs border border-[#888] text-[#ccc] no-underline hover:border-[#4ade80] transition-colors">
            登录
          </Link>
        )}
        {defaultActions.map((action) => (
          <button
            key={action.key}
            onClick={() => onAction?.(action.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors border bg-transparent
              ${action.key === NavActionKey.Membership
                ? 'border-[#f59e0b] text-[#f59e0b] hover:bg-[#f59e0b]/10'
                : action.key === NavActionKey.Templates
                  ? 'border-[#4ade80] text-[#4ade80] hover:bg-[#4ade80]/10'
                  : 'border-[#888] text-[#ccc] hover:bg-[#888]/10'
              }`}
          >
            {action.icon && <span className="mr-1">{action.icon}</span>}
            {action.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
