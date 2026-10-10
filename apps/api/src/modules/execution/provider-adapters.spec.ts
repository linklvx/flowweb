// apps/api/src/modules/execution/provider-adapters.spec.ts —— Y0b-2 T2 断言三件之一（DB-free 静态 unit）
// ①迁移 INSERT 的 slug 锅合断言（对 init migration.sql 的 AIModel INSERT 值做断言源——squash 后
//   新库从该文件出生，slug/active/apiModelName 断言=对"每个库的出生形态"断言）；
// ②executable/ready 谓词真值表；③fakeAiEnabled/seedEnvValue 单源行为。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, executableModel, readyModel } from '@flowweb/shared';
import { adapterFor, executable, ready, fakeAiEnabled, seedEnvValue } from './provider-adapters';

/** 从 init migration.sql 抠 AIModel INSERT 块（列序：id/nodeTypeId/name/provider/apiModelName/
 * providerLabel/apiUrl/apiKey/sortOrder/recommended/active——正则分组 g1=id g2=provider
 * g3=apiModelName g4=providerLabel g5=recommended g6=active） */
function migrationModelRows() {
  const sql = readFileSync(join(__dirname, '../../../prisma/migrations/20261009140100_y0b2_init/migration.sql'), 'utf8');
  const m = sql.match(/INSERT INTO "AIModel"[\s\S]*?VALUES\n([\s\S]*?)ON CONFLICT/);
  if (!m) throw new Error('init migration.sql 缺 AIModel INSERT 块（squash 基线漂移？）');
  return m[1].trim().split('\n').map((line) => {
    const cols = line.match(/\('([^']+)', '[^']+', '[^']+', '([^']*)', (NULL|'[^']*'), (NULL|'[^']*')[\s\S]*?(true|false), (true|false), now\(\), now\(\)\)/);
    if (!cols) throw new Error(`AIModel INSERT 行不可解析: ${line.slice(0, 80)}`);
    return {
      id: cols[1],
      provider: cols[2] === 'NULL' ? null : cols[2],
      apiModelName: cols[3] === 'NULL' ? null : cols[3].slice(1, -1),
      active: cols[6] === 'true',
    };
  });
}

describe('Y0b-2 T2：provider-adapters 静态断言（Z80/Z101）', () => {
  it('adapter 表三 slug——moonshot/tencent/dashscope（type+seedEnv 齐）', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(['dashscope', 'moonshot', 'tencent']);
    expect(ADAPTERS.moonshot).toEqual({ type: 'openai-chat', seedEnv: 'PROVIDER_MOONSHOT_API_KEY' });
    expect(ADAPTERS.tencent).toEqual({ type: 'tencent-submit-poll', seedEnv: 'PROVIDER_TENCENT_API_KEY' });
    expect(ADAPTERS.dashscope).toEqual({ type: 'dashscope-submit-poll', seedEnv: 'DASHSCOPE_API_KEY' });
  });

  it('迁移 slug 锅合：每个 INSERT 的 provider 要么有 adapter 要么行 inactive（sdxl/dalle/gpt4 双钉）', () => {
    for (const row of migrationModelRows()) {
      if (row.provider && adapterFor(row.provider)) continue;
      expect(row.active, `${row.id} provider=${row.provider} 无 adapter 但 active=true（不可售行禁活）`).toBe(false);
    }
  });

  it('迁移 active 行断言清单：kimi/hy-image/hy-video 三行 active 且 provider/apiModelName 齐（外呼真名在位）', () => {
    const rows = migrationModelRows();
    const activeRows = rows.filter((r) => r.active);
    expect(activeRows.map((r) => r.id).sort()).toEqual(['seed-model-hy-image', 'seed-model-hy-video', 'seed-model-kimi']);
    for (const r of activeRows) {
      expect(adapterFor(r.provider), `${r.id} provider=${r.provider} 无 adapter`).toBeTruthy();
      expect(r.apiModelName, `${r.id} apiModelName 缺`).toBeTruthy();
    }
    // executable 对迁移行（apiKey 显式 NULL——迁移置空、seed.ts 补写）应真：Z101 零密钥下可售
    for (const r of activeRows) expect(executable({ active: true, provider: r.provider!, apiModelName: r.apiModelName })).toBe(true);
  });

  it('executable/ready 真值表（Z101 拆分——executable 无密钥维度、ready 有）', () => {
    const base = { active: true, provider: 'moonshot', apiModelName: 'kimi-k2.6' };
    expect(executable(base)).toBe(true);
    expect(executable({ ...base, active: false })).toBe(false);                    // 停用（gpt4 形态）
    expect(executable({ ...base, provider: 'stability' })).toBe(false);            // 无 adapter（sdxl 形态）
    expect(executable({ ...base, apiModelName: null })).toBe(false);               // 无外呼真名
    expect(executable({ ...base, apiKey: null } as any)).toBe(true);               // 密钥不进 executable
    expect(ready({ ...base, apiKey: 'sk-x' })).toBe(true);
    expect(ready({ ...base, apiKey: null })).toBe(false);                          // ready=运维就绪
    expect(ready({ ...base, apiKey: '' })).toBe(false);
    expect(executableModel(base) === executable(base)).toBe(true);                  // shared 单源同函数
    expect(readyModel({ ...base, apiKey: 'sk-x' }) === ready({ ...base, apiKey: 'sk-x' })).toBe(true);
  });

  it('adapterFor：null/未知 slug → undefined', () => {
    expect(adapterFor(null)).toBeUndefined();
    expect(adapterFor('nope')).toBeUndefined();
    expect(adapterFor('tencent')!.type).toBe('tencent-submit-poll');
  });
});

describe('Y0b-2 T2：fakeAiEnabled/seedEnvValue（Z93 单源豁免）', () => {
  beforeEach(() => vi.stubEnv('COLLAB_FAKE_AI', ''));
  afterEach(() => vi.unstubAllEnvs());

  it('fakeAiEnabled：仅 COLLAB_FAKE_AI=1 为真（空串/0/undefined 均 false）', () => {
    expect(fakeAiEnabled()).toBe(false);
    vi.stubEnv('COLLAB_FAKE_AI', '0');
    expect(fakeAiEnabled()).toBe(false);
    vi.stubEnv('COLLAB_FAKE_AI', '1');
    expect(fakeAiEnabled()).toBe(true);
  });

  it('seedEnvValue 三键各自取值（空缺=空串非 undefined）', () => {
    expect(seedEnvValue('PROVIDER_MOONSHOT_API_KEY')).toBe('');
    vi.stubEnv('PROVIDER_MOONSHOT_API_KEY', 'sk-m');
    vi.stubEnv('PROVIDER_TENCENT_API_KEY', 'sk-t');
    vi.stubEnv('DASHSCOPE_API_KEY', 'sk-d');
    expect(seedEnvValue('PROVIDER_MOONSHOT_API_KEY')).toBe('sk-m');
    expect(seedEnvValue('PROVIDER_TENCENT_API_KEY')).toBe('sk-t');
    expect(seedEnvValue('DASHSCOPE_API_KEY')).toBe('sk-d');
  });
});
