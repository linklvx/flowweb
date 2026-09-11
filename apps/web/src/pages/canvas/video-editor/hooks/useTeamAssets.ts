import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useEditorStore } from '../store/editorStore';

export interface TeamAssetItem { mediaId: string; name: string; mimeType: string; url?: string; thumbnailUrl?: string | null; durationSec?: number; }

const MEDIA_MIME_PREFIXES = ['video/', 'audio/', 'image/'];

/** 团队素材库（material files 接口全量——folderId 不传）。
 *  mediaId = file.id（MaterialService 查 Media 表同源——getFilesByFolderId 返回整行含 id/originalName/mimeType/metadata）。
 *  url 为后端动态生成的 presigned 绝对 URL，经 /flowai 同源改写（materialLibraryStore loadFiles 同款）。
 *  R4-9：teamId 取画布所属团队（editorStore.teamId——Task 10 loadProject 存，byNode 返回整行含 teamId）——
 *  画布属非默认团队时面板展示的是该团队素材（与上传侧 presign projectId 解析同源；file.controller 透传 teamId query ✓）。
 *  teamId 为空（理论上编辑器打开后必非空）回落默认团队。 */
export function useTeamAssets(refreshKey?: number): { items: TeamAssetItem[]; loading: boolean } { // R8-5：reload 无消费者已删
  const [items, setItems] = useState<TeamAssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  // R5-P1-5：teamId 必须 selector 订阅（非 getState 快照）——AssetPanel 随 Shell 打开即挂载，loadProject 是
  // async（upsert 返回后才写 teamId），首次 effect 时 getState().teamId 恒 null → 请求默认团队且不再重跑。
  const teamId = useEditorStore(s => s.teamId);
  const reqRef = useRef(0); // R6-P2-2：teamId null→实值切换时两个 in-flight 并存——先发响应后到会覆盖新态，序号守卫同 ExportModal quotaReqRef 模式
  const load = () => {
    const req = ++reqRef.current;
    setLoading(true);
    // R1（P1-9）：绝不传 type 参数——material.service 传 type 会强制 where.type='generated' 滤掉 uploaded！
    // 也不传 folderId：不传只返回根目录文件（service where folderId null）——一期接受，登记（深层目录素材经素材库管理入口移动）
    axios.get(teamId ? `/api/material/files?teamId=${encodeURIComponent(teamId)}` : '/api/material/files')
      .then((res) => {
        if (reqRef.current !== req) return; // 过期响应丢弃（新请求已发出）
        // 响应实形（执行核实点）：TransformInterceptor 全局包 {code,data,message} → res.data.data = {success,data:files}
        const files = (res.data?.data?.data ?? []) as Array<Record<string, unknown>>;
        const mapped = files
          .filter((f) => typeof f.mimeType === 'string' && MEDIA_MIME_PREFIXES.some((p) => (f.mimeType as string).startsWith(p)))
          .map((f) => ({
            mediaId: String(f.id),
            name: String(f.originalName ?? f.name ?? f.id),
            mimeType: String(f.mimeType),
            url: typeof f.url === 'string' ? f.url.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai') : undefined,
            thumbnailUrl: typeof f.thumbnailUrl === 'string' ? f.thumbnailUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai') : null,
            durationSec: (f.metadata as { durationSec?: number } | null | undefined)?.durationSec,
          }));
        setItems(mapped);
        // P1-9：团队素材必须进 mediaInfo——否则 addClip 兜底 5s、渲染/导出缺 url 黑帧（P0-7 修复后 url 不再被 drop 擦除）
        useEditorStore.getState().mergeMediaInfo(Object.fromEntries(mapped.map((m) => [m.mediaId, {
          name: m.name, durationSec: m.durationSec, url: m.url, mimeType: m.mimeType,
        }])));
      })
      .catch(() => { if (reqRef.current === req) setItems([]); }) // 守卫同 then——过期失败不清新列表
      .finally(() => { if (reqRef.current === req) setLoading(false); }); // 过期请求的 finally 不得提前清掉新请求的 loading
  };
  useEffect(load, [refreshKey, teamId]); // eslint-disable-line react-hooks/exhaustive-deps —— R5-P1-5：teamId 进 deps、null→实值自动重拉；R8-5：AssetPanel 经 teamKey→refreshKey 触发重拉
  return { items, loading };
}
