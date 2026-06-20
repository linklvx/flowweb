export interface LightingParams {
  position: { x: number; y: number; z: number };
  brightness: number; // 0-100
  colorTemperature: number; // 2000-10000 K
  rimLight: boolean;
  customPrompt?: string;
}

// String literal union type (for type-level usage)
export type LightingTaskStatus = 'pending' | 'processing' | 'success' | 'failed';

// Runtime constants (for value-level usage)
export const LightingTaskStatuses = {
  PENDING: 'pending' as LightingTaskStatus,
  PROCESSING: 'processing' as LightingTaskStatus,
  SUCCESS: 'success' as LightingTaskStatus,
  FAILED: 'failed' as LightingTaskStatus,
} as const;

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
