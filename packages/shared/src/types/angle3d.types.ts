export type Angle3DTaskStatus = 'idle' | 'pending' | 'processing' | 'success' | 'failed';

export const Angle3DTaskStatuses = {
  IDLE: 'idle' as Angle3DTaskStatus,
  PENDING: 'pending' as Angle3DTaskStatus,
  PROCESSING: 'processing' as Angle3DTaskStatus,
  SUCCESS: 'success' as Angle3DTaskStatus,
  FAILED: 'failed' as Angle3DTaskStatus,
} as const;

export interface Angle3DParams {
  horizontalAngle: number; // -90 ~ 90
  verticalAngle: number;   // -60 ~ 60
  zoom: number;            // 0 ~ 10
  customPrompt?: string;
}

export type Angle3DPresetKey = 'fisheye' | 'tilted' | 'topDown' | 'bottomUp' | 'panoramicTopDown';

export interface Angle3DPreset {
  key: Angle3DPresetKey;
  label: string;
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
}

export const ANGLE3D_PRESETS: Angle3DPreset[] = [
  { key: 'fisheye', label: '鱼眼视角', horizontalAngle: 0, verticalAngle: 30, zoom: 10 },
  { key: 'tilted', label: '倾斜视角', horizontalAngle: 45, verticalAngle: -30, zoom: 5 },
  { key: 'topDown', label: '正面俯拍', horizontalAngle: 0, verticalAngle: 60, zoom: 5 },
  { key: 'bottomUp', label: '正面仰拍', horizontalAngle: 0, verticalAngle: -30, zoom: 5 },
  { key: 'panoramicTopDown', label: '全景俯拍', horizontalAngle: 45, verticalAngle: 30, zoom: 0 },
];

export const ANGLE3D_DEFAULTS: Angle3DParams = {
  horizontalAngle: 0,
  verticalAngle: 0,
  zoom: 5,
};

export const PRESET_MATCH_THRESHOLDS = {
  horizontalAngle: 0.5,
  verticalAngle: 0.5,
  zoom: 0.1,
};
