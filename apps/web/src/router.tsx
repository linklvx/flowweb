import { createBrowserRouter, Navigate } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';
import { AdminPage } from '@/pages/admin';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { RequireAuth } from '@/components/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
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
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> }, // 全屏编辑器，不套布局
      { path: '/admin', element: <AdminPage /> }, // 独立后台，不套布局
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
