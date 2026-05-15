import { z } from 'zod';

const NodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.any()),
});

const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});

export const TemplateDataSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});

export function validateTemplateData(data: unknown) {
  return TemplateDataSchema.parse(data);
}
