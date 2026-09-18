// ProcessView.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { App as AntdApp } from 'antd';
import { useAuth } from '@/components/AuthProvider';
import { fetchProcessSnapshot, cloneWork } from '@/api/videoWorkApi';
import type { ProcessSnapshotData } from '@flowweb/shared';
import { ProcessSnapshot } from './ProcessSnapshot';

export function ProcessView({ workId, title, canClone, onBack, onNeedLogin }: {
  workId: string; title: string; canClone: boolean; onBack: () => void; onNeedLogin: () => void;
}) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ProcessSnapshotData | null>(null);
  const [error, setError] = useState(false);
  const [cloned, setCloned] = useState<{ projectId: string } | null>(null);
  const [cloning, setCloning] = useState(false);   // in-flight 防双击（异步期间按钮可再点 → 重复 cloneWork）
  const { message } = AntdApp.useApp();   // 壳内上下文实例（C1-3）
  const { user } = useAuth();

  useEffect(() => {
    fetchProcessSnapshot(workId).then(setSnap).catch(() => setError(true));
  }, [workId]);

  const onClone = async () => {
    if (!user) { onNeedLogin(); return; }   // D18（isLoggedIn 不存在，C1-4）
    if (cloning) return;
    setCloning(true);
    try {
      const res = await cloneWork(workId);
      setCloned(res);
      message.success('已克隆工作流（产物需重新生成）');
    } catch (e: any) {
      if (e.status === 401) onNeedLogin();
      else if (e.status === 429) message.warning('克隆太频繁，请稍后再试');
      else message.error('克隆失败');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[#141414]">
      <div className="flex items-center gap-3 pl-4 pr-[var(--vw-close-reserve)] py-2 bg-[#1e1e1e] border-b border-white/10 shrink-0">
        <button onClick={onBack} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">‹ 返回</button>
        <span className="flex-1 truncate text-sm">{title} · 创作过程</span>
        {canClone && !cloned && (
          <>
            {/* U7c：只读模式提示（复制项目按钮左侧白字） */}
            <span className="text-white text-sm mr-1">只读模式，如需创建请点击</span>
            {/* U7a：白底黑字 + 复制图标（SVG 参考用户提供的 libtv 图标；clip-path 为 16×16 全域 clip，剔除避免 id 冲突） */}
            <button onClick={onClone} disabled={cloning} className="rounded-lg bg-white text-[#111] px-3.5 py-1.5 text-sm font-semibold hover:opacity-90 inline-flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="mr-1 size-4" width="1em" height="1em" viewBox="0 0 16 16">
                <path d="M9.33 4.73c1.07 0 1.94.87 1.94 1.94v6.66c0 1.07-.87 1.94-1.94 1.94H2.67a1.93 1.93 0 0 1-1.94-1.94V6.67c0-1.07.87-1.94 1.94-1.94zm-6.66 1.2c-.4 0-.74.33-.74.74v6.66c0 .4.33.74.74.74h6.66c.4 0 .74-.33.74-.74V6.67c0-.4-.33-.74-.74-.74zM6 7.4c.33 0 .6.27.6.6v1.4H8a.6.6 0 0 1 0 1.2H6.6V12a.6.6 0 0 1-1.2 0v-1.4H4a.6.6 0 0 1 0-1.2h1.4V8c0-.33.26-.6.6-.6M13.33.73c1.07 0 1.94.87 1.94 1.94v6.66c0 1.07-.87 1.94-1.94 1.94a.6.6 0 0 1 0-1.2c.4 0 .74-.34.74-.74V2.67c0-.4-.34-.74-.74-.74H6.67c-.4 0-.74.34-.74.74a.6.6 0 0 1-1.2 0C4.73 1.6 5.6.73 6.67.73z" fill="currentColor" />
              </svg>
              复制项目
            </button>
          </>
        )}
        {cloned && (
          <button onClick={() => navigate(`/canvas?projectId=${cloned.projectId}`)}
            className="rounded-lg bg-[#4ade80] text-[#111] px-3.5 py-1.5 text-sm font-semibold">打开画布</button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-white/60">
            <span>暂时无法加载创作过程</span>
            <button onClick={onBack} className="rounded-lg bg-white/10 px-4 py-1.5 text-sm">返回</button>
          </div>
        ) : snap ? <ProcessSnapshot snapshot={snap} /> : <div className="h-full flex items-center justify-center text-white/40">加载中…</div>}
      </div>
    </div>
  );
}
