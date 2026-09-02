import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  AppstoreOutlined, FolderOutlined, HomeOutlined, PictureOutlined,
  PlusOutlined, QuestionCircleOutlined, WechatOutlined,
} from '@ant-design/icons';
import { App } from 'antd';
import { startNewProject } from '@/utils/startNewProject';
import { WeChatFollowModal } from './WeChatFollowModal';

const NAV_ITEMS = [
  { label: '首页', href: '/', icon: <HomeOutlined /> },
  { label: '模板广场', href: '/templates', icon: <AppstoreOutlined /> },
  { label: '素材库', href: '/materials', icon: <PictureOutlined /> },
  { label: '工作空间', href: '/works', icon: <FolderOutlined /> },
];

interface Props {
  /** 公告条区域总高：显示时 64，无公告时 0 */
  topOffset: number;
}

export function Sidebar({ topOffset }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [qrOpen, setQrOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside
      data-testid="sidebar"
      className="sticky left-0 self-start shrink-0 box-border w-[240px] bg-[#141414] border-r border-[#ffffff18] px-4 flex flex-col z-30"
      style={{ top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
    >
      <Link to="/" aria-label="首页" className="block pt-5 pb-4">
        <span className="text-[22px] font-semibold italic tracking-[-0.04em] leading-none text-white select-none whitespace-nowrap">
          Flow123
        </span>
      </Link>

      <button
        onClick={() => startNewProject(navigate)}
        className="h-9 w-full rounded-lg bg-[#00bfff] hover:brightness-110 text-black text-sm font-medium leading-[22px] flex items-center gap-2 px-2 border-none cursor-pointer transition-[filter] duration-150"
      >
        <span className="w-5 h-5 flex items-center justify-center">
          <PlusOutlined className="text-base" />
        </span>
        新建项目
      </button>

      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={`h-9 rounded-lg px-2 flex items-center gap-2 no-underline text-sm leading-[22px] transition-colors ${
              isActive(item.href)
                ? 'bg-[#262626] text-white font-medium'
                : 'text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white'
            }`}
          >
            <span className="w-5 h-5 flex items-center justify-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto pb-4 flex flex-col gap-1">
        <button
          data-testid="wechat-follow-entry"
          onClick={() => setQrOpen(true)}
          className="h-16 rounded-lg bg-[#1e1e1e] hover:bg-[#262626] flex items-center justify-between px-3 border-none cursor-pointer transition-colors"
        >
          <span className="flex flex-col items-start">
            <span className="text-xs font-medium text-white">关注公众号</span>
            <span className="text-[11px] text-[#707070] mt-0.5">获取最新动态和福利</span>
          </span>
          <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(7,193,96,0.1)' }}>
            <WechatOutlined className="text-lg" style={{ color: '#07c160' }} />
          </span>
        </button>
        <button
          onClick={() => message.info('敬请期待')}
          className="h-9 rounded-lg px-2 flex items-center gap-2 text-sm leading-[22px] text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors"
        >
          <QuestionCircleOutlined className="text-base" />
          文档中心
        </button>
      </div>

      <WeChatFollowModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </aside>
  );
}
