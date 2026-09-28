import { z } from 'zod';

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  parentId: z.string().optional(),   // null 由导出归一消除；显式 null 拒（fail-closed）
  width: z.number().optional(),
  height: z.number().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()),
});

const EdgeSchema = z.object({ id: z.string(), source: z.string(), target: z.string() });

export const TemplateDataSchema = z.object({
  version: z.literal(1),   // schemaVersion fail-closed（dev 无存量不迁移；seed upsert 自愈官方行）
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});

/** 返回 void（门禁封死）：调用方不得消费返回值——归一化后的数据才是落库数据。 */
export function validateTemplateData(data: unknown): void {
  TemplateDataSchema.parse(data);
}
