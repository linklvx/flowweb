import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);

// 局部指定 zh-cn locale，不污染全局 dayjs（antd 内部也使用 dayjs）
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  return dayjs(iso).locale('zh-cn').from(dayjs(now).locale('zh-cn'));
}
