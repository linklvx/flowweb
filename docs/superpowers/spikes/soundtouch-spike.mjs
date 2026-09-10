// soundtouchjs Go/No-Go Spike —— 验证③: Node 离线整段 PCM 变速不变调
// ②（Worker 内 ESM 导入）本 Spike 只确认入口形态（见文件末尾结论行），Plan 3 于 Worker 内实测
// ①（0.5x/2x 音质）浏览器人工判定，本任务不做
//
// 实测 API 与 plan 猜测的差异（2026-09-10，依据 dist/soundtouch.js 源码 + vendor opencut-classic）：
//   - plan 猜测 `new PitchShifter(null, {sampleRate}, {tempo})` + `shifter._pipe()` + `on('play')` 全部不成立：
//     PitchShifter 构造第一步就调 getWebAudioNode → context.createScriptProcessor()，强依赖 AudioContext，
//     传 null 必崩；_pipe 是 FilterSupport 的私有字段 getter，PitchShifter 上无此 API，也无无参 _pipe() 调用形态。
//   - 可行离线路线：库导出的底层纯算法类 SoundTouch（WSOLA 管道）+ SimpleFilter（同步拉取输出帧），
//     source 用 WebAudioBufferSource 垫一个鸭子类型 AudioBuffer（只需 getChannelData/numberOfChannels/duration）。
//     vendor opencut-classic 的 src/retime/audio-stretch.ts 用的正是这同一管道（经 OfflineAudioContext 渲染），
//     印证该管道即库的官方离线用法。
//   - 环境细节：spike 位于 docs/ 下，裸 import 'soundtouchjs' 解析不到 apps/web/node_modules，
//     用相对 import.meta.url 拼 file:// 绝对路径直取 ESM 入口。

const { SoundTouch, SimpleFilter, WebAudioBufferSource } = await import(
  new URL('../../../apps/web/node_modules/soundtouchjs/dist/soundtouch.js', import.meta.url).href
);

const SR = 48000;
const SECONDS = 2;
const INPUT_FRAMES = SR * SECONDS; // 96000 帧

// 构造 440Hz 正弦测试信号（float32 单声道 PCM）
const pcm = new Float32Array(INPUT_FRAMES);
for (let i = 0; i < pcm.length; i++) {
  pcm[i] = Math.sin(2 * Math.PI * 440 * (i / SR));
}

// 鸭子类型 AudioBuffer：WebAudioBufferSource 只依赖 numberOfChannels + getChannelData
function makeFakeBuffer(channelsData, sampleRate) {
  return {
    numberOfChannels: channelsData.length,
    sampleRate,
    length: channelsData[0].length,
    duration: channelsData[0].length / sampleRate,
    getChannelData: (ch) => channelsData[ch],
  };
}

// 离线整段处理：tempo 变速不变调
//
// 离线用法的关键陷阱（Spike 实测发现，Plan 3 集成必须沿用此冲刷模式）：
// SimpleFilter.fillOutputBuffer 要求 inputBuffer >= 16384 帧才继续 process，
// source 抽干后 inputBuffer 中不足 16384 帧的尾部输入被直接丢弃（在线播放形态由
// onEnd 回调收尾故无感）。对策：输入尾部补 16384 帧静音冲刷，真实尾部数据即可
// 全部流过管道；输出尾部出现的补零静音按"最后一个非零样本"裁掉。
function processOffline(input, tempo) {
  const FLUSH_FRAMES = 16384; // 与 fillOutputBuffer 的 8192*2 门槛一致
  const padded = new Float32Array(input.length + FLUSH_FRAMES);
  padded.set(input); // 补尾部静音

  const soundTouch = new SoundTouch();
  soundTouch.tempo = tempo; // 只变速不变调 → pitch 保持 1
  const source = new WebAudioBufferSource(makeFakeBuffer([padded], SR));
  const filter = new SimpleFilter(source, soundTouch);

  const CHUNK = 4096; // 每次拉取的帧数
  const chunkBuf = new Float32Array(CHUNK * 2); // 交错双声道（单声道源会被 upmix 成 L=R）
  const out = new Float32Array(Math.ceil(padded.length / tempo + 16384) * 2);
  let totalFrames = 0;
  for (;;) {
    const n = filter.extract(chunkBuf, CHUNK);
    if (n === 0) break; // source 与内部缓冲全部耗尽
    out.set(chunkBuf.subarray(0, n * 2), totalFrames * 2);
    totalFrames += n;
  }

  // 裁掉补零冲刷产生的静音尾巴：从尾向前找最后一个非零样本（正弦测试信号无内部静音段）
  let lastNonZero = out.length - 1;
  while (lastNonZero >= 0 && Math.abs(out[lastNonZero]) < 1e-4) lastNonZero--;
  const validFrames = Math.floor(lastNonZero / 2) + 1; // 交错数据 → 帧数
  return { totalFrames: validFrames, interleaved: out.subarray(0, validFrames * 2) };
}

