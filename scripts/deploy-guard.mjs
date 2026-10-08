// scripts/deploy-guard.mjs —— Y0a-4 部署拒重启三步（spec §4.4）+post-restart 段（P15）
// 服务器运行：node scripts/deploy-guard.mjs [--post-restart] [--force] [--allow-legacy] [--api-url URL]
// 结构：纯判据在 scripts/lib/gate-decision.mjs（import 零副作用——isMain 守卫，B16）；
//      env 零依赖自读在 scripts/lib/env-file.mjs（B15+P45 单源）；
//      状态文件生命周期 v2（P39）：pre 所有退出路径写 state（含 degraded 标记）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decidePre, decidePost, epochPreFromRaw, spoolTotal, PRE_BUDGET_MS } from './lib/gate-decision.mjs';
import { readEnvFile } from './lib/env-file.mjs';

const here = fileURLToPath(import.meta.url);
const ROOT = resolve(here, '../..');
const STATE = resolve(ROOT, '.deploy-guard-state.json');   // gitignored

const argv = process.argv.slice(2);
const KNOWN = ['--post-restart', '--force', '--allow-legacy', '--api-url'];
const unknownArg = argv.find((a) => a.startsWith('--') && !KNOWN.includes(a));
if (unknownArg) { console.error(`deploy-guard FAIL: 未知参数 ${unknownArg}（部署门禁禁静默忽略）`); process.exit(1); }
const has = (k) => argv.includes(k);
const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const POST = has('--post-restart'), FORCE = has('--force'), ALLOW_LEGACY = has('--allow-legacy');
const API = val('--api-url', 'http://127.0.0.1:3000');
const TOKEN = process.env.COLLAB_ADMIN_TOKEN ?? readEnvFile(resolve(ROOT, 'apps/api/.env'), ['COLLAB_ADMIN_TOKEN']).COLLAB_ADMIN_TOKEN;
const H = { 'x-prometheus-token': TOKEN };
const t0 = Date.now();

async function getReady() { const r = await fetch(`${API}/api/ready`, { headers: H }); return { status: r.status, body: await r.json().catch(() => null) }; }
async function postDrain() {
  // 响应体必须消费（win32 实测：不消费→undici 在途 socket 泄漏）
  try { const r = await fetch(`${API}/api/drain`, { method: 'POST', headers: H }); await r.arrayBuffer().catch(() => {}); return r; }
  catch (e) { e.unreachable = true; return e; }
}
function requireToken(phase) {
  if (!TOKEN) { console.error(`deploy-guard FAIL(${phase}): COLLAB_ADMIN_TOKEN 未设置（读 apps/api/.env——W23 独立停机令牌；runbook §1 先建令牌）`); return false; }
  return true;
}

/** P39 单一写口：所有 pre 退出路径经此——degraded ∈ null|'legacy'|'unreachable'；epochPre ∈ number|'unavailable'（禁 null——B23） */
function writeState({ degraded = null, epochRaw = 'unavailable', drainAt = null, pendingBefore = null }) {
  writeFileSync(STATE, JSON.stringify({ v: 1, sha: process.env.GIT_SHA ?? null, startedAt: Date.now(), drainAt, degraded, epochPre: epochRaw, pendingBefore }));
}

