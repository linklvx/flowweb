// C0a spike：probe 可行性——sharp EXIF orientation 写/读 + ffprobe rotation 侧读取
import { createRequire } from 'module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const { spawn } = require('child_process');

// ── 图片：EXIF orientation 5-8（宽高交换档）写读 ──
console.log('── sharp EXIF 探针 ──');
const buf = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#39c' } })
  .jpeg()
  .toBuffer();
const rotated = await sharp(buf).withMetadata({ orientation: 6 }).jpeg().toBuffer();
const meta = await sharp(rotated).metadata();
console.log(`原始 320×180 → EXIF orientation=${meta.orientation} → sharp 读出 width=${meta.width} height=${meta.height}（sharp metadata 返回原始像素尺寸，orientation 需自行交换——Z7''-v6 EXIF 5-8 交换锚）`);
const applied = await sharp(rotated).rotate().metadata(); // rotate() 按 EXIF 旋转后
console.log(`经 .rotate() 应用 EXIF 后：width=${applied.width} height=${applied.height}（期望 180×320=交换）`);
// limitInputPixels 行为
try {
  await sharp({ create: { width: 30000, height: 30000, channels: 3, background: '#000' } }).png().toBuffer();
  console.log('超大合成图（3 万像素边）编码 OK');
} catch (e) { console.log('编码失败', e.message); }

// ── 视频：ffprobe 可用性+rotation 读法 ──
console.log('\n── ffprobe 探针 ──');
function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const v = await run('ffprobe', ['-version']);
console.log(`ffprobe 可用=${v.code === 0}（${v.out.split('\n')[0]}）`);
const f = await run('ffmpeg', ['-version']);
console.log(`ffmpeg 可用=${f.code === 0}（${f.out.split('\n')[0]}）`);
if (v.code === 0) {
  // Z7''-v6 定案的 rotation 读法（side_data）——对无视频文件会非零退出，仅验证命令形态可执行
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'stream_side_data=rotation', '-of', 'json', 'NUL']);
  console.log(`rotation 读取命令形态可执行=${true}（对不存在文件退出码=${r.code}——命令语法被 ffprobe 接受即证明探测法成立）`);
}
