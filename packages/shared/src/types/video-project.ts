// packages/shared/src/types/video-project.ts
export interface ProjectData {
  version: 1;
  fps: 30;
  canvasSize?: { width: number; height: number }; // C 档画布（spec 5.1 D6），缺省兜底 1920×1080
  tracks: Track[];
  clips: Record<string, VideoClip | ImageClip | AudioClip | SubtitleClip>;
}
export interface Track {
  id: string;
  type: 'video' | 'subtitle' | 'audio';
  name: string;
  muted: boolean;
  hidden: boolean;
  clips: string[]; // 三类轨语义一致，按 start 有序
}
export interface BaseClip { id: string; trackId: string; start: number; duration: number; }
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; }
export interface VideoClip extends BaseClip {
  type: 'video'; sourceStart: number; mediaId: string; sourceNodeId?: string;
  transform: Transform;
  playbackSpeed: 0.5 | 1 | 2;
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
}
export interface ImageClip extends BaseClip {
  type: 'image'; mediaId: string; sourceNodeId?: string;
  transform: Transform;
  transitionIn?: Transition; transitionOut?: Transition;
  keyframes: TransformKeyframe[];
}
export interface AudioClip extends BaseClip {
  type: 'audio'; sourceStart: number; mediaId: string; sourceNodeId?: string;
  volume: number; fade: { in: number; out: number };
  playbackSpeed: 0.5 | 1 | 2; keyframes: VolumeKeyframe[];
}
export interface SubtitleClip extends BaseClip {
  type: 'subtitle'; text: string; visible: boolean;
  style: { fontSize: number; color: string; letterSpacing: number };
}
export interface TransformKeyframe { id: string; t: number; property: 'x'|'y'|'scale'|'rotation'|'opacity'; value: number; easing: 'linear'; }
export interface VolumeKeyframe { id: string; t: number; value: number; easing: 'linear'; }
export interface Transition { type: 'fadeIn'|'fadeOut'|'crossfade'|'toBlack'|'toWhite'; duration: number; }

/** shared 层跨 Node/浏览器两侧运行——crypto.randomUUID 在 CJS Node/非 HTTPS 浏览器不可用，必须 fallback */
let idCounter = 0;
export function genId(prefix: string): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

/** 默认空工程：仅 1 条空视频轨，其余轨道随素材动态创建（spec 勘误③），空 clips */
export function createDefaultProjectData(): ProjectData {
  return {
    version: 1, fps: 30,
    tracks: [
      { id: genId('track'), type: 'video', name: '视频', muted: false, hidden: false, clips: [] },
    ],
    clips: {},
  };
}
