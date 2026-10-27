// apps/web/src/collab/connection-supervisor.ts
// Y0b-5 T3b（裁定 23⑴/24⑴）：CollabConnectionSupervisor——单连接所有权。
// ★所有权边界：supervisor 独占【全部】websocketProvider.connect()/disconnect()（全仓唯一调用模块，
//   结构性所有权非注释约定）——瞬态退避/终态/1012/普通掉线全归；库内重试被双重禁用：
//   ①open 归零 shouldConnect（runtime createProvider pin autoConnect:false + 本模块 open 监听 setConfiguration
//   归零——库 onClose 1s 定时器守卫 `!cancelWebsocketRetry && shouldConnect`（esm:411-413）结构性永不排程）；
//   ②maxAttempts:1 关单次 connect 内部 retry ladder（esm:242-244 ladder 用尽 reject——connectOnce 必吞）。
// watchdog 降级纯观测（裁定 23⑴）：零 kick 路径——卡死兜底=assertHealthy 单向边（裁定 24⑩，恢复权唯一）。
// 排程五档穷尽（T0 单源 resolveBackoffPlan）：terminal→none（永久断线）｜silent-renew→500ms 一次+闩锁｜
// short→1s+full jitter 0-60s（裁定 23⑶ NAT 部署窗算术）｜backoff/normal→指数表 TRANSIENT_BACKOFF_STEPS_MS。
// 楔死检测所有权：检测=库 checkConnection（strike1 软关 close→真实 close 事件→本模块路由；strike3 合成
// 4408 不 emit close——由本模块 'disconnect' 订阅面兜住，锚③互补）；重连=本模块。
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { resolveBackoffPlan, resolveCloseAction } from '@flowweb/shared';
import { recordCollabDiag } from '@/utils/collabDiagnostics';

/** AUTH 显式超时（裁定 23⑸）：connect 后 10s 未 authenticated→断+attempt++ 重排——
 *  防 socket OPEN 但 isAuthenticated 永假挂起（permissionDeniedHandler 只 emit 不断开，esm:949-952）。 */
export const AUTH_WAIT_TIMEOUT_MS = 10_000;
/** kickNow 抖动上界（裁定 25⑶）：0-3s——0-1s 下 40 人同刻回前台 burst 20 必 429。 */
export const KICK_JITTER_MAX_MS = 3_000;
/** 指数档抖动上界（首档 2s+0-2s——恢复时延窗 2-4s，裁定 23⑻）。 */
export const EXPONENTIAL_JITTER_MAX_MS = 2_000;
/** silent-renew 抖动上界（500ms+jitter——立即一次不进阶梯，裁定 24⑴）。 */
export const SILENT_RENEW_JITTER_MAX_MS = 500;
/** 1012 short 档抖动上界（裁定 23⑶：full jitter 0-60s——NAT 部署窗算术）。 */
export const SHORT_JITTER_MAX_MS = 60_000;

export type SupervisorPhase = 'idle' | 'waiting' | 'connected' | 'terminal' | 'resyncing';

export interface SupervisorDeps {
  /** 当前会话 provider 句柄（终态重建/换会话后由 getProvider 取到新实例——attach 重挂监听） */
  getProvider: () => HocuspocusProvider | null;
  /** connStatus==='offline' 判据（注入取值——canvasStore 依循环依赖裁定禁直连） */
  isConnOffline: () => boolean;
}

export interface CloseDecision {
  terminal: boolean;
  /** terminal 档原因（UX 写点消费——runtime close handler） */
  terminalReason?: string;
  /** 已处终态的重复路由（本方 disconnect 触发的二次 close——UX 写点跳过防覆盖） */
  already?: boolean;
}

