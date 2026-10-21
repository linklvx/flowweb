// packages/shared/src/canvas/media-fact.test.ts
// Y1a T3（片 S0）：compareExecSeq 单源语义五点——数值比较/2^53 边界/前后导零归一/非法 fail-fast/
// （裸比较禁令的执法面在 scripts/check-plan-census.mjs——grep gate，非本文件）。
// Y1a T8：resolveUpstreamMediaUrl/extractFlowaiObjectKey 上游媒体 URL 解析决策（零依赖纯函数）。
// property test=手写生成式循环（fast-check 仓内零先例，不新增重依赖）——LCG 种子化确定性可复现。
import { describe, expect, it } from 'vitest';
import { compareExecSeq, extractFlowaiObjectKey, resolveUpstreamMediaUrl } from './media-fact';

/** LCG（a=1664525,c=1013904223,m=2^32——Numerical Recipes 参数）：种子化确定性伪随机，跑挂可复现。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
/** 随机非负 BigInt（digits≥1 恒真——循环至少一位，s 恒非空）。 */
function randomSeq(rand: () => number, maxDigits = 25): bigint {
  const digits = 1 + Math.floor(rand() * maxDigits);
  let s = '';
  for (let i = 0; i < digits; i += 1) s += String(Math.floor(rand() * 10));
  return BigInt(s);
}

describe('Y1a T3 compareExecSeq：固定锚点语义', () => {
  it('数值比较非字典序（"10" vs "9"：数值 10>9，字典序 "10"<"9" 是被禁形态）', () => {
    expect(compareExecSeq('10', '9')).toBe(1);
    expect(compareExecSeq('9', '10')).toBe(-1);
    expect(compareExecSeq('2', '100')).toBe(-1);
  });

  it('2^53 边界精度保真（9007199254740992 vs 9007199254740993——Number 比较会塌成相等）', () => {
    expect(Number('9007199254740992') === Number('9007199254740993')).toBe(true); // Number 形态必塌（判据前提自证）
    expect(compareExecSeq('9007199254740992', '9007199254740993')).toBe(-1);
    expect(compareExecSeq('9007199254740993', '9007199254740992')).toBe(1);
  });

  it('前后导零归一（"007"===7——BigInt 解析天然容忍，比较=0）', () => {
    expect(compareExecSeq('007', '7')).toBe(0);
    expect(compareExecSeq('0', '000')).toBe(0);
    expect(compareExecSeq('000123', '123')).toBe(0);
    expect(compareExecSeq('0010', '9')).toBe(1); // 归一后 10>9——导零不影响数值序
  });

  it('相等三态自反（同串=0）', () => {
    expect(compareExecSeq('42', '42')).toBe(0);
    expect(compareExecSeq('0', '0')).toBe(0);
  });

  it('非法 string fail-fast throw（drop 面：空/字母/小数/负数/正号前缀/空白/科学计数法）', () => {
    const bad = ['', 'abc', '1.5', '-1', '+1', ' 1', '1 ', '1e3', '0x10', 'NaN', '１', '1_000'];
    for (const s of bad) {
      expect(() => compareExecSeq(s, '1'), `execSeq "${s}" 须 throw`).toThrow(/EXEC_SEQ_INVALID/);
      expect(() => compareExecSeq('1', s), `execSeq "${s}" 须 throw`).toThrow(/EXEC_SEQ_INVALID/);
    }
  });

  it('非法 throw 消息含原值与合法域说明（诊断可读——仓内 fail-fast 惯例：assertions/copyPlan/docShape）', () => {
    expect(() => compareExecSeq('x', '1')).toThrow(/execSeq "x" 非法.*非负十进制整数/);
  });
});

describe('Y1a T3 compareExecSeq：property（LCG 逐用例独立种子——确定性可复现；每条 ≥100 case 生成式循环）', () => {
  const CASES = 200;

  it('P1 数值序与 BigInt 数值比较全等（非字典序——随机对）', () => {
    const rand = lcg(20261020);
    for (let i = 0; i < CASES; i += 1) {
      const a = randomSeq(rand);
      let b = randomSeq(rand);
      if (b === a) b = a + 1n;
      const want = a < b ? -1 : 1;
      expect(compareExecSeq(a.toString(), b.toString()), `a=${a} b=${b}`).toBe(want);
    }
  });

  it('P2 2^53 上界随机大数 ±1 判别（BigInt 精度——Number 比较在此域必失真）', () => {
    const rand = lcg(20261021);
    for (let i = 0; i < CASES; i += 1) {
      const base = (1n << 53n) + randomSeq(rand, 20); // 恒 >2^53 的随机大数
      expect(compareExecSeq(base.toString(), (base + 1n).toString())).toBe(-1);
      expect(compareExecSeq((base + 1n).toString(), base.toString())).toBe(1);
    }
  });

  it('P3 前后导零不动摇等值与序（随机前导零拼接——"0"*k+n ≡ n）', () => {
    const rand = lcg(20261022);
    for (let i = 0; i < CASES; i += 1) {
      const n = randomSeq(rand);
      const k = Math.floor(rand() * 8);
      const padded = '0'.repeat(k) + n.toString();
      expect(compareExecSeq(padded, n.toString()), `padded=${padded}`).toBe(0);
      const m = n + BigInt(1 + Math.floor(rand() * 1000));
      expect(compareExecSeq(padded, m.toString()), `padded=${padded} m=${m}`).toBe(-1);
    }
  });

  it('P4 非法域随机构造全 throw（数字串随机注入非数字字符）', () => {
    const rand = lcg(20261023);
    const poison = ['a', '.', '-', '+', ' ', 'e', '_'];
    for (let i = 0; i < CASES; i += 1) {
      let s = randomSeq(rand, 6).toString();
      const at = Math.floor(rand() * s.length);
      s = s.slice(0, at) + poison[Math.floor(rand() * poison.length)] + s.slice(at);
      expect(() => compareExecSeq(s, '1'), `s=${s} 须 throw`).toThrow(/EXEC_SEQ_INVALID/);
    }
  });

  it('P5 排序三律：自反/对称/传递（随机三元组全判）', () => {
    const rand = lcg(20261024);
    for (let i = 0; i < CASES; i += 1) {
      const a = randomSeq(rand, 12);
      const b = randomSeq(rand, 12);
      const c = randomSeq(rand, 12);
      const sa = a.toString(), sb = b.toString(), sc = c.toString();
      expect(compareExecSeq(sa, sa)).toBe(0); // 自反
      expect(compareExecSeq(sa, sb)).toBe(-compareExecSeq(sb, sa)); // 反对称
      if (compareExecSeq(sa, sb) < 0 && compareExecSeq(sb, sc) < 0) {
        expect(compareExecSeq(sa, sc)).toBeLessThan(0); // 传递
      }
    }
  });
});

