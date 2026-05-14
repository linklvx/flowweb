import { useState } from 'react';
import { useNavigate, Link } from 'react-router';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!res.ok) { setError('邮箱或密码错误'); return; }
      navigate('/canvas');
    } catch { setError('网络错误，请重试'); }
  };

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-[#1a1a1a] border border-[#333] rounded-xl p-8 w-96">
        <h1 className="text-xl font-bold text-[#e2e8f0] mb-6">登录 FlowAI</h1>
        {error && <p className="text-red-400 text-xs mb-4">{error}</p>}
        <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-3" required />
        <input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full bg-[#0f0f0f] border border-[#333] rounded-md px-3 py-3 text-sm text-[#ccc] mb-4" required />
        <button type="submit" className="w-full bg-[#4ade80] text-black font-bold py-3 rounded-lg cursor-pointer text-sm">
          登录
        </button>
        <p className="text-xs text-[#888] mt-4 text-center">
          还没有账号？<Link to="/register" className="text-[#4ade80]">注册</Link>
        </p>
      </form>
    </div>
  );
}
