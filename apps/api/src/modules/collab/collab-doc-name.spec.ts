// apps/api/src/modules/collab/collab-doc-name.spec.ts
// Y0c T4（E23/R0c-4+K11）：parseDocName 铺位单测——docName 语法 `project:<id>#g<N>` 解析+
// 世代一致性拒因判定（世代真源=DB 列 canvasProject.generation；name 段≠DB 列=独立拒因）。
// 世代语义 Y1c-1 才启用——本批只铺解析函数+拒因判定（接线归 Y1c-1）。
import { describe, expect, it } from 'vitest';
import { parseDocName, isValidDocName, isGenerationMismatch } from './collab.gateway';

describe('Y0c T4 parseDocName（docName 语法单源——project:<id>#g<N>）', () => {
  it('现状无世代形态：projectId 解出+generationFromName=undefined', () => {
    expect(parseDocName('project:abc123')).toEqual({ projectId: 'abc123', generationFromName: undefined });
  });

  it('有世代形态：#g<N> 解出世代数（number 非 string）', () => {
    expect(parseDocName('project:abc123#g7')).toEqual({ projectId: 'abc123', generationFromName: 7 });
  });

  it('#g0 显式零代与无世代段可分（undefined≠0——拒因判定「只在有世代段时对比」的前提）', () => {
    expect(parseDocName('project:abc#g0')?.generationFromName).toBe(0);
    expect(parseDocName('project:abc')?.generationFromName).toBeUndefined();
  });

  it('语法违规返 null（空名/缺前缀/缺世代数/异常字符/超长）', () => {
    expect(parseDocName('')).toBeNull();
    expect(parseDocName('abc123')).toBeNull();               // 缺 project: 前缀（别名形态——T16 同拒）
    expect(parseDocName('project:')).toBeNull();             // 空 id
    expect(parseDocName('project:abc#g')).toBeNull();        // 世代段缺数字
    expect(parseDocName('project:ab c')).toBeNull();         // 异常字符
    expect(parseDocName(`project:${'a'.repeat(65)}`)).toBeNull(); // 超 64
  });

  it('Y0b-5 T16 全匹配守卫语义保持：isValidDocName 现状档=无世代段才放行', () => {
    expect(isValidDocName('project:abc123')).toBe(true);
    expect(isValidDocName('project:abc123#g1')).toBe(false); // 世代段语法已冻结、语义 Y1c-1 启用——现状拒（防别名双实例执法分叉复辟）
    expect(isValidDocName('abc123')).toBe(false);
    expect(isValidDocName('')).toBe(false);
  });
});

describe('Y0c T4 isGenerationMismatch（世代一致性拒因判定——铺位可单测）', () => {
  it('无世代段不对比（现状形态恒放行）', () => {
    expect(isGenerationMismatch(undefined, 5)).toBe(false);
    expect(isGenerationMismatch(undefined, 0)).toBe(false);
  });

  it('有世代段：与 DB 列一致放行/不一致=独立拒因', () => {
    expect(isGenerationMismatch(3, 3)).toBe(false);
    expect(isGenerationMismatch(3, 5)).toBe(true);   // vacuumReplace 递增后旧 name——拒
    expect(isGenerationMismatch(0, 0)).toBe(false);  // 显式 #g0 vs DB 0
  });
});
