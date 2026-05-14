import { RouterProvider } from 'react-router';
import { router } from './router';
import { AuthProvider } from './components/AuthProvider';

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
