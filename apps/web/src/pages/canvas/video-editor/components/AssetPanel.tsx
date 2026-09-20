import { useEffect, useState } from 'react';
import { App as AntdApp, Input } from 'antd';
import axios from 'axios';
import { useWorkflowAssets } from '../hooks/useWorkflowAssets';
import { useTeamAssets } from '../hooks/useTeamAssets';
import { useEditorStore } from '../store/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { presignUpload, confirmUpload } from '@/api/storageApi';
import { placeAssetInTrack, assetKindOf } from '../timeline/placement';
import { ensurePoster } from '../renderer/poster';

// 批3-3：三种卡片（全集资产/团队素材/生成结果）点击入轨归一化——形状差异由各 onClick 映射，此处只消费统一形状。
// durationSec 缺省 5 同 drag payload 口径（addClip 未知兜底一致）；无 thumbnailUrl 的视频素材 fire-and-forget 取首帧海报（批3-4）
function addAssetToTimeline(norm: {
  mediaId: string; mimeType: string; name: string; durationSec: number; url?: string; sourceNodeId?: string; thumbnailUrl?: string;
}) {
  const es = useEditorStore.getState();
  if (!es.data) return;
  es.setMediaInfo(norm.mediaId, { name: norm.name, durationSec: norm.durationSec, url: norm.url, mimeType: norm.mimeType, thumbnailUrl: norm.thumbnailUrl });
  const placement = placeAssetInTrack(es.data, { mimeType: norm.mimeType });
  const trackId = placement.createNewTrack ? es.addTrack(placement.newTrackType!) : placement.trackId;
  es.addClip({ type: assetKindOf(norm.mimeType), mediaId: norm.mediaId, sourceNodeId: norm.sourceNodeId, trackId, start: placement.start });
  // poster fire-and-forget：视频素材缺帧缩略图时取首帧（同步函数内发起，异步写回经白名单只补缺）
  if (!norm.thumbnailUrl && norm.mimeType.startsWith('video/') && norm.url) {
    void ensurePoster(norm.url).then((poster) => {
      if (poster) useEditorStore.getState().setMediaInfo(norm.mediaId, {
        name: norm.name, durationSec: norm.durationSec, url: norm.url, mimeType: norm.mimeType, thumbnailUrl: poster,
      });
    });
  }
}

