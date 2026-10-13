// apps/api/scripts/exec-smoke.mjs —— Y0b-5 T17：exec-smoke 资金链冒烟（deploy post 链——collab-smoke 之后）
// 运行（服务器）：cd ~/flowweb && pnpm --filter @flowweb/api exec node scripts/exec-smoke.mjs
// 运行（本地）  ：同命令（dev api 3000 / WS 3001 在跑——HTTP/WS 打真实服务；Prisma 只做 fixture/断言/清理）。
// 形态：collab-smoke 同族（node 直跑零 tsx+dotenv 自加载+ws 包注入 header+csv=2 版本门）。
//
// ── 哨兵形态 A（执行期回改——plan 冻结版"实现期发现计划与代码不符时回改"条款的适用）──
// plan 裁定 13/20 原定 provider='smoke'（∉ADAPTERS ⇒ public 选择器过滤=用户不可见）。谓词核对结论：
//   ① validation.service.ts:48-57 预检在 claim 之前——executable = active ∧ provider∈ADAPTERS ∧
//      apiModelName 非空；provider='smoke' ⇒ MODEL_NOT_AVAILABLE 请求级失败 ⇒ 零 claim/零 intent 行，
//      正例两环（ECONNREFUSED/stub settle）根本不可达——"零可见"的手段直接杀死了"可走"的意图。
//   ② 公开选择器 public.service.ts:14-28 按 NodeType.key 精确查询（'text' 等已知 key）——哨兵
//      NodeType 行（key='smoke:y0b5:text'）永不被用户面查询 = 零可见；定价 resolve 自 AIModel 行派生
//      nodeTypeId（pricing-resolver.service.ts:28-33），不与真实 'text' 键交叉校验。
//   ③ claim 侧不查 executable 谓词（generation-intent.service claim 只看 idemKey/teamId/定价快照）；
//      api-caller assertDispatch（:187-206）adapterFor('moonshot')=openai-chat ⇒ text 链可走；
//      apiKey 空 ⇒ PROVIDER_API_KEY_MISSING 503 在 fetch 前（:199-205）——故 apiKey='smoke-dummy' 非空。
//   ⇒ 回改：provider='moonshot'（真 adapter slug）+ 哨兵 NodeType 行隔离用户面——意图（不可见+可走+
//      零外呼）全保。禁走图片编辑链（dashscope 硬编码会真外呼）——text 链唯一。
//
// ── modelCache 规避（api-caller.service.ts:103-104，5min TTL 模块级）──
// 固定模型 id 注册后删除会被缓存行放行（缓存击穿）；本脚本所有 AIModel id 带 per-run ts 后缀；
// 负例 ghost id = 从未注册过的名字（禁复用刚删哨兵名——同理）。
//
// ── 四阶段 ──
// ① 哨兵建立：幂等预扫清 smoke:y0b5:* 遗留 → fixture（user/team/member/project/session/TeamBalance 10 积分）
//    + NodeType（key=smoke:y0b5:text）+ 三 AIModel（econn=apiUrl http://127.0.0.1:1 / ok / fail=本地 stub
//    端口；全部 provider='moonshot'+apiKey='smoke-dummy'）+ PricingRule（econn creditCost:0、ok/fail
//    creditCost:1）+ WS provider 播种 4 个 textInput 节点（econn/ok/fail/ghost 各 data.model=对应 id）。
// ② 正例双环：
//    环1 econn（cost:0）：ECONNREFUSED→error→intent 终态 FAILED+台账零行+balanceDelta 0+reservedCredits 0。
//    环2a ok（cost:1+stub 200）：true settle 全链——reserve(-1,+1)+settle(0,-1,reversesId 配对) 行形态
//      +intent SUCCEEDED/creditsConsumed=1+TeamBalance credits -1。
//    环2b fail（cost:1+stub 5xx）：失败退款环——reserve+release(+1,-1,reversesId) 冻结释放归零
//      +intent FAILED+余额复原；stub 恰收 2 请求（Authorization=Bearer smoke-dummy——行级密钥路径自证）。
// ③ 负例：ghost modelId → HTTP 2xx + body.success=false + MODEL_NOT_AVAILABLE 形态（validation 预检
//    请求级返回体非 4xx——plan"4xx"不精确，按实测响应形态断言）+ 零 intent 行 + 零外呼（stub 计数不变）。
// ④ finally 清理：模型+规则+NodeType+项目+intent+TeamBalance/Transaction 哨兵行全删（幂等谓词同预扫）
//    + 残留计数断言全 0——清理失败=fail deploy。text 链零产物文件（nodeClaimPack text 分支无 fileId/
//    downloadMime ⇒ ai-result-download 不入队、无 Media/MinIO 落物）——plan 清单"产物文件"项 N/A。
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });   // apps/api/.env——collab-smoke 同序同 path；不覆盖已设 env
const here = fileURLToPath(import.meta.url);
const req = createRequire(here);
const { PrismaClient } = req('@prisma/client');
const { CreditLedgerService } = req('../dist/modules/team/credit-ledger.service.js');   // dist=部署产物（collab-smoke 读 dist repo 同惯例）——余额播种经台账唯一写入口（DB 触发器 ledger_guard 拦裸 teamBalance 写）
const WebSocket = req('ws');
// yjs/provider 走 await import（全 mjs 与 doc 同侧——yjs#438 混合格式规避，collab-smoke 同注）
const Y = await import('yjs');
const { HocuspocusProvider } = await import('@hocuspocus/provider');

