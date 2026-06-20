import type { LightingParams, LightingTaskStatus } from '@flowweb/shared';

export interface ILightingTask {
  id: string;
  userId: string;
  nodeId: string;
  projectId?: string;
  originalImageUrl: string;
  resultImageUrl?: string;
  resultMediaId?: string;
  params: LightingParams;
  status: LightingTaskStatus;
  costCredits: number;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}
