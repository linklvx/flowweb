// apps/api/src/modules/collab/collab-ws-close-probe.spec.ts
// Y0b-3 T6（P-V⑧）：maxPayload pin 行为断言（spec 冻结契约 10——"pin 生效证据=行为断言 >16MiB 帧→1009"）。
// 真连装置（dual-client-server——真 listen+Origin+cookie+csv 全通道）+ws 裸客户端发 17MiB 帧，
// 断言**客户端实际观测**的 close code。ws@8 源码路径：receiver maxPayload 违规（receiver.js:418-425
// RangeError{kStatusCode:1009,'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'}）→ websocket.js receiverOnError(:1182)
// → websocket.close(1009)——服务端先发 1009 close 帧再断 TCP（非裸 destroy）。
// 若本用例观测 1006 = ws 层升级改 destroy 形态 ⇒ T0 映射表 1009 分支登记死码+T9 逃生通道改挂 1006
// 观测面（结论以本用例运行结果为准——一次定论；映射表改动归 T9 消费，本用例只钉行为）。
import { describe, it, expect } from 'vitest';
import { startDualClientServer, makeHeaderWs, type DualClientKit } from '../../test-utils/dual-client-server';
import { CLIENT_PROTOCOL_VERSION, CollabCloseCode } from '@flowweb/shared';

describe('Y0b-3 T6 1009 真连观测探针（P-V⑧）', () => {
  it('客户端发 >16MiB 帧 → 客户端观测 close code=1009（ws 层 close 帧形态——非 1006 裸 destroy）', async () => {
    const kit: DualClientKit = await startDualClientServer();
    let client: InstanceType<ReturnType<typeof makeHeaderWs>> | null = null;
    try {
      client = new (makeHeaderWs({ origin: 'http://localhost:5173', cookie: 'flowweb.session_token=tok' }))(
        `${kit.url}?csv=${CLIENT_PROTOCOL_VERSION}`,
      );
      await new Promise<void>((resolve, reject) => {
        client!.once('open', () => resolve());
        client!.once('error', reject);
      });
      client.on('error', () => { /* 关闭握手期 error 无人消费会抛——吞（close code 才是断言面） */ });
      const closed = new Promise<number>((resolve) => { client!.once('close', (code: number) => resolve(code)); });
      client.send(Buffer.alloc(17 * 1024 * 1024));   // > maxPayload 16MiB（服务端 websocketOptions pin）
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const code = await Promise.race([
        closed,
        new Promise<never>((_, rej) => { timeout = setTimeout(() => rej(new Error('probe timeout: no close frame within 10s')), 10_000); }),
      ]).finally(() => clearTimeout(timeout));
      expect(code).toBe(CollabCloseCode.LIB_MESSAGE_TOO_BIG);   // 1009——观测 1006 ⇒ 登记死码结论（T9 消费）
    } finally {
      client?.terminate();
      await kit.dispose();
    }
  }, 30_000);
});
