// scripts/deploy-sh-pgrestore.test.mjs —— deploy.sh REBUILD_DB 契约测试。
// 历史（T18 spec 评审 P1#1）：REBUILD_DB 段持有 dump fail-fast+pg_restore 命令打印+bash -n 三件
// （commit edc09fb8 虚报面钉进 verify 链防再犯）。
// Y1c T30 收口（2026-11-03，评审 spec C1/I1）：REBUILD_DB 内嵌形态整体退役——reset-collab 前提=
// 消费者全停 vs deploy.sh cutover 链前提=api 在线（①drain/③.5 spool 迁移均要求 api 在线）结构性
// 互斥；且 ssh 非交互 shell 不带 ecosystem env（COLLAB_SPOOL_DIR 唯一注入载体）——内嵌形态的
// quarantine/verify 必假绿。T18 前两件（dump fail-fast/restore 命令打印）随内嵌 DROP 步退役
// （保护对象不存在）；破坏性 reset 唯一入口=runbook §16 人工序，本契约改钉「指引退出不触 DB」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SH = readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');

test('T30 收口①：--rebuild-db=指引退出——打印 §16 人工序+reset-collab 命令后 exit 1，不执行任何部署/DB 操作', () => {
  // 指引三要素：退役声明+§16 指向+可直接复制的 reset-collab 命令（文本非执行）
  assert.match(SH, /REBUILD_DB 已退役/, '退役声明在档');
  assert.match(SH, /runbook §16 人工序/, '指向 §16 人工序（唯一权威入口）');
  assert.match(SH, /node scripts\/reset-collab\.mjs --rebuild-db --confirm/, '指引含 reset-collab 命令（文本面）');
  assert.match(SH, /按 §16 步 4-7 起序/, '起序指引（备份→reset→部署→起序）');
  // 指引后 exit 1（旗标=硬退出非警告——不落入后续 preflight/build/upload/cutover）
  const guidance = SH.match(/REBUILD_DB 已退役[\s\S]{0,600}?exit 1/);
  assert.ok(guidance, '指引块内含 exit 1');
  // 「不触 DB/部署」负向锚：deploy.sh 不得再经 ssh 执行 reset-collab/rebuild-db，REBUILD_DB 专属 dump fail-fast 退役
  assert.ok(!/ssh[^\n]*reset-collab/.test(SH), '不得经 ssh 执行 reset-collab（内嵌退役）');
  assert.ok(!/ssh[^\n]*rebuild-db\.mjs/.test(SH), '不得经 ssh 执行 rebuild-db.mjs（T30 起收编且禁直调）');
  assert.ok(!SH.includes('REBUILD_DB FAIL-FAST'), 'REBUILD_DB dump fail-fast 随内嵌 DROP 步退役（②常规备份 pg_dump 不属本断言对象——保留）');
  // 指引位置=flag 解析后即退（先于 cutover_api 定义/preflight——结构性互斥面在此闭死）
  assert.ok(SH.indexOf('REBUILD_DB 已退役') < SH.indexOf('cutover_api()'), '指引退出先于 cutover 链定义（不进部署链）');
  // 旗标仍被识别（老调用形态得指引非「未知旗标」）
  assert.match(SH, /--rebuild-db\) REBUILD_DB=1 ;;/, 'flag 解析保留（老调用得指引退出）');
});

test('③ deploy.sh 语法可解析（bash -n）', () => {
  execFileSync('bash', ['-n', path.join(ROOT, 'deploy.sh')]);   // 解析失败即抛=测试红
});
