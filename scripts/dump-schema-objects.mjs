#!/usr/bin/env node
// Y0b-1 T1a（Z2+三轮⑤）：squash census 工具。两模式：
//   node scripts/dump-schema-objects.mjs <URL>                          —— dump 指定库全量对象清单（stdout JSON）
//   node scripts/dump-schema-objects.mjs <URL> --replay-new <init.sql>  —— 建临时库 flowweb_census_new 重放 init 后 dump（stdout JSON，完毕即删临时库）
// 全量清单查询单源=scripts/lib/schema-dump.mjs（Y0b-5 T12-0d 抽出——check-fresh-replay.mjs 共用）。
// 这是 squash 的唯一可信验收：Prisma migrate diff 不建模序列/partial WHERE/约束形态——"零差异"是假绿。
import fs from 'node:fs';
import { dump, Client } from './lib/schema-dump.mjs';

const [url, mode, initPath] = [process.argv[2], process.argv[3], process.argv[4]];
if (!url || (mode === '--replay-new' && !initPath)) {
  console.error('usage: dump-schema-objects.mjs <URL> [--replay-new <init.sql>]');
  process.exit(2);
}
// mode 严格校验：拼写错误静默走 dump 分支会拿到"假 old 侧"——比对场景必须 fail-closed
if (mode !== undefined && mode !== '--replay-new') {
  console.error(`unknown mode: ${mode}（仅支持 --replay-new）`); process.exit(2);
}
if (mode !== '--replay-new') {
  const c = new Client({ connectionString: url });
  await c.connect();
  console.log(JSON.stringify(await dump(c), null, 1));
  await c.end();
} else {
  // admin 连接（postgres 库）建/删临时库——CREATE DATABASE 不能在事务内，独立连接执行
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const ac = new Client({ connectionString: admin.toString() });
  await ac.connect();
  await ac.query('DROP DATABASE IF EXISTS flowweb_census_new');
  await ac.query('CREATE DATABASE flowweb_census_new');
  const nc = new Client({ connectionString: new URL(url).toString().replace(/\/[^/]*$/, '/flowweb_census_new') });
  await nc.connect();
  await nc.query(fs.readFileSync(initPath, 'utf8')); // client.query 支持多语句脚本
  console.log(JSON.stringify(await dump(nc), null, 1));
  await nc.end();
  await ac.query('DROP DATABASE flowweb_census_new');
  await ac.end();
}
