// apps/api/scripts/provider-late-reconnect-guard.test.mjs —— R5' 共享兜底单测（node:test——
// collab-soak-metrics.test.mjs 同形态；verify 链 scripts-node-test 步注册〔test ⑥ 平铺面防漂移〕）。
// 覆盖：三连掐全命中（cancel+disconnect 依序调用+connect 遮蔽为 no-op）/迟到定时器落地即 no-op
// （connect 置空后调用零副作用零抛错）/防御面（provider/configuration/websocketProvider 缺失或
// 方法抛错全吞——void 语义与 drill 内联原形态一致）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { killProviderLateReconnect } from './lib/provider-late-reconnect-guard.js';

function makeFakeWs() {
  const calls = [];
  return {
    calls,
    cancelWebsocketRetry() { calls.push('cancel'); },
    disconnect() { calls.push('disconnect'); },
    connect() { calls.push('connect-original'); },
  };
}

test('三连掐：cancelWebsocketRetry+disconnect 依序调用；connect 被遮蔽为 no-op（迟到定时器落地零副作用）', () => {
  const ws = makeFakeWs();
  const originalConnect = ws.connect;
  killProviderLateReconnect({ configuration: { websocketProvider: ws } });
  assert.deepEqual(ws.calls, ['cancel', 'disconnect']);   // 原 connect 未被调用
  assert.notEqual(ws.connect, originalConnect);           // 实例遮蔽——迟到定时器拿到的已是 no-op
  assert.doesNotThrow(() => ws.connect());                // no-op 落地：不抛、零副作用
  assert.deepEqual(ws.calls, ['cancel', 'disconnect']);
});

test('防御面：provider/configuration/websocketProvider 任一缺失=no-throw no-op；方法缺失经可选链跳过；方法抛错被吞（void）', () => {
  assert.doesNotThrow(() => killProviderLateReconnect(undefined));
  assert.doesNotThrow(() => killProviderLateReconnect(null));
  assert.doesNotThrow(() => killProviderLateReconnect({}));
  assert.doesNotThrow(() => killProviderLateReconnect({ configuration: {} }));
  assert.doesNotThrow(() => killProviderLateReconnect({ configuration: { websocketProvider: {} } }));   // 两方法全缺——可选链跳过、connect 仍置空
  const ws = {
    cancelWebsocketRetry() { throw new Error('boom'); },
    disconnect() { throw new Error('boom'); },
    connect() { throw new Error('boom'); },
  };
  assert.doesNotThrow(() => killProviderLateReconnect({ configuration: { websocketProvider: ws } }));
  assert.doesNotThrow(() => ws.connect());   // 置空后原抛错形态不可再触达
});
