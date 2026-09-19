import { RouterProvider } from 'react-router';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import { router } from './router';
import { AuthProvider } from './components/AuthProvider';
import { useTheme } from './stores/themeStore';

export function App() {
  // C2 接线（spec §4.2）：algorithm 由主题真源派生——全部 antd 组件（含 body 挂载弹层，
  // context 穿透 portal）随 html.light/.dark；恒深/恒浅岛各自内嵌 Provider 覆盖（D4）
  const { resolved } = useTheme();
  return (
    <ConfigProvider
      theme={{
        algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
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
