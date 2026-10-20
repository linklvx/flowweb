// apps/api/src/modules/media/sniff.ts —— Y1a+Y1b T6④（v11.1⑦）：file-type 独立 sniff 模块
// 全仓 file-type **单一 import 点**（T4 建于 media-registration.service；T6 提取独立模块——
// 升级/替换面收口于此，消费点：storage.service（confirm 嗅探）/media-content.controller（白名单
// disposition 头）/media-registration（probeState 路由配套常量））。
//
// 【升级期限登记（check-exact-pins 锁 16.5.4）】file-type ≥17 起纯 ESM（tsconfig commonjs 不兼容
// ——ERR_REQUIRE_ESM）。升级路径二选一：①apps/api tsconfig 全量转 ESM（连带 Nest 构建链）；②换自研
// magic bytes sniff（本模块是唯一替换点——消费面零改动）。在 CI 需要 file-type 新格式识别前维持 pin。
import { fromBuffer } from 'file-type';

/** MIME 嗅探（file-type pin 16.x）。任何异常（含 EndOfStream 过短缓冲）一律 null=不可判型 → 白名单外拒。 */
export async function sniffMimeType(head: Buffer): Promise<string | null> {
  try {
    return (await fromBuffer(head))?.mime ?? null;
  } catch {
    return null;
  }
}

/** 上传白名单（spec Z7''）：image/|video/|audio/ 家族；SVG 一律拒
 *  （file-type 对 svg 文本报 application/xml——家族外自动拒；显式排除防未来 sniff 升级开口）。 */
export function isAllowedUploadMime(mime: string | null): boolean {
  if (!mime) return false;
  if (mime === 'image/svg+xml' || mime === 'image/svg') return false;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}
