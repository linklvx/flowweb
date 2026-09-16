import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Spin } from 'antd';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { RequireAuth } from '@/components/RequireAuth';
import { RequireAdmin } from '@/components/RequireAdmin';
import { AppLayout } from '@/components/layout/AppLayout';

const AdminLayout = lazy(() => import('@/pages/admin/AdminLayout'));
const ModelsPage = lazy(() => import('@/pages/admin/pages/ModelsPage'));
const PlansPage = lazy(() => import('@/pages/admin/pages/PlansPage'));
const SubscriptionsPage = lazy(() => import('@/pages/admin/pages/SubscriptionsPage'));
const AdminCreditsPage = lazy(() => import('@/pages/admin/pages/CreditsPage')); // 避开已导入的 settings/CreditsPage
const SubscriptionBannerPage = lazy(() => import('@/pages/admin/pages/SubscriptionBannerPage'));
const AnnouncementPage = lazy(() => import('@/pages/admin/pages/AnnouncementPage'));
const HomeBannersPage = lazy(() => import('@/pages/admin/pages/HomeBannersPage'));
const SettingsPage = lazy(() => import('@/pages/admin/pages/SettingsPage'));
const VideoWorksPage = lazy(() => import('@/pages/admin/pages/VideoWorksPage').then(m => ({ default: m.VideoWorksPage })));
const VideosPage = lazy(() => import('./pages/videos/VideosPage').then(m => ({ default: m.VideosPage })));

const AdminLazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}>{children}</Suspense>
);
import { SettingsLayout, ProfilePage, CreditsPage } from '@/pages/settings';
import { MembershipPage } from '@/pages/settings/MembershipPage';
import { TemplateMarketPage } from '@/pages/templates/TemplateMarketPage';
import { TemplatePreviewPage } from '@/pages/templates/TemplatePreviewPage';
import { WorkspacePage } from '@/pages/workspace/WorkspacePage';
import TeamPage from '@/pages/team/TeamPage';
import TeamBillingPage from '@/pages/team/TeamBillingPage';
import JoinPage from '@/pages/join/JoinPage';
import MaterialsPage from '@/pages/materials/MaterialsPage';

export const router = createBrowserRouter([
  {
    // 公开组：套 AppLayout
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/templates', element: <TemplateMarketPage /> },
      { path: '/templates/:id', element: <TemplatePreviewPage /> },
      // 可选参数单路由（防两条平级路由整页重挂）；lazy 元素必须自带 Suspense 边界——AppLayout 无 Suspense、
      // 公开组现有路由全是静态 import、react-router 7 SPA 不提供隐式边界 → 不包则 /videos 直链首屏
      // chunk 加载期间整个 root 无 fallback 白屏（照抄 AdminLazy 同款）
      { path: '/videos/:id?', element: <Suspense fallback={<div className="flex justify-center p-16"><Spin /></div>}><VideosPage /></Suspense> },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> }, // 全屏编辑器，不套布局
      {
        path: '/admin',
        element: <RequireAdmin />,
        children: [
          {
            path: '',
            element: <AdminLazy><AdminLayout /></AdminLazy>,
            children: [
              { index: true, element: <Navigate to="/admin/models" replace /> },
              { path: 'models', element: <ModelsPage /> },
              { path: 'subscription/plans', element: <PlansPage /> },
              { path: 'subscription/subscriptions', element: <SubscriptionsPage /> },
              { path: 'subscription/credits', element: <AdminCreditsPage /> },
              { path: 'subscription/banner', element: <SubscriptionBannerPage /> },
              { path: 'homepage/announcement', element: <AnnouncementPage /> },
              { path: 'homepage/banners', element: <HomeBannersPage /> },
              { path: 'settings', element: <SettingsPage /> },
              { path: 'content/video-works', element: <VideoWorksPage /> },
            ],
          },
        ],
      },
      {
        // 登录组：套 AppLayout
        element: <AppLayout />,
        children: [
          { path: '/team', element: <TeamPage /> },
          { path: '/team/:id/billing', element: <TeamBillingPage /> },
          { path: '/materials', element: <MaterialsPage /> },
          { path: '/works', element: <WorkspacePage /> },
          { path: '/works/:id', element: <TemplatePreviewPage /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/profile" replace /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: 'credits', element: <CreditsPage /> },
              { path: 'membership', element: <MembershipPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