// 过零法估计主频：验证"不变调"语义（tempo=2 时频率仍应为 ~440Hz）
function estimateFrequency(interleaved, sampleRate) {
  let crossings = 0;
  for (let i = 2; i < interleaved.length; i += 2) {
    // 只看偶数位 = 左声道；仅统计负→正的正向过零，每周期恰一次
    if (interleaved[i - 2] <= 0 && interleaved[i] > 0) crossings++;
  }
  const seconds = interleaved.length / 2 / sampleRate;
  return crossings / seconds;
}

// Go/No-Go 判据：输出时长 = 输入时长 / tempo，容差 ±20%（WSOLA 尾部不足一个 sequence 的自然损失 < 100ms）
function assertDuration(tempo, totalFrames) {
  const expected = INPUT_FRAMES / tempo;
  const lower = expected * 0.8;
  const upper = expected * 1.2;
  const ok = totalFrames >= lower && totalFrames <= upper;
  console.log(
    `  tempo=${tempo}: 输入 ${INPUT_FRAMES} 帧 (${SECONDS}s) → 输出 ${totalFrames} 帧 ` +
      `(${(totalFrames / SR).toFixed(3)}s)，期望 ${expected} 帧 (${SECONDS / tempo}s) → ${ok ? 'OK' : 'OUT-OF-RANGE'}`,
  );
  return ok;
}

console.log('SPIKE-3: soundtouchjs 0.3.0 Node 离线整段 PCM 变速不变调验证');
let allOk = true;

// 2.0×：主判据（plan 明示）。输出应约 1s 等效，且频率仍 ~440Hz
const r2 = processOffline(pcm, 2.0);
allOk = assertDuration(2.0, r2.totalFrames) && allOk;
const freq2 = estimateFrequency(r2.interleaved, SR);
const pitchOk2 = Math.abs(freq2 - 440) < 25; // 容差 5%
console.log(`  tempo=2.0 输出主频估计: ${freq2.toFixed(1)}Hz（期望 440Hz±25）→ ${pitchOk2 ? 'OK' : 'PITCH-SHIFTED'}`);
allOk = pitchOk2 && allOk;

// 0.5×：spec 附录 A 真实场景的另一半（反向拉伸走不同管道顺序），同样校验时长
const r05 = processOffline(pcm, 0.5);
allOk = assertDuration(0.5, r05.totalFrames) && allOk;

if (allOk) {
  console.log('SPIKE-3 PASS: Node 离线导入 + 整段 PCM 变速不变调可行（输出帧数体现 tempo 压缩/拉伸且频率保持）');
} else {
  console.log('SPIKE-3 FAIL: 见上方 OUT-OF-RANGE / PITCH-SHIFTED 项');
  process.exit(1);
}

// CONCLUSION 2026-09-10: ③ PASS——tempo=2.0: 2s 输入 → 输出 0.980s 等效（期望 1s 的 98%，WSOLA overlap 固有微损），
//   主频保持 440.0Hz；tempo=0.5: 输出 3.886s 等效（期望 4s 的 97%）→ 离线整段 PCM 变速不变调可行（GO 信号）。
//   陷阱（Plan 3 必须沿用）：SimpleFilter 在 source 抽干后 inputBuffer<16384 帧的尾部输入被直接丢弃
//   （在线播放形态由 onEnd 收尾无感）；离线用法 = 输入尾部补 16384 帧静音冲刷 + 输出按最后非零样本裁剪。
//   ② 入口形态：package.json 为 "type":"module" + exports["."].import="./dist/soundtouch.js"——标准 ESM 入口，
//   无需 UMD 包装层；Worker 内实测归 Plan 3。① 0.5x/2x 音质浏览器人工判定，本任务不做。
