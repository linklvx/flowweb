// Y0b-5 T16（spec §5.9 E57）：PG 熔断器——范围=新装载/新会话准入+store PG 分支短路。
// 边界钉死（spec：A5 范围修正）：不裹 lease 心跳（租约抖动→误自隔离）、不拒 WS 帧路径、
// 不拒 append（失败走 spool 既有契约——拒=数据丢失）。防的是"每条新装载等满 5s 事务超时"。
// 判据=30s 滚动窗 ∧ 连接族样本 ≥5 ∧ 失败率>50%（纯连续计数在低 QPS 假阳性——窗口下限采纳；
// 仅连接族样本计数：P2024 池满/业务错/无 code 只计 failures_total{class} 观测不推闸）。
// 半开=冷却期（10s）后转 half-open，下一次调用为探测：成功→closed+onRecovered 回调（gateway 接
// refusalCache.clear()——冻结契约 16 第五钩子）；失败→回 open（冷却重启）。
import { Injectable, Optional } from '@nestjs/common';
import { collabPgBreakerState, collabPgBreakerFailuresTotal } from './store.metrics';
import { classifyPgError } from './pg-error.util';

export type BreakerStateName = 'closed' | 'open' | 'half-open';

/** 判据常量导出=测试绑定面（BACKPRESSURE 双阈先例——改值本测试红） */
export const BREAKER_WINDOW_MS = 30_000;
export const BREAKER_MIN_SAMPLES = 5;
export const BREAKER_OPEN_RATIO = 0.5;
export const BREAKER_COOLDOWN_MS = 10_000;

type WindowSample = { at: number; failed: boolean };

@Injectable()
export class CollabPgBreakerService {
  private state: BreakerStateName = 'closed';
  /** 滚动窗样本（成功+连接族失败皆入窗=比率分母；池满/其他失败不入窗——"仅连接族样本计数"） */
  private readonly window: WindowSample[] = [];
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  /** half-open 探测成功回调（gateway 注入 refusalCache 清空——清空点二，:257 锚 1→2） */
  private onRecovered: (() => void) | null = null;
  private readonly cooldownMs: number;

  /** @Optional 直构注入（int spec 注短冷却——生产 DI 无参恒默认 10s；env 旋钮不设=YAGNI，
   *  组装期构造注入即"N/T 可调"面——env 单源锚禁直读未登记键） */
  constructor(@Optional() cooldownMs?: number) {
    this.cooldownMs = cooldownMs ?? BREAKER_COOLDOWN_MS;
    collabPgBreakerState.set(0);   // gauge 播种 closed（未 set 前 prom-client get 为空值）
  }

  setOnRecovered(fn: () => void): void { this.onRecovered = fn; }

  /** 准入判定（调用点①②：onAuthenticate/loadDocument 入口首段）——open 拒、closed/half-open 放行 */
  admitQuery(): boolean { return this.state !== 'open'; }
  /** store 短路判定（调用点③：storeDocumentUnlocked PG 分支首行）——open 直落 spool 兜底 */
  isOpen(): boolean { return this.state === 'open'; }
  /** 观测读数（gateway.isPgBreakerOpen 经本方法委托——闸门调用点静态锚恰三，勿新增 admit/isOpen 调用点） */
  stateName(): BreakerStateName { return this.state; }

  /** PG 调用成功样本（auth 成功/装载成功/store 逐片 ok）。half-open 成功=探测成功→closed。 */
  recordSuccess(): void {
    if (this.state === 'half-open') { this.close(); return; }
    if (this.state === 'closed') this.push(false);   // open 期成功样本无意义（调用面已被拒/短路）
  }

  /** PG 调用失败样本。全类计数（failures_total{class}）；仅 connection 族参与状态机。 */
  recordFailure(error: unknown): void {
    const cls = classifyPgError(error);
    collabPgBreakerFailuresTotal.inc({ class: cls });
    if (cls !== 'connection') return;
    if (this.state === 'half-open') { this.trip(); return; }   // 探测失败——回 open（冷却重启）
    if (this.state === 'open') return;
    this.push(true);
  }

  /** 样本入窗+滚动修剪+判据评估（成功样本也评估——4F+1S 比率 0.8 同样满足 open 判据） */
  private push(failed: boolean): void {
    const now = Date.now();
    this.window.push({ at: now, failed });
    while (this.window.length > 0 && now - this.window[0].at >= BREAKER_WINDOW_MS) this.window.shift();
    const fails = this.window.filter((w) => w.failed).length;
    if (this.window.length >= BREAKER_MIN_SAMPLES && fails / this.window.length > BREAKER_OPEN_RATIO) this.trip();
  }

  private trip(): void {
    this.window.length = 0;
    this.clearCooldown();
    this.state = 'open';
    collabPgBreakerState.set(1);
    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      if (this.state === 'open') { this.state = 'half-open'; collabPgBreakerState.set(2); }
    }, this.cooldownMs);
    this.cooldownTimer.unref?.();
  }

  private close(): void {
    this.clearCooldown();
    this.window.length = 0;
    this.state = 'closed';
    collabPgBreakerState.set(0);
    this.onRecovered?.();
  }

  private clearCooldown(): void {
    if (this.cooldownTimer) { clearTimeout(this.cooldownTimer); this.cooldownTimer = null; }
  }
}
