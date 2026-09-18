/** @deprecated 请使用 @/components/auth/LoginModal 替换 */
import { useState } from 'react';
import { useAuth } from './AuthProvider';

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError('邮箱或密码错误');
        return;
      }
      await refresh();
      onClose();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('密码至少8位');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/sign-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
        credentials: 'include',
      });
      if (!res.ok) {
        setError('注册失败，邮箱可能已存在');
        return;
      }
      await refresh();
      onClose();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
  };

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      data-testid="auth-modal-backdrop"
      onClick={handleBackdrop}
      className="fixed inset-0 z-[100] bg-black/60 flex items-start justify-center pt-[18vh]"
    >
      <div className="bg-[#222222] border border-[#3a3a3a] rounded-xl w-96 relative">
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute top-3 right-3 text-[#888] hover:text-[#ccc] transition-colors text-lg leading-none"
        >
          ✕
        </button>

        {/* Form */}
        <div className="p-6">
          <h2 className="text-lg font-bold text-[#e2e8f0] mb-4">
            {mode === 'login' ? '用户登录' : '用户注册'}
          </h2>
          {error && (
            <p className="text-red-400 text-xs mb-4">{error}</p>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin}>
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border border-[#3a3a3a] rounded-md px-3 py-2.5 text-sm text-[#ccc] placeholder-[#666] mb-3 focus:outline-none"
                required
              />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border border-[#3a3a3a] rounded-md px-3 py-2.5 text-sm text-[#ccc] placeholder-[#666] mb-4 focus:outline-none"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#4ade80] text-black font-medium py-2.5 rounded-lg cursor-pointer text-sm disabled:opacity-50"
              >
                {loading ? '...' : '登录'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <input
                type="text"
                placeholder="用户名"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-transparent border border-[#3a3a3a] rounded-md px-3 py-2.5 text-sm text-[#ccc] placeholder-[#666] mb-3 focus:outline-none"
                required
              />
              <input
                type="email"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border border-[#3a3a3a] rounded-md px-3 py-2.5 text-sm text-[#ccc] placeholder-[#666] mb-3 focus:outline-none"
                required
              />
              <input
                type="password"
                placeholder="密码（至少8位）"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border border-[#3a3a3a] rounded-md px-3 py-2.5 text-sm text-[#ccc] placeholder-[#666] mb-4 focus:outline-none"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#4ade80] text-black font-medium py-2.5 rounded-lg cursor-pointer text-sm disabled:opacity-50"
              >
                {loading ? '...' : '注册'}
              </button>
            </form>
          )}

          {/* Mode switch link */}
          <p className="text-xs text-[#888] mt-4 text-center">
            {mode === 'login' ? (
              <>
                还没有账号？
                <button onClick={() => switchMode('register')} className="text-[#4ade80] bg-transparent border-none cursor-pointer">
                  注册
                </button>
              </>
            ) : (
              <>
                已有账号？
                <button onClick={() => switchMode('login')} className="text-[#4ade80] bg-transparent border-none cursor-pointer">
                  登录
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
