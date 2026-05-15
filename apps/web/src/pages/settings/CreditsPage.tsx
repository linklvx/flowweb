import { useState, useEffect } from 'react';

export function CreditsPage() {
  const [credits, setCredits] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => {
        if (json.code === 0) {
          setCredits(json.data.credits);
          setUpdatedAt(json.data.updatedAt);
        } else if (json.credits !== undefined) {
          setCredits(json.credits);
          setUpdatedAt(json.updatedAt || null);
        } else {
          setError('加载失败');
        }
      })
      .catch(() => setError('网络错误'));
  }, []);

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div>
      <h2 className="text-lg font-bold text-[#e2e8f0] mb-6">积分余额</h2>
      {error && <p className="text-[#ef4444] text-xs mb-4">{error}</p>}
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-lg">
        <div className="text-center py-8">
          <p className="text-4xl font-bold text-[#f59e0b] mb-2">
            ⚡ {credits !== null ? credits : '...'}
          </p>
          <p className="text-sm text-[#888]">当前积分余额</p>
          {updatedAt && (
            <p className="text-xs text-[#666] mt-3">
              最后更新于 {formatDate(updatedAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