// win32 实测（B-uv）：process.exit() 在 undici POST socket 在池时触发 libuv "UV_HANDLE_CLOSING"
// 断言崩溃→exit 127 不可信——部署门 exit 码契约被破坏。故两 phase 一律 return 退出码，
// 顶层以 process.exitCode 收口（事件循环自然排空后退出，实测 0.1s 内、码确定）。
async function prePhase() {
  if (!requireToken('pre')) return 1;
  if (existsSync(STATE)) {
    try { const prev = JSON.parse(readFileSync(STATE, 'utf8')); console.log(`deploy-guard: 覆盖上一轮状态（sha=${prev.sha} age=${Math.round((Date.now() - prev.startedAt) / 1000)}s）——pre 每次覆写，post 按 SHA 断言防串档（P39）`); } catch { /* 损坏→直接覆写 */ }
  }
  const drainResp = await postDrain();
  if (drainResp.unreachable) {
    writeState({ degraded: 'unreachable' });   // P39：降级档也写 state——post 段 N/A 而非误红
    if (!FORCE) { console.error(`deploy-guard FAIL: drain 不可达（${drainResp.message}）——API 未起？确认实例状态；确认无在途写入后 --force 可越过（本次无停写保护）`); return 1; }
    console.log(`deploy-guard WARNING(--force): drain 不可达（${drainResp.message}）——目标无在途可查，按"无写入"处置继续（本次部署无停写保护+post 段 epoch 断言 N/A；runbook §3 要求留部署记录）`);
    return 0;
  }
  if (drainResp.status === 404) {
    writeState({ degraded: 'legacy' });   // P39：run#1 装能力档——post 段 N/A
    if (!ALLOW_LEGACY) { console.error('deploy-guard FAIL: /api/drain 404——目标实例版本过旧（pre-Y0a-3）？确认后 --allow-legacy 显式跳过（默认拒：404 也可能是反代/路径配错，禁无鉴别绕过）'); return 1; }
    console.log('deploy-guard: --allow-legacy——旧版本跳过停写直接放行（非判据证据；post 段 epoch 断言 N/A——接管证明由 run#2 产出）'); return 0;
  }
  if (drainResp.status === 401 || drainResp.status === 403) {
    // J2：凭据无效=unobservable——--force 不覆盖（无账可算的放行=at-risk 语义谎言）；中止档不写 state
    console.error(`deploy-guard FAIL: drain ${drainResp.status}——令牌失配（unobservable 档，--force 不覆盖）。核对服务器 apps/api/.env 的 COLLAB_ADMIN_TOKEN 与本脚本读取路径一致`); return 1;
  }
  if (!drainResp.ok) { console.error(`deploy-guard FAIL: drain 响应 ${drainResp.status}`); return 1; }
  const drainAt = Date.now();
  const first = await getReady().catch(() => null);
  let epochRaw = first?.body?.epoch != null && Number.isFinite(Number(first.body.epoch)) ? Number(first.body.epoch) : 'unavailable';
  writeState({ epochRaw, drainAt, pendingBefore: first?.body?.pending ?? null });   // P39：轮询前先落基线
  const deadline = drainAt + PRE_BUDGET_MS;   // P40 固定 90s（≥退避梯 60s 封顶+余量）
  let last = null, verdict = { verdict: 'wait', why: '未采样' }, lastRenew = Date.now(), observed = false;
  while (Date.now() < deadline) {
    if (Date.now() - lastRenew > 20_000) {   // P40：drain 60s TTL 循环续期——预算与 TTL 解耦
      const r = await postDrain();
      // P49④：续期查 r.ok——401/403/500（令牌轮换/实例半死）不计已续期
      if (!r.unreachable && r.ok) lastRenew = Date.now();
      else if (!r.unreachable) console.error(`deploy-guard WARNING: drain 续期被拒 ${r.status}（60s 后自动解除——核对令牌/实例状态）`);
      // unreachable（进程已死）→ 保持轮询，decidePre 按 reason 分型处置
    }
    last = await getReady().catch(() => last);
    if (last?.body) { observed = true; verdict = decidePre(last.body); if (verdict.verdict !== 'wait') break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  // C5 基线收口：首采样抖动会把 'unavailable' 落盘而轮询正常 pre pass、post 对 'unavailable'+degraded=null 必 fail；
  // 放行路径（pass/force）以最后一次有效采样收口基线（wait/fail 中止路径无需——下次部署 pre 会覆写）
  const settleEpoch = () => {
    if (Number.isFinite(Number(last?.body?.epoch))) {
      epochRaw = Number(last.body.epoch);
      writeState({ epochRaw, drainAt, pendingBefore: first?.body?.pending ?? null });
    }
  };
  // B7：全程未取得 body=无账可算——unobservable（--force 不覆盖）
  if (!observed) verdict = { verdict: 'unobservable', why: '/api/ready 全程不可达（drain 已 200——反代/路径配错/实例 drain 中崩溃？）——无账可查；逃生阀=修 ready 可观测性（--force 不覆盖此档）' };
  console.log(JSON.stringify({ phase: 'pre', verdict: verdict.verdict, why: verdict.why, drainAt, budgetMs: PRE_BUDGET_MS, elapsedMs: Date.now() - t0, epochPre: epochRaw, totalPre: spoolTotal(first?.body?.pending), pendingBefore: first?.body?.pending ?? null, pendingAfter: last?.body?.pending ?? null }));
  if (verdict.verdict === 'pass') { settleEpoch(); return 0; }   // C5：放行点收口基线
  if (verdict.verdict !== 'unobservable' && FORCE) { console.log(`deploy-guard WARNING(--force): ${verdict.why}——强制放行，N batches at risk（真实逃生阀非日常；runbook §3 要求留部署记录）`); settleEpoch(); return 0; }
  console.error(`deploy-guard FAIL: ${verdict.why}——中止部署（逃生阀 --force 覆盖 fail/wait 两档；unobservable 不可 force；中止后 drain 将于 60s 自动解除〔SV12〕可安全重试）`);
  return 1;
}

async function postPhase() {
  if (!requireToken('post')) return 1;
  let st = null;
  try { st = JSON.parse(readFileSync(STATE, 'utf8')); } catch { st = null; }
  if (!st || st.v !== 1) { console.error('deploy-guard FAIL(post): 状态文件缺失/损坏/版本不符（pre 段未跑？重跑完整部署链；--rollback 需上次部署的 state 仍在——P39 不再删除）'); return 1; }
  // SHA 三态断言（v4.2/评五 P0-3）：state 无 sha fail / 未传 GIT_SHA fail / 不符 fail——禁双假短路
  if (!st.sha) { console.error('deploy-guard FAIL(post): state 无 sha（本地演练请带 GIT_SHA=… 跑 pre；生产路径缺失=SHA 断言失效）'); return 1; }
  if (!process.env.GIT_SHA) { console.error('deploy-guard FAIL(post): 未传 GIT_SHA——无法执行串档断言（cutover ①/rollback ⑤ 均注入）'); return 1; }
  if (st.sha !== process.env.GIT_SHA) {
    console.error(`deploy-guard FAIL(post): 陈旧状态文件（state.sha=${st.sha} ≠ GIT_SHA=${process.env.GIT_SHA}）——pre 每次覆写+本断言=防跨部署串档（P39）；重跑完整部署链`); return 1;
  }
  const epochPre = epochPreFromRaw(st.epochPre);   // 'unavailable'/null/损坏 → NaN → decidePost fail（B23）
  const degraded = st.degraded ?? null;
  const deadline = Date.now() + 120_000;   // O-1：收养 60s+reconciler 30s+回灌余量
  let last = null, verdict = { verdict: 'wait', why: '未采样' };
  while (Date.now() < deadline) {
    last = await getReady().catch(() => last);
    if (last?.body) { verdict = decidePost(last.body, epochPre, degraded); if (verdict.verdict !== 'wait') break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  // P39：不删状态文件——pre 覆写+SHA 断言防串档；--rollback（同 SHA 重启）复用本基线
  console.log(JSON.stringify({ phase: 'post', verdict: verdict.verdict, why: verdict.why, degraded, epochPre: st.epochPre, epochPost: last?.body?.epoch ?? null, totalPost: spoolTotal(last?.body?.pending), elapsedMs: Date.now() - t0 }));
  if (verdict.verdict === 'pass') return 0;
  console.error(`deploy-guard FAIL(post): ${verdict.why}——重启后未收敛，按 runbook §3 处置`);
  return 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = await (POST ? postPhase() : prePhase());
