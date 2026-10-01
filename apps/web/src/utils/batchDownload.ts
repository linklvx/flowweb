// apps/web/src/utils/batchDownload.ts
import { Modal, message } from 'antd';
import { downloadMediaFile } from './mediaDownload';
import type { DownloadableItem } from './collectDownloadables';

// 首跑许可标记：下划线式键名（同 flowweb_vp_ / flowweb_projectId 仓内惯例）
const HINT_KEY = 'flowweb_batch_dl_hint';
// 串行节流参数：>10 项先确认；相邻下载起始间隔 300ms
const CONFIRM_THRESHOLD = 10;
const STAGGER_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Modal.confirm 门禁壳：确定→执行 onOk 并返回 true；取消→静默返回 false。 */
const gateConfirm = (title: string, content: string, onOk?: () => void): Promise<boolean> =>
  new Promise((resolve) => {
    Modal.confirm({
      title,
      content,
      onOk: () => { onOk?.(); resolve(true); },
      onCancel: () => resolve(false),
    });
  });

/** 串行节流/聚合/许可逻辑单源（2c-6 组工具条直接复用）：
 *  串行读法=相邻下载「起始」间隔 300ms（i>0 先 sleep(300) 再起下一个），全程 await 串行、至多一个在途；
 *  模态顺序=首跑许可 hint（浏览器行为说明，一次性格）先于 >10 数量确认（每跑参数确认）；
 *  逐项 silent（无单文件 toast），结束按 ok/fail 聚合提示。 */
export async function runBatchDownload(items: DownloadableItem[]): Promise<void> {
  if (items.length === 0) return;

  // 首次批量 → 浏览器行为许可提示（确定落键并继续；取消键不落并中止）
  if (!localStorage.getItem(HINT_KEY)) {
    const ok = await gateConfirm('批量下载', '浏览器将开始下载多个文件', () => localStorage.setItem(HINT_KEY, '1'));
    if (!ok) return;
  }

  // >10 项 → 每跑数量确认
  if (items.length > CONFIRM_THRESHOLD) {
    const ok = await gateConfirm('批量下载', `将下载 ${items.length} 个文件，可能占用较多资源，是否继续？`);
    if (!ok) return;
  }

  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await sleep(STAGGER_MS);
    const r = await downloadMediaFile(items[i], { silent: true });
    if (r.ok) okCount++;
    else failCount++;
  }

  if (failCount === 0) message.success(`已下载 ${items.length} 个文件`);
  else if (okCount === 0) message.error(`${failCount} 个文件下载失败`);
  else message.success(`已下载 ${okCount} 个文件，${failCount} 个失败`);
}
