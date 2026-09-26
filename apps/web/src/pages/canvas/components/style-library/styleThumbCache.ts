import { fetchStyleById } from '@/api/stylesApi';

interface ThumbEntry { styleName: string; coverUrl: string; fetchedAt: number }

const TTL_MS = 55 * 60 * 1000; // < presign 3600s，过期重取（B1：不缓存 MinIO key 再换 URL——直接用接口已 presign 的 coverUrl）

/** 模块级去重缓存（导出 Map 供测试重置，勿挂函数属性——需额外类型声明）。 */
export const styleThumbCacheMap = new Map<string, ThumbEntry | null>();

export async function getStyleThumb(styleId: string): Promise<{ styleName: string; url: string } | null> {
  // has() 优先：负缓存值是 null，falsy 判断会穿透反复打 404（第七轮 P1-4）
  if (styleThumbCacheMap.has(styleId)) {
    const hit = styleThumbCacheMap.get(styleId);
    if (hit == null) return null; // 404 墓碑（进程内不过期，可接受——404 幂等且风格删除后节点残留 styleId 常驻）；==null 兼收窄 Map.get 的 undefined 类型（has() 已保证值存在）
    if (Date.now() - hit.fetchedAt < TTL_MS) return { styleName: hit.styleName, url: hit.coverUrl };
  }
  const style = await fetchStyleById(styleId); // 404 → null
  if (!style) {
    styleThumbCacheMap.set(styleId, null);
    return null;
  }
  styleThumbCacheMap.set(styleId, { styleName: style.name, coverUrl: style.coverUrl, fetchedAt: Date.now() });
  return { styleName: style.name, url: style.coverUrl };
}
