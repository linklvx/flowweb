import { useState } from 'react';
import { Link } from 'react-router';
import { resolvePostLoginTarget } from '@/utils/loginRedirect';

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
      window.location.href = resolvePostLoginTarget(new URLSearchParams(window.location.search).get('next'));
    } catch { setError('网络错误，请重试'); }
  };

  // 恒浅营销岛，spec D4/login 同款（视觉壳对齐 login：同字面色板/卡片/版式，表单逻辑不动）
  return (
    <div className="light min-h-screen bg-[#f5f5f5] flex items-center justify-center">
      <div className="w-[720px] rounded-[16px] overflow-hidden shadow-lg">
        {/* Banner（login 同款） */}
        <div className="h-[140px] rounded-t-[16px] overflow-hidden">
          <div className="w-full h-full bg-gradient-to-b from-[#e8e8e8] to-[#f0f0f0] flex items-center justify-center">
            <span className="text-[24px] font-semibold italic tracking-[-0.04em] leading-none text-[#141414]">
              Flow123
            </span>
          </div>
        </div>

        {/* Form area（login 同款白卡上叠） */}
        <div className="bg-[#FFF] relative z-[1] -mt-[15px] pt-8">
          <form onSubmit={handleSubmit} className="mx-auto w-[320px] pb-10">
            <h1 className="text-[16px] font-semibold text-[#141414] text-center">注册 Flow123</h1>
            <input type="text" placeholder="用户名" value={name} onChange={e => setName(e.target.value)}
              className="mt-6 w-full bg-[#F8F8F8] rounded-[8px] h-[48px] px-5 text-[15px] text-[#000] placeholder-[#999]" required />
            <input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)}
              className="mt-4 w-full bg-[#F8F8F8] rounded-[8px] h-[48px] px-5 text-[15px] text-[#000] placeholder-[#999]" required />
            <input type="password" placeholder="密码（至少8位）" value={password} onChange={e => setPassword(e.target.value)}
              className="mt-4 w-full bg-[#F8F8F8] rounded-[8px] h-[48px] px-5 text-[15px] text-[#000] placeholder-[#999]" required />
            <p className="h-[30px] leading-[30px] text-[12px] text-[#F53F3F]">{error}</p>
            <button type="submit" className="w-full h-[48px] rounded-[8px] bg-[#1F6DFF] text-white font-semibold text-[14px] hover:bg-[#4080FF]">
              注册
            </button>
            <p className="text-[12px] text-[#787878] mt-3 text-center">
              已有账号？<Link to="/login" className="text-[#1F6DFF]">登录</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
