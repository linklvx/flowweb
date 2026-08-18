import { createBrowserRouter, Navigate } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';
import { AdminPage } from '@/pages/admin';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsLayout, ProfilePage, CreditsPage } from '@/pages/settings';
import { MembershipPage } from '@/pages/settings/MembershipPage';
import { TemplateMarketPage } from '@/pages/templates/TemplateMarketPage';
import { TemplatePreviewPage } from '@/pages/templates/TemplatePreviewPage';
import { WorkspacePage } from '@/pages/workspace/WorkspacePage';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/templates', element: <TemplateMarketPage /> },
  { path: '/templates/:id', element: <TemplatePreviewPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> },
      { path: '/admin', element: <AdminPage /> },
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
]);
