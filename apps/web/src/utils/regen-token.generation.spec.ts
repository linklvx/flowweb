// apps/web/src/utils/regen-token.generation.spec.ts —— Y3 Task 4（plan 2026-11-19-y3-protocol-retirement
// 第一笔 v3.1 合同二）：regen-token 轮换代际三步契约测试。先红→绿。
// - rotateToken(pid,nid,execSeq)：同一 execSeq 只轮换一次（sessionStorage 记已轮换 execSeq）+
//   槽上 execSeq 比已轮换的更小则忽略；无 execSeq 调用形态（无行终态）维持今天行为（照常轮换）。
// - markGestureConsumed(pid,nid)：只在真正发出受理请求的那一次调用（渲染读 token 不算消费）。
// - 回滚三条件：当前槽非终态（非 done 且非 error∧rearmable===false）∧槽上 execSeq 更大∧
//   本轮换出 token 未被消费 → 恢复轮换前值（缺一不恢复）。
// 语义动机（plan）：两次同步间旧代 done 先应用已轮换 token、更高 execSeq loading 随后进槽——
// mergeSlot 保得住槽面撤不回轮换、这次点击仍持旧 token=服务端对不上原手势再开一笔扣费。
import { describe, it, expect, beforeEach } from 'vitest';
import { gestureToken, storedToken, rotateToken, markGestureConsumed, restoreRotatedToken } from './regen-token';

describe('Y3 Task4 v3.1 合同二：rotateToken 轮换代际（同 execSeq 只一次+更小忽略）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('同 execSeq 只轮换一次：rotateToken(pid,nid,seq) 两调（投影 useEffect 双触发形态）⇒ 持有 token 不被二次丢弃', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '7');
    expect(storedToken('p1', 'n1')).toBeNull();   // 首次轮换——丢弃持有
    // 轮换后新铸 token（用户点击新"重新生成"），投影 useEffect 因依赖未变再触发同 execSeq 轮换——
    // 不应二次丢弃新持有（同代只轮换一次）
    const t2 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '7');
    expect(storedToken('p1', 'n1')).toBe(t2);   // 同 execSeq 第二调忽略——新 token 存活
    expect(t2).not.toBe(t1);
  });

  it('槽上 execSeq 比已轮换的更小则忽略：rotate(seq=5) 后 rotate(seq=3)（旧代事件迟到）⇒ 新持有不被丢', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const t2 = gestureToken('p1', 'n1');   // 轮换后新铸
    rotateToken('p1', 'n1', '3');   // 更小（旧代 done 迟到）——忽略
    expect(storedToken('p1', 'n1')).toBe(t2);
  });

  it('更大的 execSeq 照常轮换（换代后新一代 done）：rotate(seq=5) 后 rotate(seq=9) ⇒ 丢弃', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const t2 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '9');   // 更大——新一代终态照常轮换
    expect(storedToken('p1', 'n1')).toBeNull();
    expect(t2).toBeTruthy();
  });

  it('无 execSeq 调用形态（无行终态 error∧rearmable===false 无 execSeq——INTENT_EXHAUSTED 同步 409 等旧路径）维持今天行为：照常轮换', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1');
    expect(storedToken('p1', 'n1')).toBeNull();   // 旧形态（两参）——无代际记录直接丢弃
    expect(t1).toBeTruthy();
  });

  it('代际记录标签隔离：p1:n1 轮换 seq=5 不影响 p1:n2 / p2:n1 的轮换资格', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const t = gestureToken('p1', 'n2');
    rotateToken('p1', 'n2', '3');   // n2 首次轮换（3<5 但 n2 无记录——正常轮换非忽略）
    expect(storedToken('p1', 'n2')).toBeNull();
    expect(t).toBeTruthy();
  });

  // ── Y3 清理批（Ruling 5——清标记语义归真轮换）：代际真变大的轮换清消费标记；更小/相等/两参不清 ──

  it('Ruling5：代际真变大的轮换清消费标记（轮换真正发生的那一次——新 token 新生命周期）', () => {
    gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBe('1');
    rotateToken('p1', 'n1', '9');   // 真轮换（9>无记录）——清消费标记
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBeNull();   // 红：现不清
    // 换代后的第二次真轮换同判（12>9 也清——每次真轮换都清）
    const t2 = gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');
    rotateToken('p1', 'n1', '12');   // 真轮换（12>9）——清
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBeNull();
    expect(t2).toBeTruthy();
  });

  it('Ruling5：更小/相等走提前返回不清消费标记也不丢持有；两参 409 维持今天行为（不进代际窗口、不清标记）', () => {
    // 更小：旧代 done 迟到——提前返回
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const t2 = gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');
    rotateToken('p1', 'n1', '3');   // 更小——忽略
    expect(storedToken('p1', 'n1')).toBe(t2);   // 持有不丢
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBe('1');   // 标记不清
    // 相等：同代已轮换——提前返回
    rotateToken('p1', 'n1', '5');   // 相等——忽略
    expect(storedToken('p1', 'n1')).toBe(t2);
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBe('1');
    // 两参 409（INTENT_EXHAUSTED 同步路径）：照常轮换但不清标记
    markGestureConsumed('p1', 'n1');   // 消费标记已在案（上档保留）
    sessionStorage.removeItem('flowweb:regen-seq:p1:n1');   // 两参不写代际窗口——清记录还原两参前置态
    rotateToken('p1', 'n1');   // 两参——无代际记录
    expect(storedToken('p1', 'n1')).toBeNull();   // 照常轮换丢弃
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBe('1');   // 两参不清标记（维持今天行为）
  });
});

