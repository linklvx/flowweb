import { useEffect } from 'react';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { useEditorStore } from '../store/editorStore';
import { togglePlayback } from './playback';

/** 编辑器内键盘：Delete 删片段 / Ctrl+Z·Ctrl+Shift+Z·Ctrl+Y 撤销重做 / 空格防滚动（播放 Plan 3）。
 *  画布层快捷键已被 isGroupEditContext 早退禁用（Task 11）——本 hook 只服务编辑器 open 期间。
 *  挂载点定死：TimelinePanel 组件体内调用（时间轴是唯一消费方，Shell 不该管键盘） */
export function useEditorKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!useVideoEditorStore.getState().open) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const es = useEditorStore.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (es.selectedClipId) { e.preventDefault(); es.removeClip(es.selectedClipId); }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault(); es.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault(); es.redo();
      } else if (e.key === ' ') {
        e.preventDefault(); // 防页面滚动；播放/暂停 toggle（决策 9——hook 依赖 playback 模块而非组件）
        void togglePlayback();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
}
