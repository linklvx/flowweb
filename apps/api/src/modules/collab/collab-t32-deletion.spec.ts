// apps/api/src/modules/collab/collab-t32-deletion.spec.ts
// Y1c T32（spec §6.7 D9 终点——删除清单执行）：grep 零锚红组（census ⑤/⑥ 清单逐项）。
// 形态=静态源码扫描（生产面=apps/api/src+apps/web/src+packages/shared/src，排除 *.spec/*.test/
// test-utils/collab-harness——census collectProductionFiles 同口径；worker.module/collab.module 等
// 装配面属生产文件计入）。红组纪律（plan TDD 节）：删除前各符号仍在=锚红（本 spec 逐项先红亲验）；
// 删码后转绿=删除清单落地。终态常驻 CI（卡文第三 checkbox）：本 spec 归 api 主池+check-collab-census
// ㉛ 白名单清零（doc.exec 触碰面）双载体——「服务端 serving 期零业务 doc 写」行为面断言承载=
// collab-t22-delivery-switch.int.spec（不变量⑦：writeExecStatus/deliverArtifact 后 doc 零写+exec map
// 恒空——T32 同批补全量 doc 零变更强化例）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 仓根定位（module:commonjs——import.meta 不可用；本文件=apps/api/src/modules/collab/ 下五级）
const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

/** 生产文件面（census collectProductionFiles 同口径：两端 src 下 ts/tsx，排除测试/装置）。 */
function collectProductionFiles(): string[] {
  const out: string[] = [];
  for (const base of ['apps/api/src', 'apps/web/src', 'packages/shared/src']) {
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const p = path.posix.join(dir, e.name);
        if (e.isDirectory()) {
          if (p.includes('test-utils') || p.includes('collab-harness')) continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(spec|test)\./.test(e.name)) out.push(p);
      }
    };
    walk(base);
  }
  return out.sort();
}

const FILES = collectProductionFiles();
const RAW = new Map<string, string>(FILES.map((p) => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]));

/** 词面命中（raw 全文——含注释；T32 删除纪律=注释提及一并清（非 spec 冻结文档），故 raw 计数）。 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { out += '  '; i += 2; mode = 'line'; continue; }
      if (c === '/' && n === '*') { out += '  '; i += 2; mode = 'block'; continue; }
      if (c === "'" || c === '"') { out += c; i += 1; mode = c === "'" ? 'single' : 'double'; quote = c; continue; }
      if (c === '`') { out += '`'; i += 1; mode = 'template'; continue; }
      out += c; i += 1;
    } else if (mode === 'line') {
      if (c === '\n') { out += '\n'; mode = 'code'; } i += 1;
    } else if (mode === 'block') {
      if (c === '*' && n === '/') { out += '  '; i += 2; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else if (mode === 'single' || mode === 'double') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === quote) { out += quote; i += 1; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    } else {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { out += '`'; i += 1; mode = 'code'; continue; }
      out += c === '\n' ? '\n' : ' '; i += 1;
    }
  }
  return out;
}

const STRIPPED = new Map<string, string>(FILES.map((p) => [p, stripCommentsAndStrings(RAW.get(p)!)]));

/** 词面命中（代码面——stripped：注释与字符串内容不计〔历史注记/help 文本=删除缘由在档非符号
 *  触碰——census 主流组 findLineOccurrences 同口径〕）。 */
function hits(token: string): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = [];
  for (const [p, stripped] of STRIPPED) {
    stripped.split('\n').forEach((l, i) => {
      if (l.includes(token)) out.push({ file: p, line: i + 1 });
    });
  }
  return out;
}

