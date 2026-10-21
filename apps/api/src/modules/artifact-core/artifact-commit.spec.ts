// apps/api/src/modules/artifact-core/artifact-commit.spec.ts —— Y1a T10 收尾：finalize 有界重试
// 分类器+对象 key 基座单测（无 DB 依赖——40P01/40001/55P03/P2024 全码表钉死；行为面归
// artifact-commit.int.spec 的 ABBA 死锁注入真 40P01 吸收用例）。
import { describe, it, expect } from 'vitest';
import { isRetryableFinalizeError, artifactObjectKeyBase, FINALIZE_TX_MAX_RETRIES, ARTIFACT_SOURCE_URL_TTL_MS } from './artifact-commit.service';

describe('Y1a T10：isRetryableFinalizeError（40P01/40001/55P03/P2024 有界重试码表）', () => {
  it('可重试集：Prisma P2034（deadlock/write conflict 映射）+P2024（pool timeout）+裸 PG SQLSTATE 双形状（code 直挂/meta.code 挂载）', () => {
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P2034' }))).toBe(true);
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P2024' }))).toBe(true);
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: '40P01' }))).toBe(true);   // deadlock_detected
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: '40001' }))).toBe(true);   // serialization_failure
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: '55P03' }))).toBe(true);   // lock_not_available（lock_timeout）
    // P2010+meta.code=SQLSTATE 形态（$queryRaw/$executeRaw 失败——pg-error.util isFkGone 同款双形状）
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P2010', meta: { code: '40P01' } }))).toBe(true);
  });

  it('非重试集：业务错/唯一冲突/连接初始化族——确定性失败不进重试预算', () => {
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(false);  // 唯一冲突
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P1001' }))).toBe(false);  // 连接族
    expect(isRetryableFinalizeError(Object.assign(new Error('x'), { code: 'P2025' }))).toBe(false);
    expect(isRetryableFinalizeError(new Error('普通业务错'))).toBe(false);
    expect(isRetryableFinalizeError(undefined)).toBe(false);
  });

  it('重试预算上界=3+jitter 基座常量（有界性锚——防无限重试热循环）', () => {
    expect(FINALIZE_TX_MAX_RETRIES).toBe(3);
    expect(ARTIFACT_SOURCE_URL_TTL_MS).toBe(24 * 3600_000);   // stage 行 sourceUrl 默认过期窗
  });
});

describe('Y1a T10：artifactObjectKeyBase（content-addressed key 基座）', () => {
  it('形态=artifacts/{teamId}/{intentRowId}/{execSeq}/{index}——sha 后缀由 commitImage 下载自算后拼接', () => {
    expect(artifactObjectKeyBase('t1', 'row-1', 7n, 0)).toBe('artifacts/t1/row-1/7/0');
    expect(artifactObjectKeyBase('t1', 'row-1', 7n, 2)).toBe('artifacts/t1/row-1/7/2');
  });
});
