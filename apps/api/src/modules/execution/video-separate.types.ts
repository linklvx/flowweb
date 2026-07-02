export class NonRetryableError extends Error {
  constructor(
    public readonly errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface VideoSeparateJobData {
  taskId: string;
  userId: string;
  sourceFileId: string;
  sourceKey: string;
  sourceOriginalName: string;
  sourceMimeType: string;
  sourceSize: number;
  projectId: string;
  nodeId: string;
}

export interface VideoSeparateJobResult {
  videoFileId: string | null;
  audioFileId: string | null;
}

export interface VideoSeparateRequest {
  fileId: string;
  nodeId: string;
  mode: string;
  userId: string;
  workflowId: string;
}
