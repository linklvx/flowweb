export class PresignUploadDto {
  fileName!: string;
  fileSize!: number;
  fileType!: string;
  type!: 'uploaded' | 'temp';
  teamId?: string;
  projectId?: string;
  /** Y1b T4：网络重试幂等键（可选）——同 teamId+clientUploadId 复用既有 pending 行与 key（恰一行） */
  clientUploadId?: string;
}
