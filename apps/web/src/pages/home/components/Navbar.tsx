import { NavActionKey } from '@flowweb/shared';
import { StarOutlined } from '@ant-design/icons';

interface NavAction {
  key: NavActionKey;
  label: string;
  variant: 'outline' | 'ghost';
  icon?: React.ReactNode;
}

const defaultActions: NavAction[] = [
  { key: NavActionKey.Templates, label: '模板广场', variant: 'outline' },
  { key: NavActionKey.Membership, label: '开通会员', variant: 'outline', icon: <StarOutlined /> },
  { key: NavActionKey.Login, label: '登录', variant: 'ghost' },
];

interface Props {
  onAction?: (key: NavActionKey) => void;
}

export function Navbar({ onAction }: Props) {
  return (
    <nav className="h-16 bg-[#1A1A1A] flex items-center justify-between px-6 shadow-md border-b border-[#333]">
      <div className="text-[#4ade80] font-bold text-lg select-none">
        🧠 FlowAI
      </div>
      <div className="flex gap-3">
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
