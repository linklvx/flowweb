// Y0a-2：spool 单测目录助手——mkdtemp 独立目录+afterAll 清理（禁共享目录：用例间段状态互染）。
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function makeSpoolDir(prefix = 'y0a2-spool-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  // TD-33 T7：teardown 与并发写回竞态（t9-actor ENOTEMPTY）——重试退避缓解（Windows EBUSY 同族）。
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) };
}
