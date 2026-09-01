interface WorkspaceTabBarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  labels?: { personal: string; team: string };
}

export function WorkspaceTabBar({ activeTab, onTabChange, labels = { personal: '个人项目', team: '团队项目' } }: WorkspaceTabBarProps) {
  return (
    <div className="flex gap-2 text-lg items-center">
      <button
        onClick={() => onTabChange('personal')}
        className={`mx-3 py-1.5 bg-transparent cursor-pointer rounded-t-md ${activeTab === 'personal' ? 'text-white border-b-2 border-white border-x-0 border-t-0' : 'text-white/50 border-none'}`}
      >{labels.personal}</button>
      <button
        onClick={() => onTabChange('team')}
        className={`mx-3 py-1.5 bg-transparent cursor-pointer rounded-t-md ${activeTab === 'team' ? 'text-white border-b-2 border-white border-x-0 border-t-0' : 'text-white/50 border-none'}`}
      >{labels.team}</button>
    </div>
  );
}
