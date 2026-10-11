// apps/api/src/modules/collab/collab-frame-type.ts
// Y0b-4 T6：入站/出站帧判型单源（H-5 库方法——禁自写 varint/字节猜型；census ③）。
// T6 消费=beforeHandleMessage awareness 帧闸；T7 消费=出站背压 wrap（共用单源）。
// 帧形（T0 探针①）：varString(docName)〔首字节=docName 长度〕+ varUint(MessageType)。
// 异常一律 null=放行（边界安全——解析面失败不拒绝合法帧）。
import { IncomingMessage, MessageType } from '@hocuspocus/server';

export { MessageType };

/** 帧类型解析：返回 MessageType 值（number）| null（异常=放行语义，调用方判 null 跳过判型分支）。 */
export function readFrameType(data: Uint8Array): number | null {
  try {
    const m = new IncomingMessage(data);
    m.readVarString();           // docName（跳过——帧首段恒为文档名）
    return m.readVarUint();      // MessageType
  } catch {
    return null;   // 异常一律 null=放行（边界安全）
  }
}
