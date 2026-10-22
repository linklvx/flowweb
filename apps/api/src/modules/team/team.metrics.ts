// apps/api/src/modules/team/team.metrics.ts —— T19（plan v11.2 ③ 观测补）：团队级单门授权拒绝计数。
// spec 钉名 media_acl_denied（v11.2 验收原文「授权拒绝（media_acl_denied）」）；接线点=team.util
// assertTeamMember 拒点（两 throw 前统一 inc）——该函数=团队级 ACL 单门（spec Z7''-v14：assertTeamMember
// 推翻「项目成员+跨项目 403」口径），消费面含 media facts/content 读、canvas、material 等全团队单门
// 入口；计数覆盖面=单门全消费面（命名沿用 spec 原文，观测面统一非仅 media 模块）。
import { Counter, register } from 'prom-client';

export const mediaAclDenied = new Counter({
  name: 'media_acl_denied',
  help: 'T19（v11.2 ③）：团队级 ACL 单门拒绝计数（assertTeamMember 拒点——403 ForbiddenException 同事件；spec 钉名 media_acl_denied，覆盖单门全消费面）',
  registers: [register],
});
