// P10 用户裁定 A（2026-09-20）：VideoEditNode TRACK_COLORS 统一到 ve BLOCK_BAR 色表。
// 叶子模块（先例：VideoEditNode 已从 timeline/canvas-size 叶子导入）——勿从 ClipBlock.tsx 导出，
// 否则会把 useAudioPeaks/editorStore 整条依赖链拉进画布节点 chunk。
export const TRACK_BAR_COLORS: Record<string, string> = {
  video: '#6C5CE7',
  image: '#5B7CFA',
  audio: '#8F5DBA',
  subtitle: '#5DBAA0',
};
