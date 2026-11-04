// scripts/drill-fault.test.mjs —— Y1c T31 故障演练矩阵装置判据自测（node --test scripts/ 池消费）
// 红组先例=deploy-guard.test.mjs T30b 红①-红⑤：装置在档可 import+模式序固定+破坏性守卫+关键判据源文本锚。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRILL = path.join(ROOT, 'scripts', 'drill-fault.mjs');

test('T31 红①：演练装置在档可 import（scripts/drill-fault.mjs——故障矩阵的本地实弹装置，装置缺失=红）', async () => {
  const mod = await import(pathToFileURL(DRILL).href);
  assert.ok(Array.isArray(mod.FAULT_MODES) && mod.FAULT_MODES.length > 0, 'FAULT_MODES 导出（模式清单的机器承载）');
});

test('T31 红②：FAULT_MODES 七模式清单固定（plan :417 卡文形态族映射——乱序/缺模式=红：kill9 矩阵/基础设施三态/恢复三链/客户端形态/worker 崩溃）', async () => {
  const { FAULT_MODES } = await import(pathToFileURL(DRILL).href);
  assert.deepEqual(FAULT_MODES, [
    'kill9',          // kill -9 矩阵族：批提交窗+barrier flush 中 kill -9（spool/apply/快照/维护/毒帧阶段映射既有 t10-g2/t13/t27 int）
    'infra',          // PG failover+网络分区+磁盘满（容量闸 fail-closed）
    'restore-bump',   // pg_dump 恢复→bump historyId→旧 WAL 真段 quarantine 不复活（内容级——charter restore-drill 用例①）
    'restore-fence',  // 忘 bump+restore.lock marker→时间戳栅栏拦截（recoverySuspect 零重放 fail-closed→处置恢复——charter restore-drill 用例①副链）
    'pitr-ss2',       // 同代 PITR 恢复→客户端 SS2 旧内容被 historyId 握手拦截（charter restore-drill 用例②）
    'client',         // 拒帧 4411 恢复/vacuum 换代离线重连/世代切换旧连接+行级关闸/clientID 并发同键/双端断网重连（B3 族）
    'worker-crash',   // 外部生成成功后崩溃重试零重复副作用（text 链锚验收——X-Idempotency-Key 屏障+资金恰一次结算）
  ]);
});

test('T31 红③：装置破坏性守卫（--confirm 缺失=exit 非 0+refusal 文案+零副作用——drill-cutover/reset-collab 同律）', () => {
  const r = spawnSync(process.execPath, [DRILL, '--kill9'], { encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(r.status, 0, '--confirm 缺失必须 exit 非 0');
  assert.match((r.stdout ?? '') + (r.stderr ?? ''), /--confirm/);
});

test('T31 红④：kill9 模式源文本锚（PG 批滞留触发器=kill 窗确定性注入+重启回灌零丢零重复断言——collab-kill9-drill 触发器先例+G6a 判据）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /y31_drill_block/, '触发器滞留（CanvasDocUpdate INSERT 拒——PG 批提交窗 kill 的确定性形态）');
  assert.match(src, /重放.*⊇|replaySuperset|已接受集/, '重启回灌断言（已接受集 ⊇——G6a P1 主线验收判据）');
  assert.match(src, /零重复/, '零重复断言（updateHash 幂等——零重复 walSeq/PG 行）');
  assert.match(src, /sendStateless|committedSeq/, 'barrier flush 窗 kill 档（save barrier 重发→Durable 回执 committedSeq）');
});

test('T31 红⑤：restore 双链源文本锚（bump 正路真段不复活+忘 bump 时间戳栅栏拦截——spec §4.4 historyId 纪元栅栏/T13 K2/K4 实弹形态装置化）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /pg_restore/, 'pg_dump 恢复实弹（本仓备份方法论=pg_dump -Fc）');
  assert.match(src, /SystemHistory.*historyId\s*=\s*gen_random_uuid|bumpHistoryId/, 'bump historyId 单事务（restore 契约收尾）');
  assert.match(src, /restore\.lock/, 'restore.lock marker（备份工具写双保险——忘 bump 形态的栅栏求值信号）');
  assert.match(src, /recoverySuspect/, '时间戳栅栏拦截断言（recoverySuspect 零重放——非静默丢段）');
  assert.match(src, /不复活/, '旧 WAL 真段不复活内容级断言（恢复后 doc 无回滚内容）');
});

test('T31 红⑥：pitr-ss2 模式源文本锚（同代 PITR→旧 hid 客户端 SS2 拦截——onAuthenticate 先比 historyId 的服务端不复活面）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /hid=/, '客户端携旧 hid 重连（providerVersion h= 三元上行）');
  assert.match(src, /4406/, '版本门三元硬门 4406 close（historyId 不匹配档）');
  assert.match(src, /SS2/, 'SS2 旧内容拦截断言（连接死于握手→全量上行不到达服务端）');
});

test('T31 红⑦：infra 模式源文本锚（PG 服务 stop/start=本地 failover 形态+TCP proxy 分区+容量闸磁盘满 fail-closed）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /postgresql-x64-16|pg_ctl/, 'PG 服务形态（sc stop/start——真 failover 的本地等价，形态偏差登记面）');
  assert.match(src, /proxy|分区/, '网络分区 socket 层模拟（TCP proxy 挂起——本地无 iptable 形态）');
  assert.match(src, /COLLAB_SPOOL_CAPACITY_BYTES/, '磁盘满=spool 容量闸 fail-closed（seam 等价——真 ENOSPC 不可注入登记）');
});

test('T31 红⑧：worker-crash 模式源文本锚（外部生成成功后崩溃窗=stub 回调通知 kill+重试零重复副作用三断言——spec 偏离 36-④⑥ text 链锚）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /x-idempotency-key|X-Idempotency-Key/, 'write-ahead 幂等键断言（同 (intentRowId,execSeq) 键恒同）');
  assert.match(src, /reserve.*settle|台账/, '资金恰一次断言（reserve+settle 各恰一行——零重复副作用主判据）');
  assert.match(src, /taskkill|SIGKILL/, '崩溃窗注入（外部成功后本地提交前 kill——确定性窗=stub 收到请求即杀）');
});

test('T31 红⑨：client 模式源文本锚（拒帧 4411 恢复/vacuum 换代离线重连 auth 拒/行级关闸新执行被拒/clientID 并发同键）', async () => {
  const src = readFileSync(DRILL, 'utf8');
  assert.match(src, /4411/, '拒帧 4411（毒帧/DENY 恢复入口）');
  assert.match(src, /maintenance/, '维护换代/行级关闸（REQUESTED 写 maintenanceId 后新执行被拒）');
  assert.match(src, /generation|doc-vacuuming/, 'vacuum 换代离线重连（旧 #g=auth generation mismatch 不装载）');
  assert.match(src, /clientid|clientID/, 'clientID 并发同键（僵尸+新连接单活跃）');
});
// （红⑩ charter restore-drill 证据锚：随 commit③ 落 evidence 时同批加入——先红〔evidence 无装置引用〕后绿，
//   避免装置骨架期长期红灯挡 verify:fast。）
