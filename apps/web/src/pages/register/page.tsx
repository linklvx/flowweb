import { useState } from 'react';
import { Link } from 'react-router';

export function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (password.length < 8) { setError('密码至少8位'); return; }
    try {
      const res = await fetch('/api/auth/sign-up', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
        credentials: 'include',
      });
      if (!res.ok) { setError('注册失败，邮箱可能已存在'); return; }
      window.location.href = '/canvas';
    } catch { setError('网络错误，请重试'); }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-8 w-96">
        <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">注册 Flow123</h1>
        {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
        <input type="text" placeholder="用户名" value={name} onChange={e => setName(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-3" required />
        <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-3" required />
        <input type="password" placeholder="密码（至少8位）" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-4" required />
        <button type="submit" className="w-full bg-[#4ade80] text-black font-bold py-3 rounded-lg text-sm">
          注册
        </button>
        <p className="text-xs text-[#888] mt-4 text-center">
          已有账号？<Link to="/login" className="text-[#4ade80]">登录</Link>
        </p>
      </form>
    </div>
  );
}
