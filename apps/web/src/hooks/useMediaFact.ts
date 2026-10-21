// apps/web/src/hooks/useMediaFact.ts —— Y1b T16：媒体事实消费 hook（nodeStore.mediaFacts 订阅面——
// processing/completed/failed 驱动 UI；factVersion 单调去重在 stores/mediaFacts 纯模块）。
import { useNodeStore } from '@/stores/nodeStore';
import type { MediaFactEntry } from '@/stores/mediaFacts';

/** fileId（mediaId）→ 最新事实条目（无=undefined——UI 回落既有 status/占位形态）。 */
export function useMediaFact(fileId: string | null | undefined): MediaFactEntry | undefined {
  return useNodeStore((s) => (fileId ? s.mediaFacts.get(fileId) : undefined));
}