const API = process.env.COLLAB_API_URL ?? 'http://127.0.0.1:3000';
const WS_URL = process.env.COLLAB_WS_URL ?? 'ws://127.0.0.1:3001';
const P = 'smoke-y0b5-';                 // 哨兵 id 前缀（与 collab-smoke 的 smoke-* 命名空间隔离）
const NT_KEY = 'smoke:y0b5:text';        // 哨兵 NodeType key（用户面选择器按已知 key 查询——永不被查）
const CSV = 2;                           // CLIENT_PROTOCOL_VERSION（mjs 无 import shared 先例——字面量+bump 时随改，collab-smoke 同注）
const SEED_CREDITS = 10;
const ts = Date.now();
const S = {
  user: `${P}u-${ts}`, team: `${P}t-${ts}`, member: `${P}m-${ts}`, project: `${P}p-${ts}`,
  session: `${P}s-${ts}`, token: `${P}tok-${randomUUID()}`,
  nt: `${P}nt-${ts}`,
  mEconn: `${P}m-econn-${ts}`, mOk: `${P}m-ok-${ts}`, mFail: `${P}m-fail-${ts}`,
  rEconn: `${P}r-econn-${ts}`, rOk: `${P}r-ok-${ts}`, rFail: `${P}r-fail-${ts}`,
  ghost: `${P}ghost-${ts}-${randomUUID().slice(0, 8)}`,   // 从未注册（负例——禁复用刚删哨兵名）
  nEconn: 'smoke-node-econn', nOk: 'smoke-node-ok', nFail: 'smoke-node-fail', nGhost: 'smoke-node-ghost',
};