describe('Y3 Task4 v3.1 合同二：markGestureConsumed 消费语义（真发受理请求的那一次）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('未 markGestureConsumed ⇒ 未消费（渲染读 token 不算消费——storedToken 零副作用）', () => {
    const t = gestureToken('p1', 'n1');
    expect(storedToken('p1', 'n1')).toBe(t);   // 渲染读——零消费标记
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBeNull();
  });

  it('markGestureConsumed(pid,nid) ⇒ 当前持有被标记已消费；无持有为 no-op（受理请求发出后调）', () => {
    gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBe('1');
    // 无持有——no-op 不留标记
    markGestureConsumed('p1', 'nX');
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:nX')).toBeNull();
  });

  it('gestureToken 再铸清消费标记（新 token 新生命周期）', () => {
    gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');
    gestureToken('p1', 'n1');   // 再铸——新 token 生命周期开始
    expect(sessionStorage.getItem('flowweb:regen-consumed:p1:n1')).toBeNull();
  });
});

describe('Y3 Task4 v3.1 合同二：restoreRotatedToken 回滚三条件（全中才恢复轮换前值）', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('三条件全中：非终态（loading）∧槽 execSeq 更大∧未消费 ⇒ 恢复轮换前值', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');   // 旧代 done 先应用——轮换（撤不回的窗口起点）
    expect(storedToken('p1', 'n1')).toBeNull();
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'loading', execSeq: '9',   // 槽非终态+execSeq 更大（9>5）
      tokenConsumed: false,
    });
    expect(restored).toBe(true);
    expect(storedToken('p1', 'n1')).toBe(t1);   // 旧 token 回持——服务端对得上原手势
  });

  it('条件一不中（槽已终态 done）⇒ 不恢复', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'done', execSeq: '9',
      tokenConsumed: false,
    });
    expect(restored).toBe(false);
    expect(storedToken('p1', 'n1')).toBeNull();
    expect(t1).toBeTruthy();
  });

  it('条件一不中（error∧rearmable===false 终态）⇒ 不恢复', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'error', rearmable: false, execSeq: '9',
      tokenConsumed: false,
    });
    expect(restored).toBe(false);
    expect(storedToken('p1', 'n1')).toBeNull();
  });

  it('条件一不中（error 可 rearm——非终态判据按 error∧rearmable===false）⇒ 恢复（rearmable true=可重试非终态）', () => {
    const t1 = gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'error', rearmable: true, execSeq: '9',
      tokenConsumed: false,
    });
    expect(restored).toBe(true);
    expect(storedToken('p1', 'n1')).toBe(t1);
  });

  it('条件二不中（槽 execSeq 不大于已轮换值——相等/更小/槽缺 execSeq）⇒ 不恢复', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    expect(restoreRotatedToken('p1', 'n1', { status: 'loading', execSeq: '5', tokenConsumed: false })).toBe(false);   // 相等
    expect(restoreRotatedToken('p1', 'n1', { status: 'loading', execSeq: '3', tokenConsumed: false })).toBe(false);   // 更小
    expect(restoreRotatedToken('p1', 'n1', { status: 'loading', tokenConsumed: false })).toBe(false);   // 槽缺 execSeq
    expect(storedToken('p1', 'n1')).toBeNull();
  });

  it('条件三不中（本轮换出 token 已被消费——真发过受理请求）⇒ 不恢复', () => {
    gestureToken('p1', 'n1');
    markGestureConsumed('p1', 'n1');   // 真发过受理请求
    rotateToken('p1', 'n1', '5');
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'loading', execSeq: '9',
      tokenConsumed: true,
    });
    expect(restored).toBe(false);
    expect(storedToken('p1', 'n1')).toBeNull();
  });

  it('未轮换过（无代际记录）⇒ 不恢复（回滚只针对本轮轮换窗口）', () => {
    const t1 = gestureToken('p1', 'n1');
    const restored = restoreRotatedToken('p1', 'n1', {
      status: 'loading', execSeq: '9',
      tokenConsumed: false,
    });
    expect(restored).toBe(false);
    expect(storedToken('p1', 'n1')).toBe(t1);   // 原持有不动
  });

  it('恢复后清除轮换窗口记录（同 execSeq 不再二次回滚）', () => {
    gestureToken('p1', 'n1');
    rotateToken('p1', 'n1', '5');
    expect(restoreRotatedToken('p1', 'n1', { status: 'loading', execSeq: '9', tokenConsumed: false })).toBe(true);
    // 二次回滚同条件——窗口已清（无已轮换记录）不恢复
    expect(restoreRotatedToken('p1', 'n1', { status: 'loading', execSeq: '9', tokenConsumed: false })).toBe(false);
  });
});
