// scripts/lib/gate-decision.mjs —— deploy-guard 纯判据函数（零 IO 零 import 副作用；node:test 唯一消费）
// verdict 四值：pass | wait | fail（有账可算——--force 可覆盖并打印 at-risk）| unobservable（无账可算——force 不可覆盖）
// P39/P40：decidePost 增 degraded 参（pre 显式降级→epoch 断言 N/A 显式打印不 fail）；
// epochPreFromRaw 堵 JSON NaN→null→0 往返（B23）；固定预算+drain 循环续期取代自适应。
export const PRE_BUDGET_MS = 90_000;   // P40 固定：循环 pass/fail 即 break——固定与自适应在成功路径等价

export function epochPreFromRaw(raw) {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN;   // 'unavailable'/null/undefined/损坏 → NaN → decidePost fail（B23：Number(null)=0 恒过 isFinite 的陷阱）
}

export function spoolTotal(pending) {
  return (pending?.spoolFiles ?? 0) + (pending?.strandedFiles ?? 0);   // P35 total 口径（+5 判据=pre/post JSON 两行）
}

export function decidePre(body) {
  if (body.pending === undefined) return { verdict: 'unobservable', why: `ready 未返回 pending（token 无效/未配置）——响应键=${Object.keys(body).join(',')}。这是可观测性缺失不是"未排空"（P0-1 分型）；--force 不覆盖此档` };
  if (body.reason === 'spool-unwritable') return { verdict: 'fail', why: 'spool-unwritable——批无法入账 drain 必然超时，人工介入（建议先跑 collab-spool-quarantine/import）' };
  if (body.reason !== 'draining') return { verdict: 'wait', why: `reason=${body.reason}（drain 未生效——若刚过 60s 见续期重 POST〔P40〕；旧版本无端点见 --allow-legacy）` };
  const p = body.pending;
  const zero = p.projects === 0 && p.batches === 0 && p.spoolFiles === 0 && p.spoolBytes === 0;   // spec §4.4 own 四零（维持 SV11）
  if (zero) return { verdict: 'pass', why: `own 四零（内存队列+spool 台账均清——SIGKILL 无可丢项）${(p.strandedFiles ?? 0) > 0 ? `；WARNING stranded=${p.strandedFiles}files 外来段（boot 收养消化）` : ''}` };
  return { verdict: 'wait', why: `未排空 projects=${p.projects} batches=${p.batches} spoolFiles=${p.spoolFiles}（帧明细运维判断）spoolBytes=${p.spoolBytes}` };
}

export function decidePost(body, epochPre, degraded = null) {
  if (!degraded && !Number.isFinite(epochPre)) return { verdict: 'fail', why: `epoch 基线不可用（${epochPre}）——接管断言无意义，禁静默通过（P31/P39：NaN/'unavailable'/null 往返→0 全 fail；显式降级档经 degraded 参数放行并打印 N/A）` };
  if (!body.ready) return { verdict: 'wait', why: `未就绪 reason=${body.reason}` };
  if (body.pending === undefined) return { verdict: 'unobservable', why: 'post 段同样需要授权档视图（token）' };
  const { spoolFiles = 0, strandedFiles = 0 } = body.pending;
  if (spoolFiles > 0) return { verdict: 'wait', why: `own spool 回灌中（spoolFiles=${spoolFiles}——boot 回灌完成前不算部署完成）` };
  if (!degraded && Number(body.epoch) <= epochPre) return { verdict: 'fail', why: `epoch 未递增（pre=${epochPre} post=${body.epoch}）——新实例未接管租约，疑双实例/僵尸实例` };
  const base = degraded
    ? `ready+own spool 归零；epoch 断言 N/A（pre 段降级放行：${degraded}——接管证明由下一次非降级部署产出，本次记入部署记录）`
    : `ready+own spool 归零+epoch 递增（新实例已接管）`;
  return { verdict: 'pass', why: `${base}${strandedFiles > 0 ? `；WARNING stranded=${strandedFiles}files 收养窗异步消化（60s+30s，不阻部署判据）` : ''}` };
}
