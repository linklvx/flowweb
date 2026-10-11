// Y0b-4 T1：画布配额常量+doc-status/conn-status 快照类型契约（字段一致矩阵——T5 服务端产生/
// T10 客户端消费，键集漂移=执行卡死；本测即四侧键集的字面量锚）。
import { describe, it, expect } from 'vitest';
import {
  QUOTA_DEFAULTS, DOC_STATUS_REV_SEED,
  isCollabDocStatusPayload, isCollabConnStatusPayload, type CollabDocStatusPayload,
} from './collab-quota';

describe('Y0b-4 T1 QUOTA_DEFAULTS（配额常量单源——T4/T5 服务端执法消费）', () => {
  it('QUOTA_DEFAULTS 默认锁定（8MB/256KB/2000/0.8 进 0.6 出/4KB）', () => {
    expect(QUOTA_DEFAULTS).toMatchObject({ maxDocBytes: 8_388_608, maxTxBytes: 262_144,
      maxKeyBytes: 262_144, maxNodesPerTx: 2000, softEnterRatio: 0.8, softExitRatio: 0.6,
      awarenessLimitBytes: 4096 });
  });
});

describe('Y0b-4 T1 doc-status 快照类型（T5 产生/T10 消费——键集逐字一致）', () => {
  it('CollabDocStatusPayload 恰好 {type,rev,writeFrozen,quota{state,bytes,limit,maxTxBytes,softLimitBytes}}——无 readOnly/无 deletedIds（v4 字段集合断言防复活）', () => {
    // satisfies 编译期锚（typecheck 红=牙）：fixture 键集与类型逐字绑定——类型侧字段改名/删除即编译红；
    // 行为断言把同一 fixture 与校验函数挂钩——校验函数必选集合同步漂移即运行红（三方两两锁定，
    // 替换原 Object.keys(ok.quota) 自指断言——断言对象是测试自构造 fixture，永不可能红）
    const ok = { type: 'doc-status', rev: 3, writeFrozen: false,
      quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 262144, softLimitBytes: 8388608 } } satisfies CollabDocStatusPayload;
    expect(isCollabDocStatusPayload(ok)).toBe(true);
    // v6 报告3 P0-2A：删 readOnly 前向兼容 true 断言——"额外字段不破坏"是通用校验哲学，
    // 写进这条契约测试会诱导后来者保留 readOnly（Q-A 要消灭的 per-conn 量走 per-doc 广播形态）
    expect(isCollabDocStatusPayload({ type: 'doc-status', rev: 3, writeFrozen: false,
      quota: { state: 'ok', bytes: 1, limit: 10 } })).toBe(false);                  // 缺 maxTxBytes=拒
  });
  it('doc-status 顶层可选 generation?:number+quota 可选 residueBytes?:number（vacuum 代际+T11 入口数据源——Q-U v6；缺省=valid；T5 产生/T9a 递增/T11 消费四处对齐——字段一致矩阵）', () => {
    expect(isCollabDocStatusPayload({ type: 'doc-status', rev: 3, writeFrozen: false, generation: 7,
      quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 262144, softLimitBytes: 8388608, residueBytes: 4096 } })).toBe(true);
    expect(isCollabDocStatusPayload({ type: 'doc-status', rev: 3, writeFrozen: false, generation: '7',
      quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 262144, softLimitBytes: 8388608 } })).toBe(false); // 可选字段带错型=拒
    // NaN typeof==='number' 可穿透纯 typeof 检查——NaN 代际流入 T9a/T11 代际比较恒 false=代际门静默失效
    expect(isCollabDocStatusPayload({ type: 'doc-status', rev: 3, writeFrozen: false, generation: NaN,
      quota: { state: 'over', bytes: 9, limit: 10, maxTxBytes: 262144, softLimitBytes: 8388608 } })).toBe(false); // NaN=拒（与其余数值字段同矩）
  });
  it('rev 从 1 起（装载播种 1——初值 0 会被客户端 rev<=last 守卫丢掉首快照=limit 来源恒丢，报告2 F）', () => {
    expect(DOC_STATUS_REV_SEED).toBe(1);
  });
  it('CollabConnStatusPayload {type:conn-status,readOnly}（每连接推送——Q-A v4）', () => {
    expect(isCollabConnStatusPayload({ type: 'conn-status', readOnly: true })).toBe(true);
    expect(isCollabConnStatusPayload({ type: 'conn-status', readOnly: false })).toBe(true);
    expect(isCollabConnStatusPayload({ type: 'doc-status', readOnly: true })).toBe(false);  // type 分型互斥
    expect(isCollabConnStatusPayload({ type: 'conn-status' })).toBe(false);                 // 缺 readOnly=拒
  });
});
