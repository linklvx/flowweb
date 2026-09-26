import { Suspense } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { App as AntdApp, Button, ConfigProvider, Spin } from 'antd';
import { ProConfigProvider, ProLayout, zhCNIntl } from '@ant-design/pro-components';
import {
  AppstoreOutlined, CrownOutlined, HomeOutlined, LogoutOutlined, PictureOutlined, PlaySquareOutlined, SettingOutlined,
} from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { useAuth } from '@/components/AuthProvider';

const menuRoute = {
  path: '/admin',
  routes: [
    { path: '/admin/models', name: '模型管理', icon: <AppstoreOutlined /> },
    {
      path: '/admin/subscription', name: '会员订阅', icon: <CrownOutlined />,
      routes: [
        { path: '/admin/subscription/plans', name: '套餐管理' },
        { path: '/admin/subscription/subscriptions', name: '订阅管理' },
        { path: '/admin/subscription/credits', name: '积分发放' },
        { path: '/admin/subscription/banner', name: 'Banner 设置' },
      ],
    },
    {
      path: '/admin/homepage', name: '首页配置', icon: <HomeOutlined />,
      routes: [
        { path: '/admin/homepage/announcement', name: '公告条' },
        { path: '/admin/homepage/banners', name: '首页 Banner' },
      ],
    },
    {
      path: '/admin/styles', name: '风格库', icon: <PictureOutlined />,
      routes: [
        { path: '/admin/styles/categories', name: '风格分类' },
        { path: '/admin/styles/content', name: '风格内容' },
      ],
    },
    { path: '/admin/settings', name: '参数配置', icon: <SettingOutlined /> },
    { path: '/admin/content/video-works', name: '视频作品', icon: <PlaySquareOutlined /> },
  ],
};

// 外壳：Provider 层。useApp 必须在 <AntdApp> 子树内调用 —— 父组件读不到子 Provider 的 context
//（antd app/context.js 默认值 {message:{},modal:{}}，父层拿到空对象，modal.confirm 不是函数）
export default function AdminLayout() {
  return (
    <ProConfigProvider dark intl={zhCNIntl}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          // 不传 algorithm：嵌套 theme 的 child.algorithm 整体覆盖 parent（useTheme.js 合并语义），
          // 显式传 darkAlgorithm 会覆盖 ProConfigProvider dark 注入的 proTheme.darkAlgorithm —— 暗色统一交给 ProConfigProvider
          // 本子树恒深，不跟随全局（spec D4）——CSS 变量通道由下方 ProLayout 根 dark 类补齐（岛双通道，spec §3.1）
          token: { colorPrimary: '#4ade80' },
          components: { Button: { primaryColor: 'rgba(0,0,0,0.88)' } }, // Q3 路径 A：实心按钮文字色是 Button 组件 token primaryColor
        }}
      >
        <AntdApp>
          <AdminLayoutInner />
        </AntdApp>
      </ConfigProvider>
    </ProConfigProvider>
  );
}

function AdminLayoutInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { modal } = AntdApp.useApp(); // 此时在 App context 内，confirm 可用且持暗色主题

  const handleLogout = () => {
    modal.confirm({
      title: '确认退出登录？',
      onOk: async () => {
        await logout();
        navigate('/login');
      },
    });
  };

  return (
    <ProLayout
      title="FlowWeb 管理后台"
      // 岛根 dark 类（C2，spec D4）：ProLayout className 落在其根 DOM div（pro-layout/es/ProLayout.js:441
      // 非 pure 模式根节点）——整个 admin 子树（侧栏/头部/内容）在 html.light 下仍取 .dark 的 --fw-* 深色值
      className="dark"
      layout="side"
      navTheme="realDark"
      fixSiderbar
      fixedHeader
      route={menuRoute}
      location={{ pathname: location.pathname }}
      menuItemRender={(item, dom) => (item.path ? <Link to={item.path}>{dom}</Link> : dom)}
      actionsRender={() => [
        <span key="admin-name" className="pr-2 text-sm">{user?.name ?? '管理员'}</span>,
        <Button key="logout" type="text" icon={<LogoutOutlined />} onClick={handleLogout}>
          退出登录
        </Button>,
      ]}
    >
      <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}>
        <Outlet />
      </Suspense>
    </ProLayout>
  );
}