export function AssetPanel() {
  const { message } = AntdApp.useApp(); // 批1-2：静态 message（portal body z-index 2010 被壳盖不可见）→ 壳内上下文实例
  const { items, loading } = useWorkflowAssets();
  const [keyword, setKeyword] = useState('');
  const [teamKey, setTeamKey] = useState(0); // 上传完成后 +1 触发团队素材刷新
  const [uploading, setUploading] = useState(false);
  const team = useTeamAssets(teamKey);
  const data = useEditorStore(s => s.data);
  const generatedMediaIds = useEditorStore(s => s.generatedMediaIds);
  const mediaInfo = useEditorStore(s => s.mediaInfo);

  const addedMediaIds = new Set(
    data ? Object.values(data.clips).map(c => (c as any).mediaId).filter(Boolean) : [],
  );
  const filtered = items.filter(i => i.originalName.includes(keyword));

  // items 就绪同步 mediaInfo（含既有工程重开的 url 回填，决策 13）——仅填缺失键，不覆盖已有
  useEffect(() => {
    if (items.length) useEditorStore.getState().mergeMediaInfo(Object.fromEntries(items.map(i => [i.mediaId, { name: i.originalName, durationSec: i.nodeDurationSec ?? (i.metadata as { durationSec?: number })?.durationSec, url: i.url, mimeType: i.mimeType }])));
  }, [items]);

  return (
    <div data-testid="asset-panel" className="h-full border-r border-[var(--ve-border)] bg-[var(--fw-surface-dim)] flex flex-col min-h-0">
      <div className="p-2 border-b border-[var(--ve-border)] flex items-center gap-2">
        <Input placeholder="搜索资产" value={keyword} onChange={e => setKeyword(e.target.value)} size="small" />
        <label data-testid="asset-upload-btn"
          className={`text-[12px] text-[var(--ve-accent-text)] cursor-pointer shrink-0 select-none${uploading ? ' opacity-40 pointer-events-none' : ''}`}>
          + 新建
          <input type="file" className="hidden" accept="video/*,audio/*,image/*"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              // review I-2：accept 仅是选择器提示（"所有文件"可绕过）——pdf 客户端前置拒绝，否则上传"成功"后被 useTeamAssets mime 过滤隐形（困惑+白占配额）。
              // materialLibraryStore.uploadFile 同款先例（mime 前置 + 大小前置）；口径放宽含 audio。大小取 2GB：先例 video 100MB 不足 15min 剪辑素材，编辑器场景放宽
              const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
              if (!/^(video|audio|image)\//.test(file.type)) { void message.error('仅支持视频、音频、图片文件'); return; }
              if (file.size > MAX_FILE_SIZE) { void message.error('文件超过大小限制'); return; }
              setUploading(true);
              try {
                // R4-9：传 projectId——后端解析画布 teamId + assertMember（storage.service 三级回落第 1 级），
                // 不传落用户默认团队：画布属非默认团队时上传归属错团队且计其配额（materialLibraryStore 两者都传同款动机）
                const { fileId, uploadUrl, key, fields } = await presignUpload({ fileName: file.name, fileSize: file.size, fileType: file.type, type: 'uploaded', projectId: useCanvasStore.getState().projectId ?? undefined });
                const fd = new FormData();
                Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
                fd.append('file', file);
                await axios.post(uploadUrl.replace(/^https?:\/\/[^/]+\/flowai/, '/flowai'), fd); // /flowai 同源改写避 CORS
                await confirmUpload({ fileId, key, fileSize: file.size });
                setTeamKey(n => n + 1); // 刷新团队素材列表——url/durationSec/mimeType 由 useTeamAssets 的 load 内统一 mergeMediaInfo 回填（R1：上传回调不再手写 merge）
                void message.success('上传完成');
              } catch (err) { void message.error(`上传失败：${(err as Error).message}`); }
              finally { setUploading(false); }
            }} />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-2 py-1 text-[12px] text-[var(--ve-text-dim)]">全集资产</div>
        {loading && <div className="px-2 text-[12px] text-[var(--ve-text-dim)]">加载中…</div>}
        <ul>
          {filtered.map(i => (
            <li key={i.mediaId}
              data-testid={`asset-item-${i.mediaId}`}
              draggable
              onClick={() => addAssetToTimeline({
                mediaId: i.mediaId, mimeType: i.mimeType, name: i.originalName,
                durationSec: i.nodeDurationSec ?? (i.metadata as { durationSec?: number })?.durationSec ?? 5, // 决策 6 同 drag payload 口径
                url: i.url, sourceNodeId: i.sourceNodeId || undefined,
                thumbnailUrl: i.thumbnailUrl ?? undefined,
              })}
              onDragStart={e => e.dataTransfer.setData('application/x-clip', JSON.stringify({
                mediaId: i.mediaId,
                sourceNodeId: i.sourceNodeId || undefined,
                mimeType: i.mimeType,
                originalName: i.originalName,
                durationSec: i.nodeDurationSec ?? (i.metadata as { durationSec?: number })?.durationSec, // 决策 6：节点配置时长优先，metadata 兜底
                url: i.url, thumbnailUrl: i.thumbnailUrl ?? undefined, // 批3-4：与 onClick norm 同源——drop 路径 poster 回退取帧的取数来源
              }))}
              className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-overlay-2">
              <div className="w-10 h-10 rounded-md bg-[var(--ve-thumb-base)] shrink-0 overflow-hidden flex items-center justify-center">
                {i.thumbnailUrl
                  ? <img src={i.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-[10px] text-[var(--ve-text-dim)]">{i.kind === 'audio' ? '音' : i.kind === 'video' ? '视' : '图'}</span>}
              </div>
              <span className="text-[12px] text-[var(--fw-text)] truncate" style={{ minWidth: 0 }}>{i.originalName}</span>
              {addedMediaIds.has(i.mediaId)
                && <span className="ml-auto text-[10px] text-[#00B42A] shrink-0">已添加</span>}
            </li>
          ))}
        </ul>
        {!loading && filtered.length === 0 && <div className="px-2 py-3 text-[12px] text-[var(--ve-text-dim)]">暂无资产</div>}
        {/* spec 全集资产 = 画布产物 + 团队素材库——团队素材（folder 接口未按目录下钻，一期只根目录） */}
        <div className="px-2 py-1 mt-2 text-[12px] text-[var(--ve-text-dim)]">团队素材</div>
        <ul>
          {team.items.map((it) => (
            <li key={it.mediaId}
              data-testid={`team-asset-item-${it.mediaId}`}
              draggable
              onClick={() => addAssetToTimeline({
                mediaId: it.mediaId, mimeType: it.mimeType, name: it.name,
                durationSec: it.durationSec ?? 5, url: it.url,
                thumbnailUrl: it.thumbnailUrl ?? undefined,
                // sourceNodeId 省略——素材库来源不建边（同 drag payload 口径）
              })}
              onDragStart={e => e.dataTransfer.setData('application/x-clip', JSON.stringify({
                mediaId: it.mediaId,
                mimeType: it.mimeType,
                originalName: it.name,
                durationSec: it.durationSec, // sourceNodeId 省略：素材库来源不建边（spec §二 规则 1，同生成结果分支）
                url: it.url, thumbnailUrl: it.thumbnailUrl ?? undefined, // 批3-4：同全集资产——drop 路径 poster 回退取帧
              }))}
              className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-overlay-2">
              <div className="w-10 h-10 rounded-md bg-[var(--ve-thumb-base)] shrink-0 overflow-hidden flex items-center justify-center">
                {it.thumbnailUrl
                  ? <img src={it.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  : <span className="text-[10px] text-[var(--ve-text-dim)]">{it.mimeType.startsWith('audio/') ? '音' : it.mimeType.startsWith('video/') ? '视' : '图'}</span>}
              </div>
              <span className="text-[12px] text-[var(--fw-text)] truncate" style={{ minWidth: 0 }}>{it.name}</span>
              {addedMediaIds.has(it.mediaId)
                && <span className="ml-auto text-[10px] text-[#00B42A] shrink-0">已添加</span>}
            </li>
          ))}
        </ul>
        {team.items.length === 0 && !team.loading && <div className="px-2 py-3 text-[12px] text-[var(--ve-text-dim)]">暂无团队素材</div>}
        {/* 生成结果（A1 影子产物——watchShadowJob 回填 mediaInfo；sourceNodeId 省略：素材库来源不建边 spec §二 规则 1） */}
        {generatedMediaIds.length > 0 && (
          <>
            <div className="px-2 py-1 mt-2 text-[12px] text-[var(--ve-text-dim)]">生成结果</div>
            <ul>
              {generatedMediaIds.map((mediaId) => {
                const info = mediaInfo[mediaId];
                return (
                  // R1（P1-7）+R2-N10+R3-5：mimeType 必有才可拖（draggable 随其有无）——拒绝来源不明资产，而非错型入库；
                  // 空串/缺失判 image 落视频轨会建空白图片片，'video/mp4' 兜底会把音频产物建成 video 片黑屏
                  <li key={mediaId}
                    data-testid={`generated-item-${mediaId}`}
                    draggable={Boolean(info?.mimeType)}
                    onClick={() => {
                      if (!info?.mimeType) return; // 同 draggable 守卫——mimeType 就绪才可入轨（拒绝来源不明资产）
                      addAssetToTimeline({
                        mediaId, mimeType: info.mimeType, name: info.name ?? mediaId,
                        durationSec: info.durationSec ?? 5, url: info.url,
                      });
                    }}
                    onDragStart={e => e.dataTransfer.setData('application/x-clip', JSON.stringify({
                      mediaId,
                      mimeType: info?.mimeType ?? '',
                      originalName: info?.name ?? mediaId,
                      durationSec: info?.durationSec,
                      url: info?.url, // 批3-4：生成结果无缩略图——video 产物靠 drop 侧 ensurePoster 回退取帧
                    }))}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-grab hover:bg-overlay-2">
                    <div className="w-10 h-10 rounded-md bg-[var(--ve-thumb-base)] shrink-0 overflow-hidden flex items-center justify-center">
                      <span className="text-[10px] text-[var(--ve-text-dim)]">{info?.mimeType?.startsWith('audio/') ? '音' : info?.mimeType?.startsWith('video/') ? '视' : '图'}</span>
                    </div>
                    <span className="text-[12px] text-[var(--fw-text)] truncate" style={{ minWidth: 0 }}>{info?.name ?? mediaId}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
