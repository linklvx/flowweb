/** 成品视频本地探测（spec §5.1）：objectURL + <video> 事件舞。
 *  返回 null 字段 = 探测不到对应值（Infinity/0 宽高的真实 MP4 形态），非失败——DTO 全 @IsOptional。
 *  decode 失败同时是可播放性闸门：HEVC/ProRes/.mov 在 Chrome 播不了，probe 就拦下（服务器端无真实 MIME 校验，
 *  presign 的 contentType 形参是死参——这是唯一防线）。 */
export type ProbeResult =
  | { ok: true; durationSec: number | null; width: number | null; height: number | null; coverBlob: Blob | null }
  | { ok: false; reason: 'decode' };

const COVER_MAX_W = 1280;        // 封面限宽（抽帧 jpeg 过大无意义）
const PROBE_TIMEOUT_MS = 10_000; // 畸形文件事件永不触发——不兜底则 Promise 永不 settle + objectURL 泄漏
const CAPTURE_TIMEOUT_MS = 5_000; // seek 不回调兜底（真实浏览器偶发）——没封面比挂死好

export async function probeVideoFile(file: File): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.src = url;

  const cleanup = () => {
    // src 清空即释放（真实浏览器可再调 load() 中止解码；jsdom 的 load 是 notImplemented 噪音，故不调）
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  };

  const metadata = new Promise<{ durationSec: number | null; width: number | null; height: number | null; rawDuration: number }>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => {
      const finite = Number.isFinite(video.duration) && video.duration > 0;
      resolve({
        durationSec: finite ? Math.round(video.duration) : null, // durationSec 取整在此完成（DTO @IsInt 无 transform，浮点直接 400）
        width: video.videoWidth > 0 ? video.videoWidth : null,
        height: video.videoHeight > 0 ? video.videoHeight : null,
        rawDuration: finite ? video.duration : 0,
      });
    }, { once: true });
    video.addEventListener('error', () => reject(new Error('decode')), { once: true });
  });

  let probeTimer: ReturnType<typeof setTimeout>;
  try {
    const m = await Promise.race([
      metadata,
      new Promise<never>((_, rej) => { probeTimer = setTimeout(() => rej(new Error('timeout')), PROBE_TIMEOUT_MS); }),
    ]);
    const coverBlob = await captureFrame(video, m.rawDuration);
    return { ok: true, durationSec: m.durationSec, width: m.width, height: m.height, coverBlob };
  } catch {
    return { ok: false, reason: 'decode' }; // video error 或 10s 超时
  } finally {
    clearTimeout(probeTimer!); // 成功路径也清——悬挂 10s timer 是 fake-timers 环境的隐患（与 captureFrame 的清理纪律一致）
    cleanup();
  }
}

async function captureFrame(video: HTMLVideoElement, duration: number): Promise<Blob | null> {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null; // HAVE_CURRENT_DATA——drawImage 前置
  let t: ReturnType<typeof setTimeout>;
  const frame = new Promise<Blob | null>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, COVER_MAX_W / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), 'image/jpeg');
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = duration > 0 ? Math.min(1, duration / 2) : 1; // <1s 短视频 seek(1) 被夹到末帧可能抽到黑帧；duration 非法(rawDuration=0) 勿 seek(0)——前导黑帧高发（第九轮：数值守卫只拦 readyState/宽高，不拦 duration）
    t = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS); // seek 不回调兜底——勿让整个 probe 挂死
  });
  return frame.finally(() => clearTimeout(t));
}
