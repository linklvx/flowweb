// apps/api/src/test-utils/failing-repo.ts
// Y0a-1：repo 边界故障注入助手（单测/int 层）——v2.2 砍 Proxy 形态（无消费者且与 dist 排除矛盾）。
// Y0a-2 演练层（子进程注入）改用 DB 触发器/REVOKE（spec Y0a-2 移入项登记）。
import { createMockRepo, type MockRepo } from './mock-repo';

export function failingRepo(opts: { failAppend?: number; failCompact?: number } = {}): MockRepo {
  const repo = createMockRepo();
  // Y0a-2 Step 1（Y0a-1 Minor 1 登记——本 Task 出现消费者）：失败 N 次**后回工厂默认形状**
  // 而非 resolve undefined（undefined 违反 AppendResult 契约 §1.2——消费者 `r.ok` 判别读到
  // undefined 会误入"no row"分支，红相失真）。
  if (opts.failAppend != null) {
    const defaultImpl = repo.append.getMockImplementation()!;   // 工厂默认（{ok:true,seq:1n}）
    let appends = 0;
    repo.append.mockImplementation(async (...args: Parameters<MockRepo['append']>) => {
      appends += 1;
      if (appends <= opts.failAppend!) throw new Error(`injected append failure #${appends}`);
      return defaultImpl(...args);
    });
  }
  if (opts.failCompact != null) {
    const defaultCompact = repo.compact.getMockImplementation()!;
    let compacts = 0;
    repo.compact.mockImplementation(async (...args: Parameters<MockRepo['compact']>) => {
      compacts += 1;
      if (compacts <= opts.failCompact!) throw new Error(`injected compact failure #${compacts}`);
      return defaultCompact(...args);
    });
  }
  return repo;
}
