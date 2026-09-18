import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Input, Button, message } from 'antd';
import { applyJoin } from '@/api/teamApi';
import { useAuth } from '@/components/AuthProvider';

export default function JoinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const teamId = searchParams.get('team');
  const [message_, setMessage_] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?redirect=${encodeURIComponent(`/join?team=${teamId ?? ''}`)}`);
    }
  }, [loading, user, navigate, teamId]);

  if (!teamId) return <div className="min-h-screen bg-[#111] text-text p-10">无效的邀请链接</div>;
  if (!user) return null;

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await applyJoin(teamId, message_ || undefined);
      message.success('申请已提交，等待审批');
    } catch (e: any) {
      setError(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#111] text-text flex items-center justify-center">
      <div className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-lg p-8 w-full max-w-md">
        <h2 className="text-lg font-bold mb-2">加入团队</h2>
        <div className="text-xs text-[#666] mb-4">团队 ID：{teamId}</div>
        <div className="text-xs text-[#888] mb-1">留言（可选）</div>
        <Input.TextArea
          value={message_}
          onChange={(e) => setMessage_(e.target.value)}
          rows={3}
          placeholder="向团队管理员介绍自己"
          data-testid="join-message"
        />
        {error && <div className="text-xs text-accent-danger mt-2" data-testid="join-error">{error}</div>}
        <Button
          className="mt-4" block loading={submitting}
          type="primary" style={{ background: '#5DDCFF', borderColor: '#5DDCFF', color: '#000' }}
          onClick={() => void submit()}
          data-testid="join-submit"
        >
          提交申请
        </Button>
      </div>
    </div>
  );
}