function fail(msg) { throw new Error(`EXEC-SMOKE FAIL: ${msg}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step0_readyAssert() {
  const r = await fetch(`${API}/api/ready`, { signal: AbortSignal.timeout(10_000) }).then((x) => x.json()).catch(() => null);
  if (r === null) throw new Error('前置断言失败：/api/ready 不可达（fetch 失败）——API 未启动/端口不对，先起服务再冒烟');
  if (!r.ready) throw new Error(`前置断言失败：ready=${r.ready} reason=${r.reason}——非服务态下执行链会被 503 拦，先查 ready 再冒烟`);
}

// —— 本地 stub server（裁定 23⑯：spec §5.10 否决理由针对进程内 fake，不适用 HTTP stub——零外呼走完 true settle/退款两环） ——
// apiModelName 路由：ok 行的 provider 侧模型名 → 200 openai-chat 形态；fail 行 → 500。
async function startStub() {
  const received = [];   // {model, authorization}——外呼计数/密钥路径断言面
  const srv = createServer((rq, rs) => {
    const chunks = [];
    rq.on('data', (c) => chunks.push(c));
    rq.on('end', () => {
      let model = '';
      try { model = JSON.parse(Buffer.concat(chunks).toString('utf8')).model ?? ''; } catch { /* 保持空 */ }
      received.push({ model, authorization: rq.headers.authorization ?? '' });
      if (String(model).startsWith(`smoke-ok-${ts}`)) {
        rs.writeHead(200, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ choices: [{ message: { content: `smoke-ok-${ts}` } }] }));
      } else {
        rs.writeHead(500, { 'content-type': 'application/json' });
        rs.end(JSON.stringify({ error: 'smoke stub intentional 5xx' }));
      }
    });
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  return { port, received, close: () => new Promise((res) => srv.close(res)) };
}

// —— ① 幂等预扫/④ finally 清理共用的单源 purge（谓词=前缀；nodeType 按 key 前缀 Cascade 清 AIModel/PricingRule） ——
// 台账/钱包写（TeamCreditTransaction 直删 + team 级联删 TeamBalance 的行级触发器）须带 ledger_guard
// 通行证——ledger.runInTx（SET LOCAL app.ledger_tx）内执行，deleteTeamsWithPass 同款（Z116）。
async function purgeSentinels(prisma, ledger) {
  const out = {};
  out.intent = await prisma.generationIntent.deleteMany({ where: { teamId: { startsWith: P } } });   // 无 FK 纯列——显式删
  out.session = await prisma.session.deleteMany({ where: { userId: { startsWith: P } } });
  out.member = await prisma.teamMember.deleteMany({ where: { teamId: { startsWith: P } } });
  out.project = await prisma.canvasProject.deleteMany({ where: { id: { startsWith: P } } });         // Cascade 清 CanvasDoc/Update
  out.ledger = await ledger.runInTx(async (tx) => {
    const t = await tx.teamCreditTransaction.deleteMany({ where: { teamId: { startsWith: P } } });   // 无 FK 纯列——显式删
    const b = await tx.team.deleteMany({ where: { id: { startsWith: P } } });                        // Cascade 清 TeamBalance（通行证内过触发器）
    void b;
    return t;
  });
  out.user = await prisma.user.deleteMany({ where: { id: { startsWith: P } } });                     // Cascade 清残留 Session
  out.nodeType = await prisma.nodeType.deleteMany({ where: { key: { startsWith: 'smoke:y0b5:' } } }); // Cascade 清哨兵 AIModel/PricingRule
  return { counts: out, total: Object.values(out).reduce((s, r) => s + r.count, 0) };
}

// —— ④ 残留断言：清理后 smoke:y0b5:* 全表计数必须为 0（canvasDoc/Update 顺带盯孤儿 flush 行）——
async function assertResidualZero(prisma) {
  const pairs = [
    ['nodeType', await prisma.nodeType.count({ where: { key: { startsWith: 'smoke:y0b5:' } } })],
    ['aIModel', await prisma.aIModel.count({ where: { id: { startsWith: P } } })],
    ['pricingRule', await prisma.pricingRule.count({ where: { id: { startsWith: P } } })],
    ['canvasProject', await prisma.canvasProject.count({ where: { id: { startsWith: P } } })],
    ['canvasDoc', await prisma.canvasDoc.count({ where: { projectId: { startsWith: P } } })],
    ['canvasDocUpdate', await prisma.canvasDocUpdate.count({ where: { projectId: { startsWith: P } } })],   // CanvasDocUpdate 直挂 projectId（docId=projectId）——孤儿 flush 行显式盯
    ['generationIntent', await prisma.generationIntent.count({ where: { teamId: { startsWith: P } } })],
    ['teamCreditTransaction', await prisma.teamCreditTransaction.count({ where: { teamId: { startsWith: P } } })],
    ['teamBalance', await prisma.teamBalance.count({ where: { teamId: { startsWith: P } } })],
    ['team', await prisma.team.count({ where: { id: { startsWith: P } } })],
    ['user', await prisma.user.count({ where: { id: { startsWith: P } } })],
  ];
  const left = pairs.filter(([, n]) => n > 0);
  if (left.length > 0) fail(`清理后残留非 0（fail deploy）：${left.map(([k, n]) => `${k}=${n}`).join(', ')}`);
}

// —— WS 播种装置（collab-smoke 同族：cookie+Origin header+csv 版本门；doc 保持在连=执行活读零装载） ——
const WS_ORIGIN = process.env.COLLAB_ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:5173').origin;   // gateway allowedOrigins() 同源推导
function makeHeaderWs(headers) {
  return class HeaderWs extends WebSocket {
    constructor(url) { super(url, { headers }); }
  };
}
async function connectAndSeed() {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `${WS_URL}?csv=${CSV}&cb=exec-smoke`, name: `project:${S.project}`, document: doc,
    WebSocketPolyfill: makeHeaderWs({ origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` }),
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => { provider.destroy(); rej(new Error('provider synced 超时 10s——3001 未监听/鉴权拒/装载失败')); }, 10_000);   // 先 destroy 再 rej——Hocuspocus v4 重连定时器不拆会让事件循环不死（deploy ssh 无限挂起）
    provider.on('synced', () => { clearTimeout(t); res(); });
  });
  // 4 个 textInput 节点（shape 对齐 shared fillDoc：type+data.model；无 edges ⇒ 单节点 scope 无上游）
  doc.transact(() => {
    const mk = (nodeId, model) => {
      const data = new Y.Map();
      data.set('model', model);
      data.set('content', `exec-smoke ${nodeId}`);
      const m = new Y.Map();
      m.set('type', 'textInput');
      m.set('data', data);
      doc.getMap('nodes').set(nodeId, m);
    };
    mk(S.nEconn, S.mEconn); mk(S.nOk, S.mOk); mk(S.nFail, S.mFail); mk(S.nGhost, S.ghost);
  });
  await sleep(1_500);   // 客户端 update → 服务端落地窗（SV 门失败自动重试兜底）
  return provider;
}

