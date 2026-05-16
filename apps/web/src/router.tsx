import { createBrowserRouter, Navigate } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';
import { AdminPage } from '@/pages/admin';
import { LoginPage } from '@/pages/login';
import { RegisterPage } from '@/pages/register';
import { RequireAuth } from '@/components/RequireAuth';
import { SettingsLayout, ProfilePage, CreditsPage } from '@/pages/settings';
import { TemplateMarketPage } from '@/pages/templates/TemplateMarketPage';
import { TemplatePreviewPage } from '@/pages/templates/TemplatePreviewPage';
import { MyTemplatesPage } from '@/pages/settings/MyTemplatesPage';

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
      {
        path: '/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/profile" replace /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: 'credits', element: <CreditsPage /> },
          { path: 'templates', element: <MyTemplatesPage /> },
          { path: 'templates/:id', element: <TemplatePreviewPage /> },
        ],
      },
    ],
  },
]);
