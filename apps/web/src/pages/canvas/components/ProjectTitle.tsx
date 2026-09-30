import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router';
import { Button, Modal } from 'antd';
import { apiFetch } from '@/api/client';
import { ProjectMembersPanel } from './ProjectMembersPanel';

export const ROOT_FOLDER_NAME = '主目录';

interface Props {
  projectId: string;
  projectName: string;
  folderPath?: string[];
  onNameChange?: (name: string) => void;
}

export function ProjectTitle({ projectId, projectName: initialName, folderPath = [], onNameChange }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [showMembers, setShowMembers] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync if parent's projectName changes
  useEffect(() => {
    setName(initialName);
    setDraft(initialName);
  }, [initialName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      setName(trimmed);
      onNameChange?.(trimmed);
      // 批3-3：裸 fetch 收编 apiFetch（401 电平/错误契约统一）；失败回退原名
      apiFetch(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => {
        // Revert on failure
        setName(initialName);
      });
    } else if (!trimmed) {
      // Revert empty name
      setDraft(name);
    }
    setEditing(false);
  }, [draft, name, projectId, initialName]);

  const startEdit = useCallback(() => {
    setDraft(name);
    setEditing(true);
  }, [name]);

  const prefix = folderPath.length > 0 ? `${folderPath.join('/')}/` : `${ROOT_FOLDER_NAME}/`;

  return (
    <>
    <div className="absolute top-3 left-4 z-50 flex items-center gap-2 bg-surface backdrop-blur px-3 py-1.5 rounded-full border border-overlay-2 shadow-lg">
      <Link
        to="/works"
        title="返回工作空间"
        className="text-text font-bold text-sm select-none hover:opacity-80 transition-opacity"
      >
        💦 Flow123
      </Link>
      <span className="text-text-dim-1 select-none">/</span>
      <span className="text-text-dim-2 select-none max-w-[200px] truncate" title={prefix}>
        {prefix}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="bg-surface-dim border border-text-dim-1 rounded px-1.5 py-0.5 text-xs text-text outline-none min-w-[120px]"
          maxLength={30}
        />
      ) : (
        <span
          onClick={startEdit}
          className="text-xs text-text cursor-pointer hover:text-text transition-colors border border-transparent hover:border-text-dim-1 rounded px-1.5 py-0.5"
          title="点击编辑项目名称"
        >
          {name}
        </span>
      )}
      <Button size="small" type="text" className="text-text" onClick={() => setShowMembers(true)}>
        成员
      </Button>
    </div>

    <Modal open={showMembers} title="项目成员" footer={null} onCancel={() => setShowMembers(false)} width={560}>
      <ProjectMembersPanel projectId={projectId} />
    </Modal>
    </>
  );
}
