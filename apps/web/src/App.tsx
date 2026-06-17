import { RouterProvider } from 'react-router';
import { ConfigProvider } from 'antd';
import { router } from './router';
import { AuthProvider } from './components/AuthProvider';

export function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          zIndexPopupBase: 11000,
        },
      }}
    >
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ConfigProvider>
  );
}
