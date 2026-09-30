// apps/web/src/stores/syncStatus.spec.ts
// 批2-1：hydration 四态 + canEdit 合取 + 生产源静态锚（spec 状态层 / hydration 组 / canEdit 门组）。
// 会话驱动的四态定向（initCollab pending/synced ready/超时 failed/destroy idle）与 collabReadOnly
// 粘滞覆盖在 conn.spec（需 mock provider 事件序）；本文件覆盖 store 初值、canEdit 真值表、
// 静态断言（isHydrating 零残留 / setHydration 单写者 / provider 工厂唯一字面量）。
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import * as path from 'path';
import { useCanvasStore, type CanvasState } from './canvasStore';
import { canEdit } from './syncStatus';

/** 仓根定位（envelope-serialization-guard 同款）：从 cwd 向上找 pnpm-workspace.yaml（vitest cwd=包根） */
function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found from ' + start);
}
const ROOT = findRepoRoot(process.cwd());

function listProdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listProdFiles(p));
    else if (/\.(ts|tsx)$/.test(e) && !/\.(test|spec)\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const WEB_SRC = path.join(ROOT, 'apps/web/src');
/** 剥注释（块/行）——断言针对活代码标识符；迁移期注释保留历史名（"原 isHydrating latch 职责
 *  迁入"类说明是文档，不是残留）。过度剥离只致漏报（保守方向），不影响锁的零误报。 */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const prodSources = listProdFiles(WEB_SRC).map((f) => ({
  rel: path.relative(ROOT, f).split(path.sep).join('/'),
  text: stripComments(readFileSync(f, 'utf8')),
}));

describe('hydration 四态初值（store 层）', () => {
  it('getInitialState().hydration === "idle"（无会话默认）', () => {
    expect(useCanvasStore.getInitialState().hydration).toBe('idle');
  });

  it('collabReadOnly 初值 true（粘滞只读保守——HTTP 无 role 字段 R30）', () => {
    expect(useCanvasStore.getInitialState().collabReadOnly).toBe(true);
  });

  it('wsAuthNotice null / httpExpired false 初值', () => {
    expect(useCanvasStore.getInitialState().wsAuthNotice).toBeNull();
    expect(useCanvasStore.getInitialState().httpExpired).toBe(false);
  });

  it('setHydration 定向转移（单写者 action）', () => {
    const s = useCanvasStore.getState();
    s.setHydration('pending');
    expect(useCanvasStore.getState().hydration).toBe('pending');
    useCanvasStore.getState().setHydration('ready');
    expect(useCanvasStore.getState().hydration).toBe('ready');
    useCanvasStore.getState().setHydration('failed');
    expect(useCanvasStore.getState().hydration).toBe('failed');
    useCanvasStore.getState().setHydration('idle');
    expect(useCanvasStore.getState().hydration).toBe('idle');
  });
});

describe('canEdit 合取（ready && !collabReadOnly && !terminal）', () => {
  /** 真 store 态铺底 + 定向 patch（canEdit 只读三键——铺底避免整 state 手构） */
  const withPatch = (patch: Partial<CanvasState>): CanvasState =>
    ({ ...useCanvasStore.getState(), ...patch });

  it('三条件全真 → true', () => {
    useCanvasStore.setState({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null });
    expect(canEdit(useCanvasStore.getState())).toBe(true);
    expect(canEdit(withPatch({}))).toBe(true);
  });

  it.each(['idle', 'pending', 'failed'] as const)('hydration=%s → false', (h) => {
    expect(canEdit(withPatch({ hydration: h, collabReadOnly: false, wsAuthNotice: null }))).toBe(false);
  });

  it('collabReadOnly=true → false（即使 ready）', () => {
    expect(canEdit(withPatch({ hydration: 'ready', collabReadOnly: true, wsAuthNotice: null }))).toBe(false);
  });

  it('wsAuthNotice.terminal=true → false', () => {
    expect(canEdit(withPatch({
      hydration: 'ready', collabReadOnly: false,
      wsAuthNotice: { reason: 'session-expired', terminal: true },
    }))).toBe(false);
  });

  it('wsAuthNotice 非 terminal（瞬态通知）→ 仍 true（瞬态不夺编辑权）', () => {
    expect(canEdit(withPatch({
      hydration: 'ready', collabReadOnly: false,
      wsAuthNotice: { reason: 'db-unavailable', terminal: false },
    }))).toBe(true);
  });

  it('httpExpired=true 置位时 canEdit 仍 true（反向断言——HTTP 过期面不进 canEdit）', () => {
    expect(canEdit(withPatch({ hydration: 'ready', collabReadOnly: false, wsAuthNotice: null, httpExpired: true }))).toBe(true);
  });
});

describe('批2-1 静态断言（生产源扫描，spec 静态断言两条 + isHydrating 删除锚）', () => {
  it('isHydrating/setHydrating 零残留（字段删除——R25 不留镜像第二真相源）', () => {
    const hits = prodSources.filter((s) => /isHydrating|setHydrating/.test(s.text));
    expect(hits.map((h) => h.rel)).toEqual([]);
  });

  it('new HocuspocusProvider 字面量仅在 canvasCollabRuntime 且唯一一处（createProvider 工厂）', () => {
    const hits = prodSources.filter((s) => /new HocuspocusProvider/.test(s.text));
    expect(hits.map((h) => h.rel)).toEqual(['apps/web/src/stores/canvasCollabRuntime.ts']);
    const runtime = prodSources.find((s) => s.rel === 'apps/web/src/stores/canvasCollabRuntime.ts')!;
    expect(runtime.text.match(/new HocuspocusProvider/g)?.length).toBe(1);
  });

  it('hydration 单写者：生产源 setState 直写 hydration 零命中（只经 setHydration action）', () => {
    // 对象字面量形态（嵌套大括号不扫——生产写点均为平对象，文档化取舍）
    const hits = prodSources.filter((s) => /setState\(\s*\{[^{}]*\bhydration\s*:/.test(s.text));
    expect(hits.map((h) => h.rel)).toEqual([]);
  });
});
