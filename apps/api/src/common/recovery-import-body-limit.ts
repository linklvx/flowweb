// apps/api/src/common/recovery-import-body-limit.ts
// Y1c T25 收口批 C-2（quality）：recovery-import 路由级 JSON 解析上限——Nest 默认 body-parser
// json limit=100kb 使 8MiB 契约档（DraftEnvelope ≤8MiB）在 100KB-8MiB 区间被解析层 413
// （controller 8MiB 门成死码）。本助手=**main.ts 与 Nest 测试应用同源 wiring**（int 真实 HTTP
// 面与生产解析层一致——禁测试/生产两套形态）：
//  - 路由限定 json(limit=DRAFT_ENVELOPE_MAX_BYTES+壳容差) 先于 Nest 默认 100kb 注册——
//    body-parser 幂等（req._body 已置则默认 parser 跳过）：recovery 路由按 8MiB 档解析，
//    其余路由维持 100kb 默认（攻击面不放大）；
//  - 必须 createNestApplication 后、init/listen 前调用（中间件栈序=注册序）。
import { json } from 'express';
import type { INestApplication } from '@nestjs/common';
import { DRAFT_ENVELOPE_MAX_BYTES } from '@flowweb/shared';

/** 包壳容差（JSON 键名/conflictChoices 面超出 envelope 本体的字节余量——与 controller
 *  content-length 门同值单源派生）。 */
export const RECOVERY_IMPORT_ROUTE_BODY_LIMIT_BYTES = DRAFT_ENVELOPE_MAX_BYTES + 4_096;

export function applyRecoveryImportBodyLimit(app: INestApplication): void {
  app.use('/api/collab/doc/:projectId/recovery-import', json({ limit: RECOVERY_IMPORT_ROUTE_BODY_LIMIT_BYTES }));
}
