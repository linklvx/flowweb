// TD-33/C1b T9：ErasureRegistry（PG 权威两集合：blocked 写拒绝/purgeable 可清残）。
// 单测=服务契约+一条 SQL 的谓词文本锚（真库语义由本项目 registry.int.spec 背书——blocked 五档/
// purgeable 九档/dry-run 四例必须是真 SQL 判定，mock 行只证映射不改判定）。
import { describe, it, expect, vi } from 'vitest';
import { register } from 'prom-client';
import { CollabErasureRegistryService } from './collab-erasure-registry.service';

type Row = {
  projectId: string;
  blocked: 'ERASING' | 'ERASED' | null;
  restorePending: boolean;
  purgeable: boolean;
  manifestMissing: boolean;
};

const row = (over: Partial<Row> & { projectId: string }): Row => ({
  blocked: null, restorePending: false, purgeable: false, manifestMissing: false, ...over,
});

function svc(impl: (q: unknown[]) => Promise<Row[]> | Row[]) {
  const q = vi.fn(async (strings: unknown, ...vals: unknown[]) => impl([strings, ...vals]));
  return { s: new CollabErasureRegistryService({ $queryRaw: q } as never), q };
}

const sqlText = (c: unknown[]): string => (c[0] as readonly string[]).join('?');
const counterValue = async (name: string): Promise<number> =>
  (await register.getSingleMetric(name)!.get()).values[0]?.value ?? 0;

