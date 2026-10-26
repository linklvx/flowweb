// apps/web/src/stores/runtimeFeedTypes.ts
// Y1c T22：RuntimeEvent wire 行类型（api RuntimeEventWireRow 镜像——BigInt 一律 string）。
export interface RuntimeEventWireRow {
  id: string;
  feedSeq: string;
  generation: number;
  kind: string;
  payload: Record<string, unknown> & { v?: number; kind?: string };
  docSeq: string | null;
  createdAtMs: number;
}
