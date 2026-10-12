// apps/web/src/test/fakeIndexedDb.ts
// 测试装置：最小内存版 IndexedDB stub（jsdom 无实现——T8 适配器测试/runtime 装置共用）。
// 建模面=适配器/purge 实际消费的子集：open(version)+onupgradeneeded/onsuccess/onerror/onblocked、
// objectStore get/put、transaction oncomplete/onabort/onerror、close/onversionchange、
// deleteDatabase/databases。回调经微任务触发（promise 链路可 await）。
// 语义锚：真 IDB 在 onupgradeneeded 时 req.result 已是连接（先建连接再发升级事件）；
// deleteDatabase 在存在未关闭连接时走 onblocked（T5 purge blocked 用例同款）；
// 事务完成晚于其上全部请求（双微任务——get/put 先落地再 complete）。
// 不建模：事务 onabort 实际触发（无 abort 入口）/open 侧 onblocked/versionerror——错误面仅 failNextOpen 注入,勿误认全覆盖。
import { vi } from 'vitest';

export interface FakeDbConnection {
  name: string;
  closed: boolean;
  onversionchange: (() => void) | null;
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: ReturnType<typeof vi.fn>;
  transaction: (name: string, mode: string) => FakeTransaction;
  close: () => void;
}

export interface FakeTransaction {
  objectStore: (name: string) => {
    get: (key: string) => { result?: unknown; onsuccess?: () => void; onerror?: () => void };
    put: (value: unknown, key: string) => unknown;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

export interface FakeOpenRequest {
  result: FakeDbConnection | null;
  error: unknown;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
}

export interface FakeIndexedDbFactory {
  fake: {
    databases: () => Promise<Array<{ name?: string }>>;
    deleteDatabase: (name: string) => { onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null };
    open: (name: string, version?: number) => FakeOpenRequest;
  };
  /** 库内数据直读（断言落盘内容用——绕事务面） */
  data: Map<string, Map<string, unknown>>;
  /** 模拟他标签页触发 versionchange（对该库全部存活连接回调） */
  triggerVersionChange: (name: string) => void;
  /** 触发下一次 open 的 onerror（错误面用例） */
  failNextOpen: () => void;
}

export function createFakeIndexedDb(): FakeIndexedDbFactory {
  const data = new Map<string, Map<string, unknown>>();
  const conns = new Map<string, Set<FakeDbConnection>>();
  let failNext = false;

  const fake = {
    databases: async () => [...data.keys()].map((name) => ({ name })),
    deleteDatabase: (name: string) => {
      const req = { onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onblocked: null as (() => void) | null };
      queueMicrotask(() => {
        const holders = conns.get(name);
        if (holders && [...holders].some((c) => !c.closed)) { req.onblocked?.(); return; }   // 未关闭连接=blocked（真语义）
        data.delete(name);
        req.onsuccess?.();
      });
      return req;
    },
    open: (name: string, _version?: number) => {
      const req: FakeOpenRequest = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => {
        if (failNext) {
          failNext = false;
          req.error = new Error('idb open failed (injected)');
          req.onerror?.();
          return;
        }
        const isNew = !data.has(name);
        if (isNew) data.set(name, new Map());
        const store = data.get(name)!;
        const conn: FakeDbConnection = {
          name,
          closed: false,
          onversionchange: null,
          objectStoreNames: { contains: (s: string) => s === 'kv' },
          createObjectStore: vi.fn(),
          transaction: (_s: string, _m: string) => makeTransaction(store),
          close() { conn.closed = true; conns.get(name)?.delete(conn); },
        };
        if (!conns.has(name)) conns.set(name, new Set());
        conns.get(name)!.add(conn);
        req.result = conn;          // 真 IDB：升级事件期 result 已是连接
        if (isNew) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };

  function makeTransaction(store: Map<string, unknown>): FakeTransaction {
    let aborted = false;
    const tx: FakeTransaction = {
      oncomplete: null, onerror: null, onabort: null,
      objectStore: () => ({
        get: (key: string) => {
          const req: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
          queueMicrotask(() => { req.result = store.get(key); req.onsuccess?.(); });
          return req;
        },
        put: (value: unknown, key: string) => {
          queueMicrotask(() => { if (!aborted) store.set(key, value); });
          return {};
        },
      }),
    };
    // 完成=晚于本事务全部请求（双微任务——请求单微任务落地后 complete 才跑）
    queueMicrotask(() => queueMicrotask(() => {
      if (aborted) tx.onabort?.();
      else tx.oncomplete?.();
    }));
    return tx;
  }

  return {
    fake,
    data,
    triggerVersionChange: (name: string) => {
      for (const c of conns.get(name) ?? []) c.onversionchange?.();
    },
    failNextOpen: () => { failNext = true; },
  };
}
