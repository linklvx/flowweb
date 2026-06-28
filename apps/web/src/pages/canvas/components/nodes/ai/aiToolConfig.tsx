import type { AiToolId } from '@/stores/nodeStore';

// ── UI 层类型定义（不放入 nodeStore，避免依赖 React）──

export interface AiToolItem {
  id: AiToolId;
  name: string;
  desc: string;
  icon: React.ReactNode;
  isNew?: boolean;
}

export interface AiToolGroup {
  groupName: string;
  items: AiToolItem[];
}

// ── 内联 SVG 图标 ──

const Grid25Icon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="5.7" x2="15" y2="5.7" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="1" y1="10.3" x2="15" y2="10.3" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="5.7" y1="1" x2="5.7" y2="15" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="10.3" y1="1" x2="10.3" y2="15" stroke="currentColor" strokeWidth="0.8"/>
  </svg>
);

const FourPanelIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8.5" y="1" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="1" y="8.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
  </svg>
);

const FrameForwardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/>
    <polyline points="6,5 10,8 6,11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const FrameBackwardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/>
    <polyline points="10,5 6,8 10,11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>
);

const FilmLightingIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="8" y1="1" x2="8" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="8" y1="11" x2="8" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="1" y1="8" x2="5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="11" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const Panorama720Icon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <ellipse cx="8" cy="8" rx="7" ry="5" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1 1"/>
  </svg>
);

const NineCameraIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="1" y1="5.7" x2="15" y2="5.7" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="1" y1="10.3" x2="15" y2="10.3" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="5.7" y1="1" x2="5.7" y2="15" stroke="currentColor" strokeWidth="0.8"/>
    <line x1="10.3" y1="1" x2="10.3" y2="15" stroke="currentColor" strokeWidth="0.8"/>
  </svg>
);

const FaceThreeViewIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M4 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <line x1="13" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const CharacterSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M3.5 14c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);

const CharacterThreeViewIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M2 13c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1" strokeDasharray="1 0.5"/>
    <path d="M8 13c0-1.7 1.3-3 3-3s3 1.3 3 3" stroke="currentColor" strokeWidth="1" strokeDasharray="1 0.5" strokeLinecap="round"/>
  </svg>
);

const SceneSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M1 5l7-4 7 4v9a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    <rect x="6" y="9" width="4" height="6" stroke="currentColor" strokeWidth="1.2" fill="none"/>
  </svg>
);

const ProductSheetIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="3" y="1" width="10" height="14" rx="2" stroke="currentColor" strokeWidth="1.2"/>
    <line x1="3" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="0.8"/>
    <circle cx="8" cy="9" r="2" stroke="currentColor" strokeWidth="1"/>
  </svg>
);

// ── 工具分组配置 ──

export const AI_TOOL_GROUPS: AiToolGroup[] = [
  {
    groupName: '分镜叙事',
    items: [
      { id: 'grid_25', name: '25宫格连贯分镜', desc: '生成连续分镜长图', icon: Grid25Icon },
      { id: 'nine_camera', name: '多机位九宫格', desc: '生成多视角机位图', icon: NineCameraIcon },
      { id: 'four_panel', name: '剧情推演四宫格', desc: '生成四格剧情推演', icon: FourPanelIcon },
      { id: 'frame_forward_3s', name: '画面推演 - 3秒后', desc: '推演画面后续动作', icon: FrameForwardIcon },
      { id: 'frame_backward_5s', name: '画面推演 - 5秒前', desc: '还原画面前置状态', icon: FrameBackwardIcon },
    ],
  },
  {
    groupName: '质感调节',
    items: [
      { id: 'film_lighting', name: '电影级光影校正', desc: '调整画面光影质感', icon: FilmLightingIcon },
    ],
  },
  {
    groupName: '空间与机位',
    items: [
      { id: 'panorama_720', name: '720全景', desc: '生成全景场景图', icon: Panorama720Icon },
    ],
  },
  {
    groupName: '设定图',
    items: [
      { id: 'face_three_view', name: '角色脸部三视图', desc: '基于一张参考图生成脸部细节三视图', icon: FaceThreeViewIcon },
      { id: 'character_sheet', name: '角色设定图', desc: '角色主视觉与设定拆解', icon: CharacterSheetIcon },
      { id: 'character_three_view', name: '角色三视图', desc: '正侧背视图与脸部特写', icon: CharacterThreeViewIcon },
      { id: 'scene_sheet', name: '场景设定图', desc: '场景设定与氛围参考', icon: SceneSheetIcon },
      { id: 'product_sheet', name: '产品设定图', desc: '产品外观设定与细节拆解', icon: ProductSheetIcon },
    ],
  },
];
