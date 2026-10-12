// apps/web/src/collab/local-cache-key.test.ts
// Y0b-5 T5：世代可见通道四维缓存键+本地缓存库 purge 单测。
// 键布局=每 (uid,pid,generation,schemaVersion) 一库（库名=四维键）：uid 隔离 origin 级越权
//（换账号不读他人库）；generation 隔离 F1 无限刷新循环/F2 静默投毒；schemaVersion 隔离旧 schema 内容。
// purge 用注入式 indexedDB stub（vi.stubGlobal——模块调用时读全局，测试缝零侵入）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildLocalCacheKey, parseLocalCacheKey,
  purgeForeignCaches, purgePidCaches, purgeUidCaches,
} from './local-cache-key';

const KEY = (uid: string, pid: string, g: number, s: number) => `flowweb:collab:${uid}:${pid}:g${g}:s${s}`;

/** fake indexedDB：databases()/deleteDatabase(name) 最小面——deleteDatabase 返回可挂回调的伪请求，
 *  回调触发方式由 trigger 控制（'success' 默认 / 'blocked'——onblocked 防悬挂用例）。 */
function stubIdb(dbNames: string[], trigger: 'success' | 'blocked' = 'success') {
  const deleted: string[] = [];
  const fake = {
    databases: vi.fn(async () => dbNames.map((name) => ({ name }))),
    deleteDatabase: vi.fn((name: string) => {
      deleted.push(name);
      const req: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      queueMicrotask(() => {
        if (trigger === 'blocked') req.onblocked?.();
        else req.onsuccess?.();
      });
      return req;
    }),
  };
  vi.stubGlobal('indexedDB', fake);
  return { fake, deleted };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);   // jsdom 无实现——各用例自备 stub（默认缺失=能力降级态）
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildLocalCacheKey：四维合成（纯函数）', () => {
  it('键=flowweb:collab:${uid}:${pid}:g${generation}:s${schemaVersion}', () => {
    expect(buildLocalCacheKey({ uid: 'u1', pid: 'p1', generation: 3, schemaVersion: 2 }))
      .toBe('flowweb:collab:u1:p1:g3:s2');
  });

  it('parse 往返（uid/pid 为 cuid 字符集——分隔符无歧义）；非本族键/形状不符返回 null', () => {
    expect(parseLocalCacheKey(KEY('uid1', 'pid1', 7, 2))).toEqual({ uid: 'uid1', pid: 'pid1', generation: 7, schemaVersion: 2 });
    expect(parseLocalCacheKey('flowweb:collab:u1:p1:g3')).toBeNull();
    expect(parseLocalCacheKey('some-other-db')).toBeNull();
    expect(parseLocalCacheKey('')).toBeNull();
  });
});

describe('purgeForeignCaches：同 uid:pid 异代库清理（世代变化路径）', () => {
  it('枚举 databases() 删同 uid:pid 异代库；当前键/异 pid/异 uid 库保留', async () => {
    const { deleted } = stubIdb([
      KEY('u1', 'p1', 3, 2),   // 当前键——保留
      KEY('u1', 'p1', 2, 2),   // 同 uid:pid 异代——删
      KEY('u1', 'p1', 3, 1),   // 同 uid:pid 异 schemaVersion（=异代族）——删
      KEY('u1', 'p2', 9, 2),   // 异 pid——保留
      KEY('u2', 'p1', 3, 2),   // 异 uid——保留（他人库禁碰）
      'unrelated-db',          // 非本族键——保留
    ]);
    await purgeForeignCaches(KEY('u1', 'p1', 3, 2));
    expect(deleted).toEqual([KEY('u1', 'p1', 2, 2), KEY('u1', 'p1', 3, 1)]);
  });

  it('幂等：无匹配再跑零动作（deleteDatabase 零调用）', async () => {
    const { fake, deleted } = stubIdb([KEY('u1', 'p1', 3, 2)]);
    await purgeForeignCaches(KEY('u1', 'p1', 3, 2));
    expect(deleted).toEqual([]);
    expect(fake.deleteDatabase).not.toHaveBeenCalled();
  });

  it('键非法（parse null）→零动作', async () => {
    const { deleted } = stubIdb([KEY('u1', 'p1', 3, 2)]);
    await purgeForeignCaches('garbage');
    expect(deleted).toEqual([]);
  });
});

describe('purgePidCaches / purgeUidCaches：全代清理（terminal 无读权/项目删除/登出）', () => {
  it('purgePidCaches：该 uid:pid 全部代（含当前代）删除；异 pid/异 uid 保留', async () => {
    const { deleted } = stubIdb([
      KEY('u1', 'p1', 3, 2), KEY('u1', 'p1', 2, 2),
      KEY('u1', 'p2', 3, 2), KEY('u2', 'p1', 3, 2),
    ]);
    await purgePidCaches('u1', 'p1');
    expect(deleted).toEqual([KEY('u1', 'p1', 3, 2), KEY('u1', 'p1', 2, 2)]);
  });

  it('purgeUidCaches：该 uid 全部 pid 全部代删除；异 uid 保留', async () => {
    const { deleted } = stubIdb([
      KEY('u1', 'p1', 3, 2), KEY('u1', 'p2', 0, 2),
      KEY('u2', 'p1', 3, 2),
    ]);
    await purgeUidCaches('u1');
    expect(deleted).toEqual([KEY('u1', 'p1', 3, 2), KEY('u1', 'p2', 0, 2)]);
  });
});

describe('能力降级与阻塞防线', () => {
  it('indexedDB.databases 不可用（旧 Safari/Firefox）→跳过不抛不阻断', async () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: vi.fn() });   // 无 databases 方法
    await expect(purgeForeignCaches(KEY('u1', 'p1', 3, 2))).resolves.toBeUndefined();
    await expect(purgePidCaches('u1', 'p1')).resolves.toBeUndefined();
    await expect(purgeUidCaches('u1')).resolves.toBeUndefined();
  });

  it('indexedDB 全局缺失（SSR/测试默认态）→跳过不抛', async () => {
    await expect(purgeForeignCaches(KEY('u1', 'p1', 3, 2))).resolves.toBeUndefined();
  });

  it('databases() reject→吞掉不抛（purge fail-soft——磁盘卫生层不阻断主链）', async () => {
    vi.stubGlobal('indexedDB', {
      databases: vi.fn(async () => { throw new Error('boom'); }),
      deleteDatabase: vi.fn(),
    });
    await expect(purgeForeignCaches(KEY('u1', 'p1', 3, 2))).resolves.toBeUndefined();
  });

  it('deleteDatabase onblocked→resolve 不悬挂（他标签页持连接——该库留待下次 purge，其余库照删）', async () => {
    const { deleted } = stubIdb([
      KEY('u1', 'p1', 2, 2),   // 第一顺——blocked
      KEY('u1', 'p1', 1, 2),   // 第二顺——验证 blocked 后继续
    ], 'blocked');
    await expect(purgeForeignCaches(KEY('u1', 'p1', 3, 2))).resolves.toBeUndefined();
    expect(deleted).toEqual([KEY('u1', 'p1', 2, 2), KEY('u1', 'p1', 1, 2)]);
  }, 2_000);
});
