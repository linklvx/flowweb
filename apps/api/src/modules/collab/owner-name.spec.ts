// TD-33/C1a T1：owner 目录名单源——`o-` 前缀把「本进程 owner 目录」与同根下一切其他目录
// （tmp/owner-A/旧格式）区分开；parse 从右严格解析（host 段可含 '-'，只有从右才无歧义）。
// 严格失败一律 null=unknown（调用方按「保留不处置」处理——宁可漏回收不可误删活 owner）。
import { describe, it, expect } from 'vitest';
import { hostname } from 'node:os';
import { buildOwnerName, parseOwnerName, currentHostKey } from './owner-name';

const HASH = /^[0-9a-f]{8}$/;

describe('owner-name 单源（TD-33 T1）', () => {
  it('合法往返：build→parse 还原 pid 与 hostKey；名字 o- 前缀且 fs-safe ≤64', () => {
    const name = buildOwnerName('node-1.example', 4321);
    expect(name.startsWith('o-')).toBe(true);
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const parsed = parseOwnerName(name);
    expect(parsed?.pid).toBe(4321);
    expect(parsed?.hostKey).toMatch(HASH);
  });

  it('host 段可含 "-"：从右解析不被 host 内的连字符干扰', () => {
    const parsed = parseOwnerName(buildOwnerName('build-agent-7.internal', 99));
    expect(parsed).toEqual({ pid: 99, hostKey: expect.stringMatching(HASH) });
  });

  it('host 含 owner-like 后缀（自身长得像 owner 名）仍正确往返——前缀不可在 host 内部巧合命中', () => {
    const parsed = parseOwnerName(buildOwnerName('x-o-y-z-12ab-345-67890a', 7));
    expect(parsed?.pid).toBe(7);
  });

  it('hostKey 取全 hostname 短 hash：前 24 字符相同的两台 host 不得同 key', () => {
    const base = 'a'.repeat(40);
    const h1 = parseOwnerName(buildOwnerName(base + 'X', 1));
    const h2 = parseOwnerName(buildOwnerName(base + 'Y', 1));
    expect(h1?.hostKey).not.toBe(h2?.hostKey);
  });

  it('hostKey 同 host 稳定（GC 同 host 判据的数据源）', () => {
    const h1 = parseOwnerName(buildOwnerName('node-1', 1));
    const h2 = parseOwnerName(buildOwnerName('node-1', 2));
    expect(h1?.hostKey).toBe(h2?.hostKey);
    expect(h1?.hostKey).toMatch(HASH);
  });

  it('currentHostKey=本机 host 的 hostKey（收录面「同 host」判据单源）', () => {
    const parsed = parseOwnerName(buildOwnerName(hostname(), 1));
    expect(parsed?.hostKey).toBe(currentHostKey());
  });

  it('无 o- 前缀的格式合法名=unknown（旧格式/他人目录一律不认）', () => {
    expect(parseOwnerName('testhost-4321-abc-abcdef')).toBeNull();
    expect(parseOwnerName('O-testhost-12345678-4321-abc-abcdef')).toBeNull();   // 前缀大小写敏感
  });

  it('pid 非法（0/带符号/非数字/超长）=unknown', () => {
    expect(parseOwnerName('o-host-12345678-0-abc-abcdef')).toBeNull();
    expect(parseOwnerName('o-host-12345678--1-abc-abcdef')).toBeNull();
    expect(parseOwnerName('o-host-12345678-x9-abc-abcdef')).toBeNull();
    expect(parseOwnerName('o-host-12345678-12345678901-abc-abcdef')).toBeNull();
  });

  it('rand/hash/ts 形态不符=unknown（严格解析不接受近形）', () => {
    expect(parseOwnerName('o-host-12345678-1-abc-ABCDEF')).toBeNull();          // rand 非小写 hex
    expect(parseOwnerName('o-host-12X45678-1-abc-abcdef')).toBeNull();         // hash 非 hex
    expect(parseOwnerName('o-host-1234567-1-abc-abcdef')).toBeNull();          // hash 长度不符
    expect(parseOwnerName('o-host-12345678-1-AB_C-abcdef')).toBeNull();        // ts 非 base36
  });

  it('缺段/空 host/超长 host=unknown（不得抛错）', () => {
    expect(parseOwnerName('o-host-12345678-1-abcdef')).toBeNull();             // 缺 ts
    expect(parseOwnerName('o--12345678-1-abc-abcdef')).toBeNull();             // host 空
    expect(parseOwnerName(`o-${'a'.repeat(25)}-12345678-1-abc-abcdef`)).toBeNull();   // host>24
    expect(parseOwnerName('')).toBeNull();
  });
});
