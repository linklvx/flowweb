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

// T29 生产前置批 charter（spec 偏离 35 D10+偏离 38⑳）：任一未过不得开放生产流量；
// dev-test/beta 档=诚实登记放行；空挂（项缺 id/owner/date/requirement/status）任何档均 fail。
const CHARTER_TIERS = ['dev-test', 'beta', 'production'];
const CHARTER_REQUIRED_FIELDS = ['id', 'owner', 'date', 'requirement', 'status'];

export function decideCharter(charter) {
  const tier = charter?.trafficTier;
  if (!CHARTER_TIERS.includes(tier)) return { verdict: 'fail', why: `trafficTier=${JSON.stringify(tier)} 未知（合法=${CHARTER_TIERS.join('/')}）——fail-closed` };
  const items = Array.isArray(charter.items) ? charter.items : [];
  if (!items.length) return { verdict: 'fail', why: 'charter items 空——空挂=没闭环（偏离 38⑳）' };
  const hollow = items
    .map((it) => ({ it, missing: CHARTER_REQUIRED_FIELDS.filter((f) => !it?.[f]) }))
    .filter((h) => h.missing.length);
  if (hollow.length) return { verdict: 'fail', why: `charter 项空挂（偏离 38⑳「空挂=没闭环」——${CHARTER_REQUIRED_FIELDS.join('/')} 任一缺失即红）: ${hollow.map((h) => `${h.it?.id ?? '(无 id)'} 缺 ${h.missing.join('+')}`).join('; ')}` };
  const open = items.filter((it) => it.status === 'pending' || it.status === 'armed');
  if (tier !== 'production') {
    return { verdict: 'pass', why: `${tier} 档诚实登记：${open.length} 项 pending/armed（${open.map((it) => it.id).join(', ')}）未达标——未开放生产流量（Spooled≠已保存；单机机损 RPO=PG 批延迟）` };
  }
  const bareWaived = items.filter((it) => it.status === 'waived' && !it.evidence);
  const parts = [];
  if (open.length) parts.push(`未过项: ${open.map((it) => `${it.id}(${it.status})`).join(', ')}`);
  if (bareWaived.length) parts.push(`waived 缺实测证据: ${bareWaived.map((it) => it.id).join(', ')}`);
  if (parts.length) return { verdict: 'fail', why: `${parts.join('；')}——任一未过不得开放生产流量（spec 偏离 35）` };
  return { verdict: 'pass', why: `production 档全 ${items.length} 项过（passed/waived[有实测证据]/na）` };
}

// T30 reset-collab 破坏性 reset 判据（spec §4.4 恢复 + plan Task 30）：reset=破坏性最后一步，判据比
// decidePre 严——stranded 在 reset 语境=未决数据阻断（pre 档仅 WARNING）。四阻断：①同库活连接>0
// （旧 DB 消费者在线——「停全部旧消费者之前 reset 必红」的机器化）；②CollabLease scope=primary 持有
// 中（与 collab-rebuild-gen.mjs decideLeaseVerdict 同形态——本文件零 import 纪律，语义等价由
// deploy-guard.test.mjs 对拍钉死）；③inflight>0（/api/ready pending 口径 projects+batches）；④
// strandedFiles>0。pending=null=不可观测放行（消费者已停常态——inflight 观测责任=维护关写/drain 步，
// 三查全量接线归 T30b）。纯函数零 IO。
function leaseVerdictSameShape(leaseRow, nowMs) {
  if (leaseRow == null) return { ok: true, reason: 'no-lease-row' };
  if (leaseRow.owner == null || leaseRow.owner === '') return { ok: true, reason: 'no-holder' };
  if (leaseRow.expiresAtMs != null && leaseRow.expiresAtMs <= nowMs) return { ok: true, reason: 'expired', holder: leaseRow.owner };
  return { ok: false, reason: 'held', holder: leaseRow.owner };
}

export function decideResetGuard({ activeConnections = 0, leaseRow = null, nowMs, pending = null } = {}) {
  const now = nowMs ?? Date.now();
  if (activeConnections > 0) return { verdict: 'fail', why: `消费者在线（activeConnections=${activeConnections}——同库活连接>0：破坏性 reset 前必须停全部旧 DB 消费者〔api/worker/执行链 poller〕，deploy --rebuild-db 顺序断言在此红）` };
  const lease = leaseVerdictSameShape(leaseRow, now);
  if (!lease.ok) return { verdict: 'fail', why: `租约持有中（holder=${lease.holder}——CollabLease scope=primary 在写；先停持有进程或等 TTL 过期再 reset）` };
  if (pending == null) return { verdict: 'pass', why: '连接/租约零；pending 未观测（消费者已停常态——inflight/stranded 阻断在可观测时生效；观测责任=维护关写/drain 步〔runbook §16〕）' };
  const inflight = (pending.projects ?? 0) + (pending.batches ?? 0);
  if (inflight > 0) return { verdict: 'fail', why: `inflight 未清（projects=${pending.projects ?? 0} batches=${pending.batches ?? 0}——/api/ready pending 口径；在飞帧=未决数据，reset 前必须排空）` };
  if ((pending.strandedFiles ?? 0) > 0) return { verdict: 'fail', why: `stranded=${pending.strandedFiles}files（外来段=未决数据——reset 语境阻断，比 decidePre 严：pre 档同输入仅 WARNING）` };
  return { verdict: 'pass', why: '全零（连接/租约/inflight/stranded——破坏性 reset 判据过）' };
}
