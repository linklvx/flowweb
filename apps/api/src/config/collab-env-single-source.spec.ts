// apps/api/src/config/collab-env-single-source.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { envSchema } from './env';

/** Y0a-4（外审 D2/A9 折中）：env 契约=派生而非手抄——apps/api 内（含 src 与 scripts——scripts 的
 * collab-spool-import/quarantine 读 COLLAB_ 前缀键同受锚覆盖，是特性非噪音）每个
 * process.env.COLLAB_ 前缀键与 COMPACT_INTERVAL_MS 读点必须在 envSchema 有键（方向一）；
 * 每个 schema 键必须被读或在豁免表（方向二）。新增 env 读点漏收口=本 spec 红（CI 拦截）。
 * Y0b-2 T2：前缀扩 EXEC_|PROVIDER_|DASHSCOPE_API_KEY（执行运行时/provider 密钥族——方向②只认
 * 字面量读点：动态 process.env[key] 收不到读点会假红，seedEnvValue switch 即为此逐键字面量读）。 */
const EXEMPT = new Map<string, string>([
  ['COLLAB_FAKE_AI', 'Y0b 资金批域（provider-adapters.ts fakeAiEnabled 单源 helper——启动断言豁免档唯一读点）——E58/Y0b 同批收口'],
  ['COLLAB_MAX_LOADED_DOCS', 'spec-reserved：spec §3 4.6:502 原文点名"MAX_LOADED_DOCS 预留"（区别于被驳回的 plan 自创预留）——enforcement 归 Y1c-3（届时连消费点同批移出豁免）'],
  // Y0b-3 T1：§0.3 十键一次注册（消费点随后续 Task 落地——键先注册满足 spec §7.1 fenced 块同 commit 同步纪律；各 Task 落地时键随读者移出本表）
  ['COLLAB_ALLOWED_ORIGINS', 'Y0b-3 T2 消费（Origin 白名单——BETTER_AUTH_URL origin 推导+仅 dev 含 localhost:5173）'],
  ['COLLAB_TRUSTED_PROXY', 'Y0b-3 T2 消费（未设=不信任 X-Real-IP）'],
  ['COLLAB_UPGRADE_RATE_PER_MIN', 'Y0b-3 T2 消费（默认 60）'],
  ['COLLAB_AUTH_ATTEMPTS_PER_MIN', 'Y0b-3 T3 消费（默认 10）'],
  ['COLLAB_AUTH_INFLIGHT_MAX', 'Y0b-3 T3 消费（默认 4）'],
  ['COLLAB_REFUSAL_CACHE_TTL_MS', 'Y0b-3 T3 消费（默认 15000）'],
  ['COLLAB_RSS_TRIP_BYTES', 'Y0b-3 T4 消费（默认 750MiB）'],
  ['COLLAB_RSS_RELEASE_BYTES', 'Y0b-3 T4 消费（默认 600MiB）'],
  ['COLLAB_HEAP_PRESSURE_RATIO', 'Y0b-3 T4 消费（默认 0.8）'],
  ['COLLAB_CONN_MAX_LIFETIME_MS', 'Y0b-3 T6 消费（默认 12h）'],
]);

/** 纯函数抽取（方向一/自测共用同一判定逻辑，防恒真重言式） */
function missingReads(reads: Set<string>, schemaKeys: Set<string>, exempt: Map<string, string>): string[] {
  return [...reads].filter((k) => !schemaKeys.has(k) && !exempt.has(k));
}
function deadKeys(reads: Set<string>, schemaKeys: Set<string>, exempt: Map<string, string>): string[] {
  return [...schemaKeys].filter((k) => !reads.has(k) && !exempt.has(k));
}

function collectSrcFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : collectSrcFiles(p);
    return f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('Y0a-4 env 单源结构锚（双向）', () => {
  const src = join(__dirname, '../../');
  const reads = new Set<string>();
  for (const file of collectSrcFiles(src)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/process\.env\.(COLLAB_[A-Z_]+|COMPACT_INTERVAL_MS|EXEC_[A-Z_]+|PROVIDER_[A-Z_]+|DASHSCOPE_API_KEY)/g)) reads.add(m[1]);
  }
  const schemaKeys = new Set(Object.keys(envSchema.shape).filter(
    (k) => k.startsWith('COLLAB_') || k === 'COMPACT_INTERVAL_MS' || k.startsWith('EXEC_') || k.startsWith('PROVIDER_') || k === 'DASHSCOPE_API_KEY',
  ));

  it('方向一：apps/api 内每个 COLLAB_/COMPACT/EXEC_/PROVIDER_/DASHSCOPE 读点都在 envSchema 或豁免表', () => {
    const missing = missingReads(reads, schemaKeys, EXEMPT);
    expect(missing, `以下读点未进 env zod 也未豁免（新 env 必须同批进 config/env.ts 或登记 EXEMPT）: ${missing.join(',')}`).toEqual([]);
  });

  it('方向二：每个 schema 键被读或在豁免表（死键即红）', () => {
    const dead = deadKeys(reads, schemaKeys, EXEMPT);
    expect(dead, `以下键零读点且未豁免（死契约）: ${dead.join(',')}`).toEqual([]);
  });

  it('Y0b-4 四键进 schema：MAX_DOC_BYTES/MAX_TX_BYTES/MSG_RATE_PER_CONN/BYTES_RATE_PER_CONN', () => {
    // T2 落地：读点=gateway 构造期 this.quota 读入（非 EXEMPT——键随读者同 commit 双向绿）。
    for (const k of ['COLLAB_MAX_DOC_BYTES', 'COLLAB_MAX_TX_BYTES', 'COLLAB_MSG_RATE_PER_CONN', 'COLLAB_BYTES_RATE_PER_CONN'])
      expect(envSchema.shape).toHaveProperty(k);
  });

  it('判定函数自测（合成夹具证伪，替代恒真重言式）', () => {
    const synReads = new Set(['COLLAB_A', 'COLLAB_B']);
    const synSchema = new Set(['COLLAB_B']);
    const synExempt = new Map([['COLLAB_A', 'x']]);
    expect(missingReads(synReads, synSchema, synExempt)).toEqual([]);
    expect(missingReads(synReads, synSchema, new Map())).toEqual(['COLLAB_A']);   // 移除豁免→红=豁免表在承担真实工作
    expect(deadKeys(new Set(['COLLAB_B']), new Set(['COLLAB_B', 'COLLAB_C']), new Map())).toEqual(['COLLAB_C']);   // 死键被抓
  });
});
