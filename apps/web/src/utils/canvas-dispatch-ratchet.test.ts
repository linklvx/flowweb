import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

function findRepoRoot(start: string): string {
  let cur = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(cur, 'pnpm-workspace.yaml'))) return cur;
    cur = path.dirname(cur);
  }
  throw new Error('repo root not found');
}
const STORE = path.join(findRepoRoot(process.cwd()), 'apps/web/src/stores/canvasStore.ts');
const INTENTS = path.join(findRepoRoot(process.cwd()), 'apps/web/src/stores/canvasIntents.ts');

// 棘轮契约（R2d-8 Step 4c）：14 既有冻结 + runCommand 白名单 1，新增命令一律经 runCommand（双轨制防漂移）。
// 基线由 grep 实证核定：canvasStore.ts 恰 15 个调用点=14 既有直连 + 1 runCommand finally 收尾；
// 立项预估 16+1 与实证不符——批4b-2 换芯已把多处 capture/diff 合并为单 transact 调用，故以实证 14 为冻结基线。
const BASELINE = 14;

// 调用行判定：行内含 `dispatchProjectionDiff(` 且非注释行（import 行名后无左括号不命中；注释行 trim 后 // 开头）
function callLines(src: string): string[] {
  return src.split('\n').filter((l) => l.includes('dispatchProjectionDiff(') && !l.trim().startsWith('//'));
}

// runCommand 实现块提取（照 group-frame-writer-guard 先例：锚 `  runCommand:.*=> {` 实现行，至下一两空格声明行；
// \s*$ 容 CRLF）
function runCommandBlock(src: string): string[] {
  const lines = src.split('\n');
  const block: string[] = [];
  let inBlock = false;
  const declRe = /^  ([a-zA-Z]+):/;
  for (const line of lines) {
    if (/^  runCommand:.*=> \{\s*$/.test(line)) { inBlock = true; continue; }
    if (inBlock && declRe.test(line)) break;
    if (inBlock) block.push(line);
  }
  return block;
}

describe('dispatchProjectionDiff 写路径棘轮门禁（R2d-8 Step 4c——14 既有冻结+runCommand 白名单 1，新增命令一律经 runCommand，双轨制防漂移）', () => {
  it('canvasStore.ts 调用点总数恰 15（14 基线+1 白名单；第 16 个直连写点=红）', () => {
    const total = callLines(readFileSync(STORE, 'utf8')).length;
    // expect 第二参给最直白失败语：新增直连写点即触发本条，改走 runCommand 即绿
    expect(
      total,
      `棘轮失守：dispatchProjectionDiff 直连调用点 ${total} 个，冻结基线 ${BASELINE}+runCommand 白名单 1=${BASELINE + 1}。` +
        '新增命令一律经 runCommand（canEdit 门+单 undo 步+finally 差分收尾由其统一兜底），不得新增第三写轨；' +
        '若 runCommand 收尾点被移除，本条同样红。',
    ).toBe(BASELINE + 1);
  });

  it('runCommand 实现块内恰 1 个收尾调用（白名单锚定——finally 差分收尾是唯一豁免写点）', () => {
    const block = runCommandBlock(readFileSync(STORE, 'utf8'));
    expect(block.length).toBeGreaterThan(0); // 块存在（防锚失效对空集恒真）
    const inBlock = callLines(block.join('\n')).length;
    expect(
      inBlock,
      'runCommand finally 差分收尾点必须恰 1 个：0=白名单写点丢失，>1=runCommand 内叠写（同值两 transact）。',
    ).toBe(1);
  });

  it('canvasIntents.ts 零 dispatchProjectionDiff 调用形态（dispatchSystemIntents 兼容通道不落 diff——第三写轨禁入 intents 层）', () => {
    const calls = callLines(readFileSync(INTENTS, 'utf8')).filter((l) => !l.includes('function dispatchProjectionDiff'));
    expect(
      calls,
      'canvasIntents.ts 出现 dispatchProjectionDiff 调用=第三写轨越界进 intents 层；停下核对架构，而非调整本门禁。',
    ).toEqual([]);
  });
});
