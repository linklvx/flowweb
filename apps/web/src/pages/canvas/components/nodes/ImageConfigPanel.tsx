import { memo, useCallback, useState, useEffect } from 'react';
import { useViewport } from '@xyflow/react';
import { useNodeStore, isImageNode } from '@/stores/nodeStore';
import { selectExecStatus, selectExecEntry } from '@/stores/execStatusView';
import { useCanvasStore } from '@/stores/canvasStore';
import { gestureToken, storedToken, rotateToken } from '@/utils/regen-token';
import { ModelSelector } from './config-panel/ModelSelector';
import { RatioResolutionPopover } from './config-panel/RatioResolutionPopover';
import type { RatioOption } from './config-panel/RatioResolutionPopover';
import { GenerateCountSelector } from './config-panel/GenerateCountSelector';
import { CreditDisplay } from './config-panel/CreditDisplay';
import { RunButton } from './config-panel/RunButton';
import { PromptEditor } from './config-panel/PromptEditor';
import * as imageNodeApi from '@/api/imageNodeApi';

interface Props {
  nodeId: string;
}

const RATIO_OPTIONS: RatioOption[] = [
  { label: '1:1', w: 12, h: 12 },
  { label: '9:16', w: 9, h: 16 },
  { label: '16:9', w: 16, h: 9 },
  { label: '3:4', w: 9, h: 12 },
  { label: '4:3', w: 12, h: 9 },
  { label: '3:2', w: 12, h: 8 },
  { label: '2:3', w: 9, h: 12 },
];

