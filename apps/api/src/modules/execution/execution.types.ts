export interface ExecutionJobData {
  projectId: string;
  nodeId?: string;
  userId: string;
  /** base64 编码的提交端 state vector（readCanvas SV 等待用，spec 3.1） */
  sv?: string | null;
}

export type ExecutionJobResult = any;
