export const STITCH_WIDTH_MAP = { '2K': 2048, '4K': 3840 } as const;
export const RATIO_MAP: Record<string, number> = {
  '21:9': 21 / 9,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '1:1': 1,
};
