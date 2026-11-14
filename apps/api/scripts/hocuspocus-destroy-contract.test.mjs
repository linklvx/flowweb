// apps/api/scripts/hocuspocus-destroy-contract.test.mjs —— @hocuspocus/provider destroy 契约
// 回归测试（R5' 三连掐兜底退役后的替代守卫——2026-11-14 provider 4.6.0→4.8.0 升级批）。
// 契约：connected 期被服务端关闭（onClose 排定 1s 重连 setTimeout）后 destroy()，迟到的重连
// 定时器必须被清除——不得复活连接（4.6.0 缺陷形态=CI run 59 5h56m 进程永生真凶；4.8.0 修复=
// disconnect() 首部 clearReconnectTimeout + setTimeout 句柄保存 this.reconnectTimeout）。
// 库 regression（未来版本复活该缺陷）⇒ 本测试红（server 连接计数 2≠1）。
// 装置：轻量 ws server（node:http+ws noServer upgrade 计数连接）——无需真 hocuspocus server
// 协议（connected 在 ws open 后即达，不依赖 synced）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
const { HocuspocusProvider } = await import('@hocuspocus/provider');

function startCountingWsServer() {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let connections = 0;
  wss.on('connection', (socket) => {
    connections += 1;
    socket.on('message', () => { /* provider 同步帧——不回，不阻 connected */ });
  });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, wss, get connections() { return connections; } });
    });
  });
}

test('destroy 契约：connected 期被服务端 close 后 destroy，迟到重连定时器不复活（连接计数恒 1）', async () => {
  const h = await startCountingWsServer();
  const port = h.server.address().port;
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${port}`,
    name: 'destroy-contract-test',
    document: new Y.Doc(),
  });
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connected 超时 5s')), 5_000);
      provider.on('status', ({ status }) => { if (status === 'connected') { clearTimeout(t); resolve(); } });
    });
    assert.equal(h.connections, 1, '前置：首连接已建立');
    // 服务端主动关（模拟生产服务端 close/杀进程——触发 provider onClose 排定 1s 重连 setTimeout）
    h.wss.clients.forEach((s) => { try { s.close(); } catch { /* 已闭 */ } });
    await new Promise((r) => setTimeout(r, 50));   // 让 onClose 先排定重连定时器
    try { provider.destroy(); } catch { /* 同步抛容错（drill 同款） */ }
    await new Promise((r) => setTimeout(r, 1_800));   // 越过 1s 重连定时器窗+余量
    assert.equal(h.connections, 1,
      'destroy 后迟到重连定时器复活了连接（4.6.0 缺陷形态——库 regression：复核 disconnect/clearReconnectTimeout 链）');
  } finally {
    try { provider.destroy(); } catch { /* 已销毁 */ }
    h.wss.close();
    await new Promise((r) => h.server.close(r));
  }
});
