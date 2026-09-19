import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initThemeSync } from './stores/themeStore';
import './index.css';

// C1 主题运行时同步（spec §4.1）：激活 matchMedia change 监听（system 档随 OS 实时翻转重解析）。
// 首帧防闪白由 index.html head 内联脚本先行挂类；本调用仅接线监听 + store 懒初始化，先于 React 挂载。
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
