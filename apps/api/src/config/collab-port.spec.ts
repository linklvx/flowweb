// TD-32/C2 T16：端口解析单源（spec §4.2.1）——严格十进制、'0'=ephemeral、
// production 拒 0 的显式 opt-in 断言（纯函数可单测）。
import { describe, it, expect } from 'vitest';
import { resolveCollabPort, assertProductionCollabPort } from './collab-port';

describe('TD-32/T16 resolveCollabPort：端口解析单源（严格十进制）', () => {
  it('未设/空串/空白=回退值（blank 不落 Number("")===0 坑）', () => {
    expect(resolveCollabPort(undefined, 3001)).toBe(3001);
    expect(resolveCollabPort('', 3001)).toBe(3001);
    expect(resolveCollabPort('   ', 3001)).toBe(3001);
    expect(resolveCollabPort(undefined, 3000)).toBe(3000);
  });

  it("'0'=0（ephemeral——不再坑成回退值）", () => {
    expect(resolveCollabPort('0', 3001)).toBe(0);
    expect(resolveCollabPort('0', 3000)).toBe(0);
  });

  it('十进制端口通过；上界 65535', () => {
    expect(resolveCollabPort('3001', 3000)).toBe(3001);
    expect(resolveCollabPort('65535', 3000)).toBe(65535);
  });

  it.each(['0x10', '1e3', '-1', '65536', 'abc', '3001abc', '+3001'])(
    '非法值 %s fail-fast（严格十进制——不静默回退）',
    (raw) => {
      expect(() => resolveCollabPort(raw, 3001)).toThrow(/非法/);
    },
  );
});

describe('TD-32/T16 assertProductionCollabPort：production 拒 ephemeral（显式 opt-in 除外）', () => {
  it('production+0 抛（无 opt-in）', () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'production', COLLAB_PORT: 0 })).toThrow(/COLLAB_ALLOW_EPHEMERAL/);
  });

  it('production+3001 过', () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'production', COLLAB_PORT: 3001 })).not.toThrow();
  });

  it('production 未设端口过（使用点回退 3001）', () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('development+0 过', () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'development', COLLAB_PORT: 0 })).not.toThrow();
  });

  it('test+0 过', () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'test', COLLAB_PORT: 0 })).not.toThrow();
  });

  it("production+0+COLLAB_ALLOW_EPHEMERAL='1' 过（drill 显式豁免档）", () => {
    expect(() => assertProductionCollabPort({ NODE_ENV: 'production', COLLAB_PORT: 0, COLLAB_ALLOW_EPHEMERAL: '1' })).not.toThrow();
  });
});
