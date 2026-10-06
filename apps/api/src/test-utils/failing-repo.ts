// apps/api/src/test-utils/failing-repo.ts
// Y0a-1：repo 边界故障注入助手（单测/int 层）——v2.2 砍 Proxy 形态（无消费者且与 dist 排除矛盾）。
// Y0a-2 演练层（子进程注入）改用 DB 触发器/REVOKE（spec Y0a-2 移入项登记）。
import { createMockRepo, type MockRepo } from './mock-repo';

export function failingRepo(opts: { failAppend?: number; failCompact?: number } = {}): MockRepo {
  const repo = createMockRepo();
  let appends = 0, compacts = 0;
  if (opts.failAppend != null) {
    repo.append.mockImplementation(async () => {
      appends += 1;
      if (appends <= opts.failAppend!) throw new Error(`injected append failure #${appends}`);
    });
  }
  if (opts.failCompact != null) {
    repo.compact.mockImplementation(async () => {
      compacts += 1;
      if (compacts <= opts.failCompact!) throw new Error(`injected compact failure #${compacts}`);
    });
  }
  return repo;
}