function ImageConfigPanelComponent({ nodeId }: Props) {
  const node = useNodeStore((s) => s.nodes[nodeId]);
  const updateConfig = useNodeStore((s) => s.updateConfig);
  const updatePromptImages = useNodeStore((s) => s.updatePromptImages);
  const setStatus = useNodeStore((s) => s.setStatus);
  const { zoom } = useViewport();

  const nodeData = isImageNode(node) ? node.data : undefined;
  // Y0b-1（三轮 Z30/P0-6+四轮 Z36②a）：删 ?? 'sdxl'/?? '2K' 字面量兜底——空值走 MODEL_NOT_SELECTED/自动选首行
  const model = nodeData?.model;
  const ratio = nodeData?.ratio ?? '16:9';
  const resolution = nodeData?.resolution;
  const quality = nodeData?.quality ?? 'standard';
  // 批1-6（B2）：执行状态合并视图（exec 投影 → 对齐 → data.status）
  const status = useNodeStore((s) => selectExecStatus(s, nodeId));
  // Y0b-2 T6（Z79）：整条投影 entry——token 轮换与按钮三态的判据单源（rearmable/attempts）
  const entry = useNodeStore((s) => selectExecEntry(s, nodeId));
  const prompt = nodeData?.prompt ?? { text: '', html: '' };
  const allImages = nodeData?.allImages ?? [];

  const [models, setModels] = useState<imageNodeApi.ModelWithDimensions[]>([]);
  const [creditCost, setCreditCost] = useState<number | null>(0);
  const [executing, setExecuting] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [generateCount, setGenerateCount] = useState(1);

  // Y0b-2 T6（Z95 轮换）：投影 done（下一击=新"重新生成"）或 error∧rearmable:false（EXHAUSTED 不自锁）
  // ⇒ 丢弃持有——判据单源=doc 投影（服务端权威跨刷新存活，非组件 ref 记忆）
  useEffect(() => {
    if (entry?.status === 'done' || (entry?.status === 'error' && entry.rearmable === false)) {
      const pid = useCanvasStore.getState().projectId;
      if (pid) rotateToken(pid, nodeId);
    }
  }, [entry?.status, entry?.rearmable, nodeId]);

  // Load image models
  useEffect(() => {
    imageNodeApi.fetchModels().then((list) => {
      setModels(list);
      if (!nodeData?.model && list.length > 0) {
        // 批2-2：收口 wrapper（readOnly 早退——输入不落 store）
        useNodeStore.getState().applyNodeDataPatch(nodeId, { model: list[0].id });
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Y0b-1（四轮 Z36②a）：分辨率存行 id——缺省/换模型后行 id 失效时自动选首行（对齐 model list[0].id 先例）
  const currentModel = models.find((m) => m.id === model);
  useEffect(() => {
    const res = currentModel?.resolutions ?? [];
    if (res.length > 0 && !res.some((r) => r.id === nodeData?.resolution)) {
      useNodeStore.getState().applyNodeDataPatch(nodeId, { resolution: res[0].id });
    }
  }, [currentModel, nodeData?.resolution, nodeId]);

  // Calculate price
  useEffect(() => {
    if (model) {
      imageNodeApi.getCreditCost(model, nodeData?.resolution)
        .then(setCreditCost)
        .catch(() => setCreditCost(null)); // 定价不可用（无规则/解析失败）——禁 .catch(0) 免费假象
    } else {
      setCreditCost(null); // 未选模型：不显示数字报价
    }
  }, [model, nodeData?.resolution]);

  const handleGenerate = useCallback(async () => {
    if (!nodeData?.prompt?.text?.trim()) return;
    setExecuting(true);
    setStatus(nodeId, 'loading');
    const projectId = useCanvasStore.getState().projectId;
    try {
      if (!projectId) return;
      // Y0b-2 T6（Z79/Z118 手势 token 生命周期）：held 一律上送（error 后重试/在飞复用=免费 rearm——
      // sessionStorage 跨刷新存活）；无 held 且 done/EXHAUSTED=新"重新生成"手势（铸造新 token 照常扣费）；
      // 否则无 token 普通执行（内容键——服务端②回放最新 SUCCEEDED）
      const held = storedToken(projectId, nodeId);
      const token = held
        ?? ((status === 'done' || entry?.rearmable === false) ? gestureToken(projectId, nodeId) : undefined);
      await imageNodeApi.submitGeneration(nodeId, { projectId, ...(token ? { regenToken: token } : {}) });
    } catch {
      // 异步链（enqueue）失败态由服务端 exec 投影接管（error 三件 errorCode/rearmable/attempts——
      // 轮换 useEffect 单源处理）；本地仅置 data.status 兜底（HTTP 4xx/网络错）
      setStatus(nodeId, 'error');
    } finally {
      setExecuting(false);
    }
  }, [nodeId, setStatus, nodeData, status, entry?.rearmable]);

  if (!isImageNode(node)) return null;

  return (
    <div
      className="nodrag bg-[var(--canvas-controls-bg)] rounded-xl w-[650px] shadow-xl relative"
      style={{
        transform: `scale(${1 / zoom})`,
        transformOrigin: 'top center',
        border: '1px solid var(--canvas-controls-border)',
      }}
    >
      {/* Maximize / Restore button — top-right corner */}
      <button
        type="button"
        className="absolute top-2 right-2 shrink-0 focus:outline-none p-1 text-text-dim-3 shadow-none outline-none"
        data-testid="canvas-node-generation-input-bar-maximize-button"
        data-state={maximized ? 'open' : 'closed'}
        onClick={() => setMaximized((v) => !v)}
      >
        {maximized ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.9811 2.31442C13.1763 2.11915 13.4928 2.11915 13.6881 2.31442C13.8834 2.50968 13.8834 2.82618 13.6881 3.02145L10.5416 6.16793H12.0013C12.2774 6.16793 12.5013 6.39179 12.5013 6.66793C12.5013 6.94407 12.2774 7.16793 12.0013 7.16793H9.3346C9.05845 7.16793 8.8346 6.94407 8.8346 6.66793V4.00126C8.8346 3.72512 9.05845 3.50126 9.3346 3.50126C9.61074 3.50126 9.8346 3.72512 9.8346 4.00126V5.4609L12.9811 2.31442ZM7.16793 12.0013C7.16793 12.2774 6.94407 12.5013 6.66793 12.5013C6.39179 12.5013 6.16793 12.2774 6.16793 12.0013V10.5416L3.02145 13.6881C2.82618 13.8834 2.50968 13.8834 2.31442 13.6881C2.11915 13.4928 2.11915 13.1763 2.31442 12.9811L5.4609 9.8346H4.00126C3.72512 9.8346 3.50126 9.61074 3.50126 9.3346C3.50126 9.05845 3.72512 8.8346 4.00126 8.8346H6.66793C6.94407 8.8346 7.16793 9.05845 7.16793 9.3346V12.0013Z" fill="currentColor" fillOpacity="0.9" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" clipRule="evenodd" d="M6.47949 8.81348C6.67475 8.61821 6.99126 8.61821 7.18652 8.81348C7.38179 9.00874 7.38179 9.32525 7.18652 9.52051L3.95703 12.75H6.25C6.52614 12.75 6.75 12.9739 6.75 13.25C6.75 13.5261 6.52614 13.75 6.25 13.75H2.75C2.47386 13.75 2.25 13.5261 2.25 13.25V9.75C2.25 9.47386 2.47386 9.25 2.75 9.25C3.02614 9.25 3.25 9.47386 3.25 9.75V12.043L6.47949 8.81348ZM13.25 2.25C13.5261 2.25 13.75 2.47386 13.75 2.75V6.25C13.75 6.52614 13.5261 6.75 13.25 6.75C12.9739 6.75 12.75 6.52614 12.75 6.25V3.95703L9.52051 7.18652C9.32525 7.38179 9.00874 7.38179 8.81348 7.18652C8.61821 6.99126 8.61821 6.67475 8.81348 6.47949L12.043 3.25H9.75C9.47386 3.25 9.25 3.02614 9.25 2.75C9.25 2.47386 9.47386 2.25 9.75 2.25H13.25Z" fill="currentColor" fillOpacity="0.9" />
          </svg>
        )}
      </button>

      <div className="p-3 flex flex-col gap-0">
        <PromptEditor
          nodeId={nodeId}
          value={{ text: prompt.text || '', html: prompt.html || '', referencedImageIds: [] }}
          allImages={allImages}
          onChange={(newPrompt) => updateConfig(nodeId, { prompt: { text: newPrompt.text, html: newPrompt.html, referencedImageIds: [] } })}
          onAllImagesChange={(images) => updatePromptImages(nodeId, images)}
          onGenerate={handleGenerate}
          disabled={status === 'loading'}
          maxHeight={maximized ? 350 : 80}
        />

        {/* Bottom bar: Model (left) + Credits + Execute (right) */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center gap-3">
            <ModelSelector
              models={models}
              selectedId={model}
              onSelect={(modelId) => updateConfig(nodeId, { model: modelId } as any)}
            />
            <div className="w-px h-4 bg-overlay-2 shrink-0" />
            <RatioResolutionPopover
              ratioOptions={RATIO_OPTIONS}
              ratio={ratio}
              resolution={resolution ?? ''}
              resolutionOptions={currentModel?.resolutions ?? []}
              onRatioChange={(r) => updateConfig(nodeId, { ratio: r } as any)}
              onResolutionChange={(r) => updateConfig(nodeId, { resolution: r } as any)}
            />
          </div>
          <div className="flex items-center gap-3">
            <GenerateCountSelector
              count={generateCount}
              onChange={setGenerateCount}
              disabled={status === 'loading'}
            />
            <div className="w-px h-4 bg-overlay-2 shrink-0" />
            <CreditDisplay cost={creditCost} />
            <RunButton
              loading={executing}
              onClick={handleGenerate}
              disabled={status === 'loading'}
              label={entry?.status === 'error' ? `重试（剩 ${Math.max(0, 3 - (entry.attempts ?? 1))} 次）` : status === 'done' ? '重新生成' : '执行'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const ImageConfigPanel = memo(ImageConfigPanelComponent);
