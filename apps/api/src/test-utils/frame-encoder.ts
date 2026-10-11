// apps/api/src/test-utils/frame-encoder.ts
// Y0b-4 T7（T6 外审 M1）：裸 ws 帧 wire 编码单源——apps/api 无 lib0 直依赖、AwarenessMessage 类
// 非 provider 运行时出口，此前 rate-gate/quota-gate（varuint+frame+awarenessUpdate）与
// awareness-guard（pushVarUint 族+awarenessFrame）三份手编 varint 拷贝收口于此。
// 语义=wire 形状最小事实（varString(docName)+varUint(MessageType)+体），与生产判型
// （collab-frame-type.ts 库 IncomingMessage 解析）刻意分离——测试装置禁 import 生产文件。
type Entry = { clientId: number; clock: number; state: unknown };

export function pushVarUint(out: number[], num: number): void {
  for (;;) {
    if (num < 0x80) { out.push(num); return; }
    out.push((num & 0x7f) | 0x80);
    num = Math.floor(num / 0x80);
  }
}

export function pushVarString(out: number[], s: string): void {
  const bytes = Array.from(new TextEncoder().encode(s));
  pushVarUint(out, bytes.length);
  out.push(...bytes);
}

export function pushVarUint8Array(out: number[], arr: Uint8Array): void {
  pushVarUint(out, arr.length);
  out.push(...Array.from(arr));
}

/** Sync/Auth/QueryAwareness 裸帧：varString(docName)+varUint(msgType)(+varUint(syncType)+varUint(len)+body)。 */
export function makeFrame(docName: string, msgType: number, syncType: number | null, payload: Uint8Array | string | null): Buffer {
  const frame: number[] = [];
  pushVarString(frame, docName);
  pushVarUint(frame, msgType);
  if (syncType !== null) pushVarUint(frame, syncType);
  const body = payload === null ? [] : typeof payload === 'string' ? Array.from(Buffer.from(payload, 'utf8')) : Array.from(payload);
  if (payload !== null) pushVarUint(frame, body.length);
  return Buffer.from([...frame, ...body]);
}

/** awareness update 体（y-protocols encodeAwarenessUpdate 形）：count+{client,clock,state(UTF8 JSON)}。 */
export function makeAwarenessUpdateBody(entries: Entry[]): Uint8Array {
  const upd: number[] = [];
  pushVarUint(upd, entries.length);
  for (const e of entries) {
    pushVarUint(upd, e.clientId);
    pushVarUint(upd, e.clock);
    pushVarString(upd, JSON.stringify(e.state));
  }
  return Uint8Array.from(upd);
}

/** 完整 awareness 裸帧：varString(docName)+varUint(MessageType.Awareness=1)+update 体。 */
export function makeAwarenessFrame(documentName: string, entries: Entry[]): Uint8Array {
  const frame: number[] = [];
  pushVarString(frame, documentName);
  pushVarUint(frame, 1);   // MessageType.Awareness
  pushVarUint8Array(frame, makeAwarenessUpdateBody(entries));
  return Uint8Array.from(frame);
}
