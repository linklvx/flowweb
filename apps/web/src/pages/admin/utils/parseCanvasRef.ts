/** 粘贴画布 ID/URL → projectId（spec §5.3）。URL 形态对齐 canvas 路由（?projectId=，canvas/page.tsx:75）。 */
export function parseCanvasRef(text: string): string | null {
  const t = text.trim().replace(/^['"]|['"]$/g, ''); // 控制台粘贴可能带引号
  if (!t) return null;
  try {
    const u = new URL(t, window.location.origin); // 相对 /canvas?projectId=x 需 base
    return u.searchParams.get('projectId') || t;  // URL 无 projectId → 整串当裸 ID
  } catch {
    return t; // 非 URL → 裸 ID
  }
}
