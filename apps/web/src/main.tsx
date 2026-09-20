import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initThemeSync } from './stores/themeStore';
import './index.css';

// 初始化契约（C8 D0）：initThemeSync 先于 createRoot().render() 是显式契约声明——懒初始化 +
// 内联脚本使首帧实际与调用顺序无关（useSyncExternalStore 首渲染 getSnapshot 即 ensureInit）；
// 非"不加就闪"（防后人据错误因果去"修"不存在的问题，spec §10.6）。
initThemeSync();

// DEV 验收辅助：?sessionToken=<t>&redirect=<encoded> 设会话 cookie 后跳转
// （多用户双实例验收时 iframe 用独立源 127.0.0.1 携带 B 会话）
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const st = q.get('sessionToken');
  if (st) {
    document.cookie = `flowweb.session_token=${st}; path=/; max-age=86400; SameSite=Lax`;
    const redirect = q.get('redirect');
    location.replace(redirect ? decodeURIComponent(redirect) : location.pathname);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
