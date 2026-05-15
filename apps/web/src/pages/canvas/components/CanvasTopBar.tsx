import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '@/components/AuthProvider';
import { SaveAsTemplateDialog } from './SaveAsTemplateDialog';

export function CanvasTopBar() {
  const { user, logout } = useAuth();
  const { projectId } = useParams<{ projectId: string }>();
  const [credits, setCredits] = useState<number | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => {
    fetch('/api/credits/balance')
      .then(r => r.json())
      .then(json => { if (json.code === 0) setCredits(json.data.credits); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (typeof ce.detail === 'number') setCredits(ce.detail);
    };
    window.addEventListener('credits:update', handler);
    return () => window.removeEventListener('credits:update', handler);
  }, []);

  return (
    <div className="absolute top-3 right-4 z-50 flex items-center gap-3 bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
      {credits !== null && (
        <span className="text-xs text-[#f59e0b] whitespace-nowrap">⚡ {credits} 积分</span>
      )}
      {user && (
        <button
          onClick={() => setShowSaveDialog(true)}
          className="text-[#4ade80] text-xs bg-transparent border border-[#4ade80]/30 rounded px-2 py-1 hover:bg-[#4ade80]/10 transition-colors cursor-pointer"
        >
          保存为模板
        </button>
      )}
      {user ? (
        <>
          <Link
            to="/settings"
            className="text-xs text-[#ccc] whitespace-nowrap no-underline hover:text-[#4ade80] transition-colors"
          >
            {user.name || user.email}
          </Link>
          <button
            onClick={logout}
            className="px-2 py-0.5 rounded-full text-xs border border-[#555] text-[#999] bg-transparent cursor-pointer hover:border-[#ef4444] hover:text-[#ef4444] transition-colors"
          >
            退出
          </button>
        </>
      ) : (
        <Link
          to="/login"
          className="px-2 py-0.5 rounded-full text-xs border border-[#4ade80] text-[#4ade80] no-underline hover:bg-[#4ade80]/10 transition-colors"
        >
          登录
        </Link>
      )}
      {showSaveDialog && (
        <SaveAsTemplateDialog
          projectId={projectId || 'default'}
          onClose={() => setShowSaveDialog(false)}
          onSaved={() => { setShowSaveDialog(false); }}
        />
      )}
    </div>
  );
}
