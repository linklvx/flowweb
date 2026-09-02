import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  AppstoreOutlined, FolderOutlined, HomeOutlined, MenuFoldOutlined,
  MenuUnfoldOutlined, PictureOutlined, PlusOutlined, QuestionCircleOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { App, Tooltip } from 'antd';
import { startNewProject } from '@/utils/startNewProject';
import { WeChatFollowModal } from './WeChatFollowModal';

const NAV_ITEMS = [
  { label: '首页', href: '/', icon: <HomeOutlined /> },
  { label: '模板广场', href: '/templates', icon: <AppstoreOutlined /> },
  { label: '素材库', href: '/materials', icon: <PictureOutlined /> },
  { label: '工作空间', href: '/works', icon: <FolderOutlined /> },
];

const SIDEBAR_KEY = 'sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistCollapsed(value: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(value));
  } catch {
    // 存储被禁（如隐私模式）时静默忽略，展开/收起本身仍可用
  }
}

interface Props {
  /** 公告条区域总高：显示时 64，无公告时 0 */
  topOffset: number;
}

export function Sidebar({ topOffset }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [qrOpen, setQrOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    persistCollapsed(next);
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed ? 'true' : undefined}
      className={`sticky left-0 self-start shrink-0 box-border overflow-hidden transition-[width] duration-200 ease-out z-30 ${
        collapsed ? 'w-[78px] px-2' : 'w-[240px] px-4'
      } bg-[#141414] border-r [border-right-style:solid] border-r-[#ffffff18] flex flex-col`}
      style={{ top: topOffset, height: `calc(100vh - ${topOffset}px)` }}
    >
      <header className={`h-[60px] flex items-center shrink-0 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <Link to="/" aria-label="首页" className="block">
            <span className="text-[22px] font-semibold italic tracking-[-0.04em] leading-none text-white select-none whitespace-nowrap">
              Flow123
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="size-9 rounded-lg flex items-center justify-center text-white bg-[#141414] border-none cursor-pointer"
        >
          {collapsed ? <MenuUnfoldOutlined className="text-[28px]" /> : <MenuFoldOutlined className="text-[28px]" />}
        </button>
      </header>

      <Tooltip title={collapsed ? '新建项目' : ''} placement="right">
        <button
          onClick={() => startNewProject(navigate)}
          aria-label="新建项目"
          className={`h-9 my-[10px] rounded-lg bg-[#262626] hover:brightness-110 text-white text-sm font-medium leading-[22px] whitespace-nowrap flex items-center border-none cursor-pointer transition-[filter] duration-150 ${
            collapsed ? 'justify-center w-[36px] self-center' : 'gap-2 px-2 w-full'
          }`}
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <PlusOutlined className="text-base" />
          </span>
          {!collapsed && '新建项目'}
        </button>
      </Tooltip>

      <nav className="flex flex-col gap-0.5 mt-2">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.href} title={collapsed ? item.label : ''} placement="right">
            <Link
              to={item.href}
              aria-label={item.label}
              className={`h-[38px] rounded-lg flex items-center ${collapsed ? 'justify-center w-[36px] self-center' : 'gap-[13px] px-2'} no-underline text-base leading-[26px] whitespace-nowrap transition-colors text-white hover:text-white ${
                isActive(item.href)
                  ? 'bg-[#262626] font-medium'
                  : 'hover:bg-[#1e1e1e]'
              }`}
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0 text-[18px]">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          </Tooltip>
        ))}
      </nav>

      <div className="mt-auto pb-4 flex flex-col gap-1">
        <Tooltip title={collapsed ? '关注公众号' : ''} placement="right">
          <button
            data-testid="wechat-follow-entry"
            onClick={() => setQrOpen(true)}
            aria-label="关注公众号"
            className={`rounded-lg flex items-center border-none cursor-pointer transition-colors ${
              collapsed
                ? 'h-9 w-full justify-center text-sm text-[#a0a0a0] hover:bg-[#1e1e1e] hover:text-white'
                : 'h-16 bg-[#1e1e1e] hover:bg-[#262626] justify-between px-3'
            }`}
          >
            {collapsed ? (
              <span className="w-5 h-5 flex items-center justify-center">
                <WechatOutlined style={{ color: '#07c160' }} />
              </span>
            ) : (
              <>
                <span className="flex flex-col items-start">
                  <span className="text-xs font-medium text-white">关注公众号</span>
                  <span className="text-[11px] text-[#707070] mt-0.5">获取最新动态和福利</span>
                </span>
                <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(7,193,96,0.1)' }}>
                  <WechatOutlined className="text-lg" style={{ color: '#07c160' }} />
                </span>
              </>
            )}
          </button>
        </Tooltip>
        <Tooltip title={collapsed ? '文档中心' : ''} placement="right">
          <button
            onClick={() => message.info('敬请期待')}
            aria-label="文档中心"
            className={`h-9 rounded-lg px-2 flex items-center ${collapsed ? 'justify-center' : 'gap-2'} text-sm leading-[22px] whitespace-nowrap text-[#707070] hover:bg-[#1e1e1e] hover:text-[#a0a0a0] border-none cursor-pointer transition-colors`}
          >
            <QuestionCircleOutlined className="text-base" />
            {!collapsed && '文档中心'}
          </button>
        </Tooltip>
      </div>

      <WeChatFollowModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </aside>
  );
}
