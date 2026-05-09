import { createBrowserRouter } from 'react-router';
import { HomePage } from '@/pages/home';
import { CanvasPage } from '@/pages/canvas';

export const router = createBrowserRouter([
  { path: '/', element: <HomePage /> },
  { path: '/canvas', element: <CanvasPage /> },
]);
