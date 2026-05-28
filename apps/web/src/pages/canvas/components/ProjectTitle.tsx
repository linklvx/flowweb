import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  projectId: string;
  projectName: string;
  onNameChange?: (name: string) => void;
}

export function ProjectTitle({ projectId, projectName: initialName, onNameChange }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
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
      fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <div className="absolute top-3 left-4 z-50 flex items-center gap-2 bg-[#1A1A1A]/90 backdrop-blur px-3 py-1.5 rounded-full border border-[#333] shadow-lg">
      <span className="text-[#4ade80] font-bold text-sm select-none">
        🧠 Flow123
      </span>
      <span className="text-[#555] select-none">/</span>
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
          className="bg-[#252525] border border-[#4ade80] rounded px-1.5 py-0.5 text-xs text-[#e2e8f0] outline-none min-w-[80px]"
          maxLength={30}
        />
      ) : (
        <span
          onClick={startEdit}
          className="text-xs text-[#ccc] cursor-pointer hover:text-white transition-colors border border-transparent hover:border-[#555] rounded px-1.5 py-0.5"
          title="点击编辑项目名称"
        >
          {name}
        </span>
      )}
    </div>
  );
}
