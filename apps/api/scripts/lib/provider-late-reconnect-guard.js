// apps/api/scripts/lib/provider-late-reconnect-guard.js —— @hocuspocus/provider 4.6.0 迟到重连定时器
// 复活缺陷的 destroy 后三连掐兜底（R5' 库行为登记——CI 双故障根修批 685d47b6/d822e542 首置于
// collab-kill9-drill.ts/write-frozen-drill.mjs 内联，本文件=两处同构代码提取共享）。
// 缺陷形态：connected 期被关（服务端 close/杀进程）→ onClose 排定 1s 重连 setTimeout（onClose 尾
// `!cancelWebsocketRetry && shouldConnect`——connected 期 onOpen 把 cancelWebsocketRetry 清 void，
// 条件必真），destroy() 不清该定时器：迟到的 connect() 复位 shouldConnect 并重启无限退避重连
// （maxAttempts=0）→ 进程永生（CI run 59 5h56m 真凶）。
// 掐法三连：cancel 已复活循环 + disconnect 复位 shouldConnect + connect 置空（迟到定时器落地即
// no-op——实例遮蔽原型方法）。
// 退役判据：库升级（@hocuspocus/provider 修复 onClose/destroy 不清重连定时器缺陷）后复核并退役本兜底。
// 消费约定：一切 destroy provider 的演练/harness 装置（kill9/write-frozen 双 drill+后续 Y1a 收敛
// harness 等）一律经本函数，禁各写内联副本（CI 双故障根修批教训——兜底散置必有新装置漏带）。
// 载体形态：CJS（apps/api 包无 type:module）+ .d.ts（kill9-drill.ts 经 tsx require、无扩展名 import
// 走 .d.ts 类型面；write-frozen-drill.mjs 经 ESM 导 CJS named import——cjs-module-lexer 可达）。
exports.killProviderLateReconnect = function killProviderLateReconnect(provider) {
  const w = provider && provider.configuration && provider.configuration.websocketProvider;
  if (!w) return;
  try { w.cancelWebsocketRetry?.(); } catch { /* void */ }
  try { w.disconnect?.(); } catch { /* void */ }
  w.connect = function () {};   // 置空：迟到的 1s 重连定时器落地即 no-op
};