describe('Y1a T8 resolveUpstreamMediaUrl：上游外呼 URL 解析决策', () => {
  const presign = (key: string) => Promise.resolve(`https://minio.local:9000/flowai/${key}?sig=fresh`);

  it('sourceUrl 未过期 → 直传 provider（取自家 URL；presign 降级回调零调用）', async () => {
    const presignSpy = async (key: string) => { throw new Error(`不应触达 presign 降级：${key}`); };
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: 'https://provider-oss.example.com/r1.png', sourceUrlExpiresAt: new Date('2030-01-01T00:00:00Z'), key: 'results/u1/x.png' },
      presignSpy,
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(url).toBe('https://provider-oss.example.com/r1.png');
  });

  it('sourceUrlExpiresAt 为 null（无显式过期语义列值）→ 直传不校验过期', async () => {
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: 'https://provider-oss.example.com/r2.png', sourceUrlExpiresAt: null, key: 'results/u1/y.png' },
      async () => { throw new Error('不应触达 presign 降级'); },
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(url).toBe('https://provider-oss.example.com/r2.png');
  });

  it('Y1a T8 红测 3（sourceUrl 过期降级）：过期 → presigned GET 降级路径（nginx /flowai 公网可达）', async () => {
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: 'https://provider-oss.example.com/expired.png', sourceUrlExpiresAt: new Date('2026-10-20T00:00:00Z'), key: 'results/u1/z.png' },
      presign,
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(url).toBe('https://minio.local:9000/flowai/results/u1/z.png?sig=fresh');
  });

  it('过期判定含端点（expiresAt === now → 已过期走降级）', async () => {
    const at = new Date('2026-10-21T00:00:00Z');
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: 'https://provider-oss.example.com/e.png', sourceUrlExpiresAt: at, key: 'k.png' },
      presign,
      at,
    );
    expect(url).toContain('sig=fresh');
  });

  it('sourceUrl 缺失（null）→ presigned GET 降级（sourceUrl 非必填列）', async () => {
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: null, sourceUrlExpiresAt: null, key: 'results/u1/w.png' },
      presign,
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(url).toBe('https://minio.local:9000/flowai/results/u1/w.png?sig=fresh');
  });

  it('sourceUrlExpiresAt 支持 string 形态（JSON/wire 传输后的 ISO 串）', async () => {
    const url = await resolveUpstreamMediaUrl(
      { sourceUrl: 'https://p.example.com/s.png', sourceUrlExpiresAt: '2030-01-01T00:00:00.000Z', key: 'k.png' },
      async () => { throw new Error('不应触达 presign 降级'); },
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(url).toBe('https://p.example.com/s.png');
  });
});

describe('Y1a T8 extractFlowaiObjectKey：/flowai URL → MinIO 对象键', () => {
  it('同源路径形态 /flowai/<key> → key（web toFlowaiUrl 改写产物）', () => {
    expect(extractFlowaiObjectKey('/flowai/uploads/u1/2026-10-20/a.png')).toBe('uploads/u1/2026-10-20/a.png');
  });

  it('完整 presigned URL（任意域名+/flowai 前缀）→ key（query 签名参数剥离）', () => {
    expect(extractFlowaiObjectKey('https://minio.local:9000/flowai/results/u1/x.png?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc'))
      .toBe('results/u1/x.png');
  });

  it('外网 URL（非 /flowai 域）→ null（用户手工输入——非本仓 Media 域，身份化维持原值）', () => {
    expect(extractFlowaiObjectKey('https://cdn.example.com/img.png')).toBeNull();
  });

  it('非 /flowai 前缀的同源路径 → null', () => {
    expect(extractFlowaiObjectKey('/api/media/m1/content')).toBeNull();
  });

  it('/flowai 根裸路径（无 key）→ null（空 key 非法）', () => {
    expect(extractFlowaiObjectKey('/flowai')).toBeNull();
    expect(extractFlowaiObjectKey('/flowai/')).toBeNull();
  });
});
