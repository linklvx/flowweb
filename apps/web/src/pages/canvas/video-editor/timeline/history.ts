/** 契约：T 实例入栈/跨栈后不可原地变更——pushHistory 深拷入栈，但 undo/redo 的 current 按引用跨栈（store 侧全部不可变更新是前提） */
export interface History<T> {
  past: T[];
  future: T[];
  limit: number;
}

export function createHistory<T>(limit = 50): History<T> {
  return { past: [], future: [], limit };
}

/** 入栈前 JSON 深拷（禁持引用；structuredClone 对历史 data 非常规值可能抛 DataCloneError——Plan 1 A1 口径） */
export function pushHistory<T>(h: History<T>, snapshot: T): History<T> {
  const clone = JSON.parse(JSON.stringify(snapshot));
  const past = [...h.past, clone];
  if (past.length > h.limit) past.shift();
  return { ...h, past, future: [] }; // 新操作清 redo
}

export function undoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const past = [...h.past];
  const prev = past.pop()!;
  return { history: { ...h, past, future: [current, ...h.future] }, state: prev };
}

export function redoHistory<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const [next, ...future] = h.future;
  return { history: { ...h, past: [...h.past, current], future }, state: next };
}
