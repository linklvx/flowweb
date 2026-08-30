interface WorkspaceTabBarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  labels?: { personal: string; team: string };
}

export function WorkspaceTabBar({ activeTab, onTabChange, labels = { personal: '个人', team: '团队项目' } }: WorkspaceTabBarProps) {
  return (
    <div className="flex gap-2 text-lg items-center px-8 pt-2">
      <button
        onClick={() => onTabChange('personal')}
        className={`mx-3 py-1.5 bg-transparent ${activeTab === 'personal' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
      >{labels.personal}</button>
      <button
        onClick={() => onTabChange('team')}
        className={`mx-3 py-1.5 bg-transparent ${activeTab === 'team' ? 'text-white border-b-2 border-white border-x-0 border-t-0 cursor-pointer' : 'text-white/60 border-none cursor-pointer'}`}
      >{labels.team}</button>
    </div>
  );
}