export interface SupervisorSnapshot {
  phase: SupervisorPhase;
  attempt: number;
  /** 重连 timer 待触发 */
  timer: boolean;
  /** 当前排程的 timer 值 ms（T25 收口 I-4——4413 Retry-After 重排的可红化断言面；无 timer=0） */
  scheduledMs: number;
  /** AUTH_WAIT timer 待触发 */
  authTimer: boolean;
  /** 在飞 attempt（socket CONNECTING/OPEN 或 connectionAttempt 非空） */
  inFlight: boolean;
}

/** jitter 生成器（模块级注入——runtime 默认 Math.random；测试钉 0 做确定性阶梯断言） */
let jitterGen: (maxMs: number) => number = (max) => Math.random() * max;
/** 测试缝：钉 0/恢复默认（传 null 恢复） */
export function setSupervisorJitterForTest(fn: ((maxMs: number) => number) | null): void {
  jitterGen = fn ?? ((max) => Math.random() * max);
}

export class CollabConnectionSupervisor {
  private readonly deps: SupervisorDeps;
  private _phase: SupervisorPhase = 'idle';
  private attempt = 0;
  private terminalReason: string | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  /** 会话代数（teardown 递增）——timer 回调判活：旧 timer 不 kick 新会话（真实缺陷路径用例） */
  private epoch = 0;
  private epochAtSchedule = 0;
  /** 本轮 connect 之后的 close burst 是否已被路由（真实 close 两事件同源去重——close+disconnect 只处理一次） */
  private closeHandled = false;
  /** 同 burst 首个决策（去重回放——真实暴发序=disconnect 先于 close〔ws 层 own onClose 先于 attach 的
   *  forwardClose〕，两入口必须拿到同一决策：silent-renew 闩锁/terminal UX 写点不可被二次路由翻转） */
  private lastDecision: CloseDecision | null = null;
  /** 4401 'session-expired' 静默续期闩锁（一会话一次；authenticated 重置——runtime:1039-1041 语义收编） */
  private silentRenewUsed = false;
  private lastScheduledMs = 0;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
  }

  /** 挂接 provider 事件面（createProvider 每次调用——终态重建后新实例重挂；旧实例 destroy 已 removeAllListeners）。
   *  open 监听=★归零锚（setConfiguration 公开 setter——库重连结构性失效的收归保证）。 */
  attach(provider: HocuspocusProvider): void {
    provider.on('open', () => {
      this.zeroNow();
      this._phase = 'connected';
      this.closeHandled = false;
      this.lastDecision = null;
    });
    provider.on('authenticated', () => {
      if (this.authTimer !== null) { clearTimeout(this.authTimer); this.authTimer = null; }
      this.attempt = 0;
      this.silentRenewUsed = false;   // S-4：每次成功认证重置一次静默续期额度
    });
    // disconnect 订阅（锚③互补）：库合成 4408 不 emit close、onClose 恒 emit disconnect——
    // 真实 close 两事件同源必须去重。★延迟一拍路由：真实 burst 中 close 与 disconnect 同步同栈
    // （ws 层同一 emit("close")——own onClose 发 disconnect、attach 的 forwardClose 发 close），
    // close 先到则由其路由（决策权归 close 调用方=runtime UX 写点）；无 close 跟随（合成 4408
    // wedge 形态）→本延迟路由兜底。
    provider.on('disconnect', (payload: any) => {
      if (this._phase === 'terminal' || this.closeHandled) return;
      const code = payload?.event?.code;
      const reason = payload?.event?.reason;
      const epochAt = this.epoch;
      setTimeout(() => {
        if (epochAt !== this.epoch || this._phase === 'terminal' || this.closeHandled) return;
        this.routeClose(code, reason);
      }, 0);
    });
  }

  /** ★归零锚本体（open 监听消费；公开=不变量自愈复跑入口）：shouldConnect===true 时重放归零。
   *  setConfiguration({autoConnect:false}) 为法定路径（公开 setter 零 override）；若未落（mock 漂移/
   *  库行为漂移）直接字段写兜底+遥测（hook 单点自证）。 */
  zeroNow(): void {
    const ws = this.wsOf();
    if (!ws) return;
    ws.setConfiguration?.({ autoConnect: false });
    if (ws.shouldConnect !== false) {
      ws.shouldConnect = false;
      recordCollabDiag('recover_triggered', { level: 'transient' });   // 归零自愈兜底介入（遥测面 recover_triggered{level}）
    }
  }

  /** 全仓唯一 connect 调用封装（锚⑤⑥⑳）：
   *  - 无 ws → false；terminal → false（复发防线——终态零 connect）；
   *  - 槽位守卫：webSocket.readyState∈{CONNECTING,OPEN} → false（锚⑤在飞双 connect 必炸第二 socket；
   *    锚⑥"非空即退"在 CLOSED 残留/webSocket===null 时永不重连=死锁——守卫必须按 readyState 判）；
   *  - connect() reject 必吞（maxAttempts:1 ladder 用尽 rethrow，esm:242-244）+失败复置 shouldConnect=false
   *    （open 前失败窗内一致性——防任何残余路径排库定时器）；
   *  - connect 后武装 AUTH_WAIT 定时器（Step④ 显式超时）。 */
  connectOnce(): boolean {
    const ws = this.wsOf();
    if (!ws || this._phase === 'terminal') return false;
    const rs = ws.webSocket?.readyState;
    if (rs === 0 || rs === 1) return false;
    this.closeHandled = false;
    this.lastDecision = null;
    this._phase = 'waiting';   // attempt 在飞=waiting（connect 成功后由 open 事件转 connected）
    try {
      const r: unknown = ws.connect?.();
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => { ws.setConfiguration?.({ autoConnect: false }); });
      }
    } catch {
      ws.setConfiguration?.({ autoConnect: false });
    }
    this.armAuthTimer();
    return true;
  }

  /** 瞬态入口（runtime authFailed 瞬态档）：①断 OPEN 僵尸（shouldConnect=false——归零外第二道保险）
   *  ②指数表重排（auth 路由——isTerminalReason 已由调用方分型，此处恒瞬态）。 */
  beginTransientBackoff(reason: string): void {
    if (this._phase === 'terminal') return;
    this.disconnectSocket();
    this.scheduleReconnect(this.planWithJitter('auth', undefined, reason));
  }

  /** terminal 终局（复发防线钉死）：清全部 timer→phase='terminal'→disconnect——零重试零恢复。 */
  terminalDisconnect(reason: string): void {
    this.clearTimers();
    this._phase = 'terminal';
    this.terminalReason = reason || undefined;
    this.disconnectSocket();
  }

  /** close/disconnect 路由（五档穷尽——T0 单源 resolveBackoffPlan 分派）：
   *  terminal→disconnect 终局｜silent-renew→闩锁+500ms 一次（第二次同因回落 terminal）｜
   *  planned-restart→short 档｜backoff/normal→exponential（普通掉线归此——首档 2s 远优于库 1s 热循环）。
   *  ★burst 去重：同一 close 的 disconnect+close 两事件只路由一次；后续 close（含本方 terminalDisconnect
   *  自身触发的 socket close）→回放决策+already 标记（runtime UX 写点跳过防重复 reload/横幅）。 */
  routeClose(code: number | undefined, reason: string | undefined): CloseDecision {
    if (this.closeHandled && this.lastDecision) {
      return { ...this.lastDecision, already: true };
    }
    if (this._phase === 'terminal') {
      return { terminal: true, terminalReason: this.terminalReason, already: true };
    }
    const probe = resolveBackoffPlan('close', code, reason ?? '', this.attempt, 0);
    let decision: CloseDecision;
    if (probe.kind === 'none') {
      // terminal（resolveCloseAction 双键分型的 terminalReason 透传）
      const action = resolveCloseAction(code!, reason);   // kind==='none' 两源：close 路由 terminal 档（code 有值）｜
      // code===undefined 且 isTerminalReason(reason)（shared:106 auth 语义分支）——后者畸形组合 code! 实为 undefined，
      // resolveCloseAction 全码不匹配落表尾 backoff（terminalReason===undefined），?? reason ?? '' 透传 raw reason——行为安全
      this.terminalDisconnect(action.terminalReason ?? reason ?? '');
      decision = { terminal: true, terminalReason: this.terminalReason };
    } else if (probe.kind === 'silent-renew') {
      if (this.silentRenewUsed) {
        // 第二次同因回落 terminal（一会话一次语义保持）
        this.terminalDisconnect('session-expired');
        decision = { terminal: true, terminalReason: 'session-expired' };
      } else {
        this.silentRenewUsed = true;
        this.scheduleReconnect(this.planWithJitter('close', code, reason ?? ''));   // silent-renew 档基值 500ms 单源 shared（probe 已定档——planWithJitter 必返同档）
        decision = { terminal: false };
      }
    } else {
      this.scheduleReconnect(this.planWithJitter('close', code, reason ?? ''));
      decision = { terminal: false };
    }
    this.closeHandled = true;
    this.lastDecision = decision;
    return decision;
  }

  /** 瞬态立即恢复（recoverConnection 收编后瞬态分支）：断 OPEN/CONNECTING 残留→清既有排程→立即 connectOnce。
   *  T25b M-R1：resyncing 相位让位（重建窗内恢复权归 resync 链）。 */
  recoverNow(): void {
    const ws = this.wsOf();
    if (!ws || this._phase === 'terminal' || this._phase === 'resyncing') return;
    this.disconnectSocket();
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.connectOnce();
  }

  /** Y1c T25（4413 maintenance-freeze Retry-After 消费）：重排已排程的重连 timer——仅对
   *  在飞 waiting 档生效（terminal 无 timer；无 timer=已连/未排程零动作）。语义=覆盖 short 档
   *  默认 1s（重连循环反复撞冻结门防线——Retry-After 语义非指数阶梯）。 */
  rescheduleReconnect(ms: number): boolean {
    if (this._phase === 'terminal' || this.timer === null) return false;
    clearTimeout(this.timer);
    this.lastScheduledMs = ms;
    this.timer = setTimeout(() => this.onTimerFire(), ms);
    return true;
  }

  /** 公开 kick 入口（bindReevaluateOnce 的 online/visibilitychange(可见) 接线）：0-3s jitter 排程；
   *  已排程/terminal/在飞 attempt → 忽略（false）。T25b M-R1：resyncing 相位让位（不重排旧
   *  provider——重建窗内 kick=同 doc SS2 毒重放面）。 */
  kickNow(): boolean {
    if (this._phase === 'terminal' || this._phase === 'resyncing' || this.timer !== null || this.inFlight()) return false;
    return this.scheduleReconnect(this.jitter(KICK_JITTER_MAX_MS));
  }

  /** watchdog 3s tick 单向边（裁定 24⑩——卡死兜底）：navigator.onLine ∧ phase!=='terminal' ∧
   *  connStatus==='offline' ∧ 无在飞 timer ∧ 无在飞 attempt → 立即 scheduleReconnect。
   *  execute=false（kill switch）只判不出手；不直接碰 socket——恢复权唯一。
   *  返回 true=stalled 成立（runtime 记 watchdog_fire{reason:'stalled'}）。 */
  assertHealthy(execute: boolean): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;   // 飞行模式不烧阶梯——恢复归 online→kickNow
    if (this._phase === 'terminal') return false;
    if (this._phase === 'resyncing') return false;   // T25b M-R1：resync 重建窗让位（不重排旧 provider）
    if (!this.deps.isConnOffline()) return false;
    if (this.timer !== null || this.authTimer !== null) return false;
    if (this.inFlight()) return false;
    if (!execute) return true;
    this.scheduleReconnect(this.planWithJitter('timeout', undefined, ''));
    return true;
  }

  /** 会话清理（teardownSession 消费）：清全部 timer+epoch++（旧 timer 判活作废）+状态归零。
   *  T25b M-R1：**保持 resyncing 相位**——teardown 后仍有 provider.destroy await 缝（module
   *  provider 依旧是旧实例），kickNow/assertHealthy 在该缝内让位；相位退出归 createProvider
   *  connectOnce（'waiting'）或 resync 失败 endResync。 */
  teardown(): void {
    this.clearTimers();
    this.epoch++;
    this._phase = this._phase === 'resyncing' ? 'resyncing' : 'idle';
    this.attempt = 0;
    this.terminalReason = undefined;
    this.closeHandled = false;
    this.lastDecision = null;
    this.silentRenewUsed = false;
  }

  get phase(): SupervisorPhase { return this._phase; }

  snapshot(): SupervisorSnapshot {
    return {
      phase: this._phase,
      attempt: this.attempt,
      timer: this.timer !== null,
      scheduledMs: this.timer !== null ? this.lastScheduledMs : 0,
      authTimer: this.authTimer !== null,
      inFlight: this.inFlight(),
    };
  }

  /** Y1c T25 收口 C-1(quality)：同步取消已排程重连（resync-full 分派在**任何 await 前**调用——
   *  routeClose 的 short 档 1s+jitter timer 若存活，异步导出窗内触发=旧 provider 同 doc 重连
   *  SS2 上行被拒毒增量「修复」复活〔红①自己实锤的形态被概率性击穿〕）。返回是否有 timer 被取消。 */
  cancelScheduledReconnect(): boolean {
    if (this.timer === null) return false;
    clearTimeout(this.timer);
    this.timer = null;
    return true;
  }

  /** T25b M-R1：进入 resyncing 相位（resync 分派在 cancelScheduledReconnect 同点同步调用——任何
   *  await 前）。相位语义=重建窗内旧 provider 禁任何事件触发恢复（kickNow visibilitychange/
   *  online、assertHealthy 3s watchdog、routeClose/armAuthTimer 重排全让位）——窗内任何 connect
   *  都是旧 doc 同 doc 重连 SS2 毒重放面。退出=initCollab→createProvider→connectOnce（'waiting'）
   *  或 resync 失败 endResync（回 idle 恢复常规监管）；teardown **保持** resyncing（await 缝覆盖：
   *  supervisor.teardown→provider.destroy await 间 module provider 仍旧实例）。 */
  beginResync(): boolean {
    if (this._phase === 'terminal') return false;
    this.clearTimers();
    this._phase = 'resyncing';
    return true;
  }

  /** T25b M-R1：resync 收尾释放（resyncFull finally——initCollab 已重建时相位已前进而 no-op；
   *  重建失败/早退档恢复常规监管，防 kickNow/assertHealthy 永久让位死区）。 */
  endResync(): void {
    if (this._phase === 'resyncing') this._phase = 'idle';
  }

  /** T25b B4（面 B——recovery 模式出口）：terminal 相位恢复（deny-escape 恢复模式粘住的唯一出口
   *  ——用户完成裁定导入后 denyTracker.recoveryComplete+本方法+connectOnce）。非 terminal=no-op。 */
  resume(): boolean {
    if (this._phase !== 'terminal') return false;
    this.clearTimers();
    this._phase = 'idle';
    this.terminalReason = undefined;
    return true;
  }

  // ── 内部 ──

  private wsOf(): any {
    const p = this.deps.getProvider();
    return (p as any)?.configuration?.websocketProvider;
  }

  private inFlight(): boolean {
    const ws = this.wsOf();
    if (!ws) return false;
    const rs = ws.webSocket?.readyState;
    return rs === 0 || rs === 1 || ws.connectionAttempt != null;
  }

  private disconnectSocket(): void {
    this.wsOf()?.disconnect?.();
  }

  private jitter(maxMs: number): number {
    return maxMs > 0 ? jitterGen(maxMs) : 0;
  }

  /** T0 单源排程值：probe（jitter=0）定档→按档抖动上界重算（档基值 1s/500ms/指数表全在 shared——零复制）。 */
  private planWithJitter(route: 'auth' | 'close' | 'timeout', code: number | undefined, reason: string): number {
    const probe = resolveBackoffPlan(route, code, reason, this.attempt, 0);
    if (probe.kind === 'none') return 0;
    const max = probe.kind === 'short' ? SHORT_JITTER_MAX_MS
      : probe.kind === 'silent-renew' ? SILENT_RENEW_JITTER_MAX_MS
        : EXPONENTIAL_JITTER_MAX_MS;
    return resolveBackoffPlan(route, code, reason, this.attempt, this.jitter(max)).ms;
  }

  /** 统一排程入口（瞬态/普通掉线/1012/AUTH_WAIT/kick/stalled 全走）——恰一待触发 timer 不变量：
   *  已有 timer → 忽略（false）。T25b M-R1：resyncing 相位禁排程（routeClose/armAuthTimer 等
   *  一切旧 provider 事件面重排在重建窗内结构性让位）。 */
  private scheduleReconnect(ms: number): boolean {
    if (this.timer !== null) return false;
    if (this._phase === 'resyncing') return false;
    this._phase = 'waiting';
    this.epochAtSchedule = this.epoch;
    this.lastScheduledMs = ms;
    this.timer = setTimeout(() => this.onTimerFire(), ms);
    return true;
  }

  private onTimerFire(): void {
    this.timer = null;
    if (this.epochAtSchedule !== this.epoch) return;          // teardown/新会话——旧 timer 不 kick 新会话
    if (this._phase === 'terminal') return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.scheduleReconnect(this.lastScheduledMs);           // hidden 不连——挂起重排不消耗（恰一 timer 保持）
      return;
    }
    // 恢复尝试发起=新 burst 起点：重置 burst 标记（本 attempt 后的 close 必须按新 close 路由——
    // 若 connectOnce 被 slot guard 挡下，残留 closeHandled 会把后续真实 close 吞成 replay=零排程停摆）
    this.closeHandled = false;
    this.lastDecision = null;
    this.attempt++;
    recordCollabDiag('recover_triggered', { level: 'transient' });
    this.connectOnce();
  }

  private armAuthTimer(): void {
    if (this.authTimer !== null) clearTimeout(this.authTimer);
    const epochAtArm = this.epoch;
    this.authTimer = setTimeout(() => {
      this.authTimer = null;
      if (epochAtArm !== this.epoch) return;                  // 会话已换——旧 AUTH_WAIT 作废
      if (this._phase === 'terminal') return;
      if (this.deps.getProvider()?.isAuthenticated === true) return;
      if (this.timer !== null) return;                        // close 路由已接管恢复——不叠加
      this.closeHandled = false;                              // 同 onTimerFire——新 burst 起点
      this.lastDecision = null;
      const ms = this.planWithJitter('timeout', undefined, '');   // 档位按既有失败数（attempt++ 前算——AUTH_WAIT 是第 N 次失败，重试 delay=steps[N]）
      this.attempt++;
      this.disconnectSocket();                                // 断 OPEN 挂起（permissionDenied 不断开形态）
      this.scheduleReconnect(ms);
    }, AUTH_WAIT_TIMEOUT_MS);
  }

  private clearTimers(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.authTimer !== null) { clearTimeout(this.authTimer); this.authTimer = null; }
  }
}

/** runtime 单例工厂（注入 getProvider/isConnOffline——防 canvasStore 循环依赖直连） */
export function createSupervisor(deps: SupervisorDeps): CollabConnectionSupervisor {
  return new CollabConnectionSupervisor(deps);
}
