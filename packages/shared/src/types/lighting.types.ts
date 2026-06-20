export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number; // 0-100
  colorTemperature: number; // 2000-10000 K
  rimLight: boolean;
  customPrompt?: string;
}

export enum LightingTaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export interface LightingTaskBase {
  id: string;
  nodeId: string;
  projectId?: string;
  originalImageUrl: string;
  params: LightingParams;
  status: LightingTaskStatus;
  costCredits: number;
  resultImageUrl?: string;
  resultMediaId?: string;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}
