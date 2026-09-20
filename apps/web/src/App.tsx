import { RouterProvider } from 'react-router';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import { router } from './router';
import { AuthProvider } from './components/AuthProvider';
import { useTheme } from './stores/themeStore';

export function App() {
  // C8 D0 两态：algorithm 由 mode 派生——DOM 类 / antd algorithm / ReactFlow colorMode 三处同源由 mode 推导
  const { mode } = useTheme();
  return (
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
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
