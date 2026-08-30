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
import TeamPage from '@/pages/team/TeamPage';
import TeamBillingPage from '@/pages/team/TeamBillingPage';
import JoinPage from '@/pages/join/JoinPage';
import MaterialsPage from '@/pages/materials/MaterialsPage';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/templates', element: <TemplateMarketPage /> },
  { path: '/templates/:id', element: <TemplatePreviewPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/canvas', element: <CanvasPage /> },
      { path: '/admin', element: <AdminPage /> },
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
]);