describe('TD-33 C1b T9：ErasureRegistry', () => {
  it('load 映射：blocked ERASING/ERASED 分档+purgeable 快照+restorePending 子集；gauge 同步', async () => {
    const { s } = svc(() => [
      row({ projectId: 'p1', blocked: 'ERASING' }),
      row({ projectId: 'p2', blocked: 'ERASED', purgeable: true }),
      row({ projectId: 'p3', blocked: 'ERASING', restorePending: true }),
    ]);
    await s.load({ force: true });
    expect(s.isBlocked('p1')).toBe('ERASING');
    expect(s.isBlocked('p2')).toBe('ERASED');
    expect(s.isBlocked('p3')).toBe('ERASING');
    expect(s.isBlocked('nope')).toBeUndefined();
    expect(s.listPurgeableProjectIds()).toEqual(['p2']);
    expect(s.restorePendingCount()).toBe(1);
    expect(await counterValue('yjs_blocked_projects')).toBe(3);   // p1+p2+p3
    expect(await counterValue('yjs_purgeable_projects')).toBe(1);
    expect(await counterValue('restore_pending_projects')).toBe(1);
  });

  it('一条 SQL 的谓词文本锚：两集合同快照+CanvasProject 起点∪run 双支+非等值 ACTIVE+active/terminal 分档+NOT EXISTS', async () => {
    const { s, q } = svc(() => []);
    await s.load();
    const sql = sqlText(q.mock.calls[0] as unknown[]);
    expect(sql).toMatch(/"scopeType"\s*=\s*'project'/);
    expect(sql).toMatch(/"dryRun"\s*=\s*false/);
    expect(sql).toMatch(/"lifecycleState"\s*<>\s*'ACTIVE'/);          // 非等值判定（未来状态值 fail-closed）
    expect(sql).toMatch(/NOT IN \('DONE', ?'FAILED'\)/);               // active run 档
    expect(sql).toMatch(/"ProjectErasureRun"/);
    expect(sql).toMatch(/FROM "CanvasProject"/);                       // 起点双支 UNION（Team DISBANDING 无 run 窗）
    expect(sql).toMatch(/JOIN "Team"/);
    expect(sql).toMatch(/NOT EXISTS/);                                 // purgeable=行不存在
    expect(sql).toMatch(/FULL OUTER JOIN/);                            // 两集合同一次查询
  });

  it('mark 即时生效；load 期间的新 mark 经 version/merge 不被快照覆盖', async () => {
    let release!: (rows: Row[]) => void;
    const { s } = svc(() => new Promise<Row[]>((r) => { release = r; }));
    const loading = s.load();
    s.mark('pX', 'ERASING');
    expect(s.isBlocked('pX')).toBe('ERASING');   // 即时（不等 load）
    release([]);
    await loading;
    expect(s.isBlocked('pX')).toBe('ERASING');   // during-mark 合并（version>查询起点）
  });

  it('purgeable⊆blocked fail-closed：异常行（purgeable 但无 blocked）按 ERASED 拒写', async () => {
    const { s } = svc(() => [row({ projectId: 'p9', blocked: null, purgeable: true })]);
    await s.load();
    expect(s.isBlocked('p9')).toBe('ERASED');
    expect(s.listPurgeableProjectIds()).toEqual(['p9']);
  });

  it('single-flight：并发 load 只发一次查询（force 不绕过在飞共享；无短缓存=先后两次各查一次）', async () => {
    const pending: Array<(rows: Row[]) => void> = [];
    const { s, q } = svc(() => new Promise<Row[]>((r) => { pending.push(r); }));
    const a = s.load();
    const b = s.load();
    pending[0]!([]);
    await Promise.all([a, b]);
    expect(q).toHaveBeenCalledTimes(1);
    const c = s.load({ force: true });
    pending[1]!([]);
    await c;
    expect(q).toHaveBeenCalledTimes(2);   // 无短缓存：再次 load 必取新快照（陈旧快照=擦除陈旧窗）
  });

  it('refresh 失败保留旧 Map 不替换+erasure_refresh_failures_total inc；恢复成功后替换', async () => {
    let fail = false;
    const { s } = svc(() => {
      if (fail) return Promise.reject(new Error('pg down'));
      return [row({ projectId: 'p1', blocked: 'ERASING' })];
    });
    await s.load();
    const before = await counterValue('erasure_refresh_failures_total');
    fail = true;
    await s.refresh();
    expect(s.isBlocked('p1')).toBe('ERASING');   // 旧快照保持（清空=新擦除项目短窗放行）
    expect((await counterValue('erasure_refresh_failures_total')) - before).toBe(1);
    fail = false;
    await s.refresh();
    expect(s.isBlocked('p1')).toBe('ERASING');
  });

  it('refresh single-flight：在飞即跳过（慢查询重叠不叠发，旧快照不晚归覆盖新状态）', async () => {
    let release!: (rows: Row[]) => void;
    const { s, q } = svc(() => new Promise<Row[]>((r) => { release = r; }));
    const first = s.refresh();
    const second = s.refresh();   // 在飞即跳过（立即返回）
    release([row({ projectId: 'p1', blocked: 'ERASING' })]);
    await Promise.all([first, second]);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('erasure_manifest_missing_total per-pid 去重：同一 pid 跨轮 refresh 只计一次', async () => {
    const { s } = svc(() => [row({ projectId: 'pm', blocked: 'ERASED', purgeable: true, manifestMissing: true })]);
    const before = await counterValue('erasure_manifest_missing_total');
    await s.load();
    await s.refresh();
    await s.refresh();
    expect((await counterValue('erasure_manifest_missing_total')) - before).toBe(1);
  });

  it('listPurgeableProjectIdsLive：批量 IN/ANY 单查询+只回命中；空输入零查询', async () => {
    const q = vi.fn(async () => [{ projectId: 'p2' }]);
    const s = new CollabErasureRegistryService({ $queryRaw: q } as never);
    await expect(s.listPurgeableProjectIdsLive([])).resolves.toEqual(new Set());
    expect(q).not.toHaveBeenCalled();
    const hit = await s.listPurgeableProjectIdsLive(['p1', 'p2', 'p3']);
    expect([...hit]).toEqual(['p2']);
    const call = q.mock.calls[0] as unknown[];
    const sql = sqlText(call);
    expect(sql).toMatch(/= ANY/);
    expect(sql).toMatch(/"scopeType"\s*=\s*'project'/);
    expect(sql).toMatch(/"dryRun"\s*=\s*false/);
    expect(sql).toMatch(/NOT EXISTS/);
  });
});
