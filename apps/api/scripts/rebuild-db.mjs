#!/usr/bin/env node
// Y0b-1 T1a（四轮 Z34）：REBUILD_DB 分支清库脚本（deploy.sh 上传段随 apps/api/scripts tar 上服务器）——
// owner 只读核查（P2-5）+DROP 前计数留档+DROP/CREATE SCHEMA。
// 不设"空表断言"门：pm2 不停（应用在线）窗口断言无意义；不可逆操作的回退锚=cutover ②已落的 pg_dump。
import { Client } from 'pg';

// argv 守卫：无 DSN 时 pg 回退 PGHOST/PGUSER 等环境默认——本地误跑可能 DROP 掉 dev 库，必须 fail-closed
if (!process.argv[2]) {
  console.error('usage: rebuild-db.mjs <DSN>');
  process.exit(2);
}

const c = new Client({ connectionString: process.argv[2] });
await c.connect();
const owner = await c.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='public'");
console.log('public schema owner:', owner.rows[0].owner);
if (owner.rows[0].owner !== 'flowweb') {
  console.error('owner 非 flowweb——DROP 需 schema owner，人工核查（Z34/P2-5）');
  process.exit(1);
}
const n = await c.query('SELECT COUNT(*)::int AS n FROM "GenerationIntent"').catch(() => ({ rows: [{ n: 0 }] }));
console.log('DROP 前 GenerationIntent 计数（仅留档）:', n.rows[0].n);
await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
console.log('schema rebuilt');
await c.end();