// —— 执行调用（TransformInterceptor 信封 {code:0,data}；SYNC_PENDING=客户端 update 未达服务端——重试） ——
async function executeNode(nodeId, provider) {
  const sv = Buffer.from(Y.encodeStateVector(provider.document)).toString('base64');
  for (let i = 0; i < 5; i++) {
    let res;
    try {
      res = await fetch(`${API}/api/execution/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: WS_ORIGIN, cookie: `flowweb.session_token=${S.token}` },
        body: JSON.stringify({ projectId: S.project, nodeId, stateVector: sv }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      fail(`execute(${nodeId}) API 不可达（dev watch 重启窗/未启动——fail deploy）: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 409) { await sleep(500); continue; }   // SYNC_PENDING——服务端 SV 尚未覆盖客户端（写后落地窗）
    if (!(res.status >= 200 && res.status < 300)) fail(`execute(${nodeId}) HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    const j = await res.json();
    return j?.data ?? j;
  }
  return fail(`execute(${nodeId}) 重试 5 次仍 SYNC_PENDING`);
}

// —— 台账行形态断言（§1.4bis 两列真值：reserve=(-c,+c) / settle=(0,-c,配对) / release=(+c,-c,配对)） ——
async function ledgerOf(prisma, intentRowId) {
  return prisma.teamCreditTransaction.findMany({
    where: { referenceId: `intent:${intentRowId}` },
    orderBy: { seq: 'asc' },
    select: { id: true, type: true, balanceDelta: true, frozenDelta: true, reversesId: true },
  });
}

async function main() {
  await step0_readyAssert();
  const prisma = new PrismaClient();
  const ledger = new CreditLedgerService(prisma);   // 播种/清理共用的台账写入口实例
  const stub = await startStub();
  let provider = null;
  try {
    // ── ① 哨兵建立（幂等预扫 → fixture → NodeType/模型/规则 → WS 播种） ──
    const pre = await purgeSentinels(prisma, ledger);
    if (pre.total > 0) console.log(`幂等预扫：清出上次运行遗留 ${pre.total} 行（smoke:y0b5:*——崩溃残留不永久污染）`);
    await prisma.user.create({ data: { id: S.user, name: `smoke-y0b5-${ts}`, email: `smoke-y0b5-${ts}@example.invalid`, emailVerified: false } });
    await prisma.team.create({ data: { id: S.team, name: `smoke-y0b5-${ts}`, ownerId: S.user } });
    await prisma.teamMember.create({ data: { id: S.member, teamId: S.team, userId: S.user, role: 'MEMBER' } });   // MEMBER=编辑级（仅 PROJECT_VIEWER 只读）
    await prisma.canvasProject.create({ data: { id: S.project, name: `smoke-y0b5-${ts}`, teamId: S.team } });
    await prisma.session.create({ data: { id: S.session, userId: S.user, token: S.token, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    // 余额播种经台账唯一写入口（ensureBalance+register_grant——seed.ts:185 同款；裸 teamBalance.create 被
    // ledger_guard 触发器拦且无流水=不变量①训练样本）。播种自体产 1 行 register_grant——资金断言按
    // referenceId='intent:*' 域计（与播种行隔离）。
    await ledger.runInTx(async (tx) => {
      await ledger.ensureBalance(tx, S.team);
      await ledger.mutate(tx, {
        teamId: S.team, operatorUserId: S.user, type: 'register_grant', creditType: 'regular',
        balanceDelta: SEED_CREDITS, frozenDelta: 0, referenceId: `register:${S.team}`,
      });
    });
    await prisma.nodeType.create({ data: { id: S.nt, key: NT_KEY, name: `smoke-y0b5 哨兵（用户面不可见）${ts}` } });
    const mkModel = (id, apiUrl, apiModelName) => prisma.aIModel.create({
      data: { id, nodeTypeId: S.nt, name: `smoke-y0b5 ${id}`, provider: 'moonshot', apiUrl, apiKey: 'smoke-dummy', apiModelName, active: true },
    });
    await mkModel(S.mEconn, 'http://127.0.0.1:1', `smoke-econn-${ts}`);           // 毫秒级 ECONNREFUSED——零外呼
    await mkModel(S.mOk, `http://127.0.0.1:${stub.port}`, `smoke-ok-${ts}`);      // stub 200——true settle 环
    await mkModel(S.mFail, `http://127.0.0.1:${stub.port}`, `smoke-fail-${ts}`);  // stub 5xx——退款环
    await prisma.pricingRule.create({ data: { id: S.rEconn, nodeTypeId: S.nt, modelId: S.mEconn, creditCost: 0, active: true } });
    await prisma.pricingRule.create({ data: { id: S.rOk, nodeTypeId: S.nt, modelId: S.mOk, creditCost: 1, active: true } });
    await prisma.pricingRule.create({ data: { id: S.rFail, nodeTypeId: S.nt, modelId: S.mFail, creditCost: 1, active: true } });
    provider = await connectAndSeed();

    // 用户面零可见实证：公开选择器（按已知 key 'text' 查询）不含哨兵模型
    const pub = await fetch(`${API}/api/node-types/text/models`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    const pubModels = Array.isArray(pub) ? pub : (pub?.data ?? []);
    const leaked = pubModels.filter((m) => [S.mEconn, S.mOk, S.mFail].includes(m.id));
    if (leaked.length > 0) fail(`公开选择器泄漏哨兵模型：${leaked.map((m) => m.id).join(',')}`);

    // ── ② 环1：ECONNREFUSED（cost:0——零冻结零流水真值表档） ──
    const r1 = await executeNode(S.nEconn, provider);
    if (r1.success !== false) fail(`环1 应失败：${JSON.stringify(r1.errors ?? r1)}`);
    if (r1.errors?.[0]?.errorCode !== 'EXECUTION_FAILED') fail(`环1 errorCode 应为 EXECUTION_FAILED（传输失败降级档）：${JSON.stringify(r1.errors?.[0])}`);
    const i1 = await prisma.generationIntent.findFirst({ where: { projectId: S.project, nodeId: S.nEconn } });
    if (!i1) fail('环1 零 intent 行（claim 应建行——cost:0 也建）');
    if (i1.status !== 'FAILED' || i1.creditCost !== 0 || i1.reservedCredits !== 0 || i1.creditsConsumed !== 0)
      fail(`环1 intent 形态异常：status=${i1.status} creditCost=${i1.creditCost} reserved=${i1.reservedCredits} consumed=${i1.creditsConsumed}`);
    if (i1.pricingRuleId !== S.rEconn) fail(`环1 定价快照漂移：pricingRuleId=${i1.pricingRuleId}`);
    const ledger1 = await prisma.teamCreditTransaction.count({ where: { teamId: S.team, referenceId: { startsWith: 'intent:' } } });
    if (ledger1 !== 0) fail(`环1 台账应零行（creditCost:0 不产资金行——两列真值表口径），实得 ${ledger1}`);
    const bal1 = await prisma.teamBalance.findUnique({ where: { teamId: S.team } });
    if (bal1.credits !== SEED_CREDITS) fail(`环1 余额应不动：${bal1.credits}`);

    // ── ② 环2a：stub 200（cost:1——true settle 全链） ──
    const r2 = await executeNode(S.nOk, provider);
    if (r2.success !== true) fail(`环2a 应成功：${JSON.stringify(r2.errors ?? r2)}`);
    if (r2.results?.[0]?.content !== `smoke-ok-${ts}`) fail(`环2a 产物内容异常：${JSON.stringify(r2.results?.[0])}`);
    if (r2.totalCost !== 1) fail(`环2a totalCost 应 1（实扣真值）：${r2.totalCost}`);
    const i2 = await prisma.generationIntent.findFirst({ where: { projectId: S.project, nodeId: S.nOk } });
    if (!i2 || i2.status !== 'SUCCEEDED' || i2.creditCost !== 1 || i2.reservedCredits !== 0 || i2.creditsConsumed !== 1)
      fail(`环2a intent 形态异常：${i2 ? `status=${i2.status} reserved=${i2.reservedCredits} consumed=${i2.creditsConsumed}` : '零行'}`);
    const l2 = await ledgerOf(prisma, i2.id);
    if (l2.length !== 2) fail(`环2a 台账应恰 2 行（reserve+settle），实得 ${l2.length}`);
    if (l2[0].type !== 'reserve' || l2[0].balanceDelta !== -1 || l2[0].frozenDelta !== 1 || l2[0].reversesId !== null)
      fail(`环2a reserve 行形态异常：${JSON.stringify(l2[0])}`);
    if (l2[1].type !== 'settle' || l2[1].balanceDelta !== 0 || l2[1].frozenDelta !== -1 || l2[1].reversesId !== l2[0].id)
      fail(`环2a settle 行形态/配对异常：${JSON.stringify(l2[1])}`);
    const bal2 = await prisma.teamBalance.findUnique({ where: { teamId: S.team } });
    if (bal2.credits !== SEED_CREDITS - 1) fail(`环2a 余额应 ${SEED_CREDITS - 1}：${bal2.credits}`);

    // ── ② 环2b：stub 5xx（cost:1——失败退款环，冻结释放归零） ──
    const r3 = await executeNode(S.nFail, provider);
    if (r3.success !== false) fail(`环2b 应失败：${JSON.stringify(r3.errors ?? r3)}`);
    const i3 = await prisma.generationIntent.findFirst({ where: { projectId: S.project, nodeId: S.nFail } });
    if (!i3 || i3.status !== 'FAILED' || i3.reservedCredits !== 0 || i3.creditsConsumed !== 0)
      fail(`环2b intent 形态异常（终态 FAILED+冻结释放归零）：${i3 ? `status=${i3.status} reserved=${i3.reservedCredits} consumed=${i3.creditsConsumed}` : '零行'}`);
    const l3 = await ledgerOf(prisma, i3.id);
    if (l3.length !== 2) fail(`环2b 台账应恰 2 行（reserve+release），实得 ${l3.length}`);
    if (l3[0].type !== 'reserve' || l3[0].balanceDelta !== -1 || l3[0].frozenDelta !== 1) fail(`环2b reserve 行形态异常：${JSON.stringify(l3[0])}`);
    if (l3[1].type !== 'release' || l3[1].balanceDelta !== 1 || l3[1].frozenDelta !== -1 || l3[1].reversesId !== l3[0].id)
      fail(`环2b release 行形态/配对异常：${JSON.stringify(l3[1])}`);
    const bal3 = await prisma.teamBalance.findUnique({ where: { teamId: S.team } });
    if (bal3.credits !== SEED_CREDITS - 1) fail(`环2b 余额应复原为 ${SEED_CREDITS - 1}：${bal3.credits}`);
    // stub 收面自证：恰 2 请求（环2a+环2b）+行级密钥路径（Bearer smoke-dummy=AIModel.apiKey 非 env seed）
    if (stub.received.length !== 2) fail(`stub 应恰收 2 请求（econn=拒连/ghost=预检拦——均零外呼），实得 ${stub.received.length}: ${JSON.stringify(stub.received)}`);
    for (const q of stub.received) if (q.authorization !== 'Bearer smoke-dummy') fail(`stub 收到非行级密钥请求：${JSON.stringify(q)}`);

    // ── ③ 负例：从未注册 modelId（validation 预检请求级失败——按实测形态断言：2xx+success:false 非 HTTP 4xx） ──
    const stubBefore = stub.received.length;
    const r4 = await executeNode(S.nGhost, provider);
    if (r4.success !== false) fail(`负例应 success:false：${JSON.stringify(r4)}`);
    if (!String(r4.errors?.[0]?.error ?? '').includes('MODEL_NOT_AVAILABLE')) fail(`负例错误形态应含 MODEL_NOT_AVAILABLE：${JSON.stringify(r4.errors?.[0])}`);
    const i4 = await prisma.generationIntent.count({ where: { projectId: S.project, nodeId: S.nGhost } });
    if (i4 !== 0) fail(`负例应零 intent 行（预检在 claim 前），实得 ${i4}`);
    if (stub.received.length !== stubBefore) fail(`负例应零外呼（stub 计数 ${stub.received.length}≠${stubBefore}）`);

    // 全环台账终账（intent 域）：环1 零行+环2a 2 行+环2b 2 行 = 4（register_grant 播种行不计）
    const ledgerFinal = await prisma.teamCreditTransaction.count({ where: { teamId: S.team, referenceId: { startsWith: 'intent:' } } });
    if (ledgerFinal !== 4) fail(`全环台账终账应 4 行，实得 ${ledgerFinal}`);
    console.log(JSON.stringify({
      smoke: 'OK', project: S.project, ledgerRows: ledgerFinal,
      chain: '哨兵(provider=moonshot+NodeType smoke:y0b5:text 零可见)→环1 ECONNREFUSED 零扣费→环2a stub200 settle 全链→环2b stub5xx 退款归零→负例 MODEL_NOT_AVAILABLE 零 intent→清理残留 0',
    }));
  } finally {
    // ── ④ finally 级清理（失败=fail deploy）：先拆 WS（doc 卸载 flush 不复活已删行）再 purge+残留断言 ──
    if (provider) { try { provider.destroy(); } catch { /* 已闭——同步 void，collab-smoke B4 */ } }
    await sleep(1_500);   // 服务端卸载 flush 窗（收尾写落 PG 后再删——防孤儿 CanvasDoc 复活）
    try {
      await purgeSentinels(prisma, ledger);
      await assertResidualZero(prisma);
    } catch (e) {
      console.error(`EXEC-SMOKE CLEANUP FAIL（fail deploy）: ${e instanceof Error ? e.message : e}`);
      process.exitCode = 1;
    }
    await stub.close();
    await prisma.$disconnect();
  }
}

void main().catch((e) => { console.error(`smoke FAIL: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; });
