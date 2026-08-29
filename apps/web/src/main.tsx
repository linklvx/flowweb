import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

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
