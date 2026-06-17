import { RouterProvider } from 'react-router';
import { ConfigProvider, App as AntdApp } from 'antd';
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
      <AntdApp>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
