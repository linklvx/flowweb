// apps/api/src/modules/collab/collab-pathology.ts
// T18（plan v11.2 S5 片·spec Z4''-v14/:77）：order 域病理计数+告警——装载档挂点。
//
// 挂点选型（spec :77「读序容忍+计数告警」——三选一裁定）：
//   ✓ doc 装载时（loadDocument replay 后）：doc 内容进进程的唯一咽喉（装载=state+updates+spool
//     全量重放完成点），零热路径成本（每 doc 驻留期一次，非每编辑帧）；离线合并病理（preVacuumSv
//     fence 挡不住的未同步客户端回灌——spec §1.10 实证）恰在下次装载可见=观测面全覆盖。
//   ✗ 周期扫描：需新调度面+与驻留/装载态耦合（同覆盖下纯劣）。
//   ✗ gateway 断言面（每写帧）：热路径成本+重复计数（同一病理每次编辑都触发——观测口径被
//     编辑频率污染）。
// 判定单源=shared scanOrderPathology（CLI --dry-run 同函数——禁两份判定）；指标=本文件
// .metrics.ts 单源（check-spec-consistency §10 登记）。
import { scanOrderPathology, isCleanOrderPathology } from '@flowweb/shared';
import { Logger } from '@nestjs/common';
import { collabOrderPathologyTotal } from './collab-pathology.metrics';

/** 装载档病理观测（loadDocument replay+版本门后调用——records=doc 全量作者态记录）。
 *  副作用：clean ⇒ 零计数零日志；命中 ⇒ 逐档 inc + 结构化日志（hard=ERROR 损坏上限档，
 *  其余 WARN 告警档——Z4''-v14 词表）。永不 throw（病理=观测非执法——读序容忍不 500）。 */
export function observeOrderPathologyOnLoad(
  logger: Pick<Logger, 'warn' | 'error'>,
  documentName: string,
  records: ReadonlyArray<{ id: string; parentId?: string | null; data?: Record<string, unknown> }>,
): void {
  const report = scanOrderPathology(records);
  if (isCleanOrderPathology(report)) return;
  const detail = JSON.stringify({
    event: 'collab_order_pathology',
    documentName,
    kinds: report.kinds,
    duplicateKeyNodes: report.duplicateKeyNodes,
    softKeyNodes: report.softKeyNodes,
    hardKeyNodes: report.hardKeyNodes,
    missingKeyNodes: report.missingKeyNodes,
    layers: report.layers.length,
    scannedNodes: report.scannedNodes,
    note: '读序 (order,id) tie-break 容忍（不 500 不丢节点）——修复归 CLI scripts/collab-renumber-layer.mjs（离线/维护窗）',
  });
  for (const kind of report.kinds) collabOrderPathologyTotal.inc({ kind });
  if (report.hardKeyNodes > 0) {
    logger.error(`${detail}——hard 档（非法键/超 128 硬限）=损坏上限：读侧排序兜底殿后`);
  } else {
    logger.warn(detail);
  }
}
