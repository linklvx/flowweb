interface WorkspaceTabBarProps {
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
  labels?: { personal: string; team: string };
}

export function WorkspaceTabBar({ activeTab, onTabChange, labels = { personal: '个人项目', team: '团队项目' } }: WorkspaceTabBarProps) {
  return (
    <div className="flex gap-2 text-[20px] items-center">
      <button
        onClick={() => onTabChange('personal')}
        className={`ml-0 mr-3 py-1.5 text-[20px] bg-transparent rounded-t-md ${activeTab === 'personal' ? 'text-text border-b-2 border-white border-x-0 border-t-0' : 'text-text-dim-2'}`}
      >{labels.personal}</button>
      <button
        onClick={() => onTabChange('team')}
        className={`mx-[2px] py-1.5 text-[20px] bg-transparent rounded-t-md ${activeTab === 'team' ? 'text-text border-b-2 border-white border-x-0 border-t-0' : 'text-text-dim-2'}`}
      >{labels.team}</button>
    </div>
  );
}
