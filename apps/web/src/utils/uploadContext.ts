import { useCanvasStore } from '@/stores/canvasStore';

/** 画布内上传统一取 projectId（后端 presign 三级回落①级：解析 project.teamId + editor 校验） */
export function canvasProjectId(): string | undefined {
  return useCanvasStore.getState().projectId ?? undefined;
}
