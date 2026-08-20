// 单一定义源：与 store 层共享 PromptValue/ImageItem，避免结构漂移
export type { PromptValue, ImageItem } from '@/stores/nodeStore';

export interface CommandItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  value: string;
  category: 'model' | 'ratio' | 'quality';
}

export const COMMANDS: CommandItem[] = [
  { id: 'model-sdxl', name: 'SD XL', description: 'Stable Diffusion XL', icon: '🎨', value: 'sdxl', category: 'model' },
  { id: 'model-flux', name: 'Flux', description: 'Flux 模型', icon: '✨', value: 'flux', category: 'model' },
  { id: 'ratio-1-1', name: '1:1', description: '正方形', icon: '⬜', value: '1:1', category: 'ratio' },
  { id: 'ratio-16-9', name: '16:9', description: '宽屏', icon: '📺', value: '16:9', category: 'ratio' },
  { id: 'ratio-9-16', name: '9:16', description: '竖屏', icon: '📱', value: '9:16', category: 'ratio' },
  { id: 'quality-std', name: '标准', description: '标准画质', icon: '📷', value: 'standard', category: 'quality' },
  { id: 'quality-2k', name: '2K', description: '2K 高清', icon: '🖼️', value: '2k', category: 'quality' },
  { id: 'quality-4k', name: '4K', description: '4K 超清', icon: '🎞️', value: '4k', category: 'quality' },
];

export const CATEGORY_DEFAULTS: Record<CommandItem['category'], string> = {
  model: 'sdxl',
  ratio: '1:1',
  quality: 'standard',
};