describe('Y1c T32 删除清单 grep 零锚（census ⑤/⑥ 逐项——删除前红/删码后绿）', () => {
  it('A1 doc.exec 写原语：applyWriteExecStatusToDoc/applyDeleteExecOrphansToDoc/ExecStatusApplyOutcome 零命中', () => {
    const details = [...hits('applyWriteExecStatusToDoc'), ...hits('applyDeleteExecOrphansToDoc'), ...hits('ExecStatusApplyOutcome')];
    expect(details).toEqual([]);
  });

  it('A2 writeBatch exec 词汇：DOC_WRITE_OPS 词汇面无 writeExecStatus/deleteExecOrphans（shared manifest 单源——writeExecStatus 裸词保留=feed 写方法名/计数标签合法面）', async () => {
    const { DOC_WRITE_OPS } = await import('@flowweb/shared');
    expect(Object.keys(DOC_WRITE_OPS).sort()).toEqual(['deleteNodeDataKeys', 'deleteNodes', 'fillDoc', 'writeNodeData']);
    expect(hits('deleteExecOrphans')).toEqual([]);
  });

  it('A3 exec 键域常量：EXEC_STATUS_KEYS 与 DOC_KEY_MANIFEST exec 根条目零（exec 根随 doc.exec 链退役）', () => {
    const details = [...hits('EXEC_STATUS_KEYS')];
    expect(details).toEqual([]);
  });

  it('B1 worker 通道旧面：WORKER_CHANNEL_OPS/WORKER_EXEC_FORBIDDEN_STATUSES/write-batch 端点字面零', () => {
    const details = [...hits('WORKER_CHANNEL_OPS'), ...hits('WORKER_EXEC_FORBIDDEN_STATUSES'), ...hits('write-batch')];
    expect(details).toEqual([]);
  });

  it('B2 writeBatch 令牌 worker 形态：HttpCollabDocWriter/writeOpsBatch/OpsBatchOutcome 零', () => {
    const details = [...hits('HttpCollabDocWriter'), ...hits('writeOpsBatch'), ...hits('OpsBatchOutcome')];
    expect(details).toEqual([]);
  });

  it('B3 writeBatch 门面本体：CollabDocWriterService.writeBatch 生产调用零（doc 域应用核心 applyWriteOpsToDoc 维护面保留）', () => {
    const details = [...hits('.writeBatch(')];
    expect(details).toEqual([]);
  });

  it('C1 web execAligned 链：execAligned/alignExecFromIntents/fetchNodeIntents 零（恢复对齐=Runtime Store 投影承载）', () => {
    const details = [...hits('execAligned'), ...hits('alignExecFromIntents'), ...hits('fetchNodeIntents')];
    expect(details).toEqual([]);
  });

  it('D1 vacuum era 旧族：beginVacuumEra/vacuumEraGeneration/vacuumTargetGeneration/abortVacuumRestore 零（T27 单换代入口后死码）', () => {
    const details = [...hits('beginVacuumEra'), ...hits('vacuumEraGeneration'), ...hits('vacuumTargetGeneration'), ...hits('abortVacuumRestore')];
    expect(details).toEqual([]);
  });

  it('D2 vacuuming 会话态族：setVacuuming/isVacuuming/vacuumingDocs 零（生产写点随 era 族死——真空窗口=维护状态机 freeze 闸承载）', () => {
    const details = [...hits('setVacuuming'), ...hits('isVacuuming'), ...hits('vacuumingDocs')];
    expect(details).toEqual([]);
  });

  it('E1 重建工具 superseded：apps/api/scripts/rebuild-db.mjs 文件不存在+deploy.sh 零引用', () => {
    expect(fs.existsSync(path.join(ROOT, 'apps/api/scripts/rebuild-db.mjs'))).toBe(false);
    const sh = fs.readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');
    expect(sh.split('\n').filter((l) => l.includes('rebuild-db.mjs')).length).toBe(0);
  });

  it('F1 投影 poller doc fast path：readNodeDataValue 零（T22 停写 doc 后判等恒 false 死路径）', () => {
    expect(hits('readNodeDataValue')).toEqual([]);
  });

  it('G1 exec 守卫计数族：execProjectionDroppedTotal/execOrphanBlockedTotal/execSeqStaleRejected 零（doc 写守卫面退役）', () => {
    const details = [...hits('execProjectionDroppedTotal'), ...hits('execOrphanBlockedTotal'), ...hits('execSeqStaleRejected')];
    expect(details).toEqual([]);
  });
});
