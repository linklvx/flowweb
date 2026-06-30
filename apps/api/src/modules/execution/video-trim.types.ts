export interface VideoTrimJobData {
  taskId: string;
  userId: string;
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  hasAudio: boolean;
}

export type VideoTrimJobResult = { outputPath: string };

export interface VideoTrimRequest {
  fileId: string;
  startTime: number;
  endTime: number;
  nodeId: string;
  userId: string;
  workflowId: string;
}
