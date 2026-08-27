export class PresignUploadDto {
  fileName!: string;
  fileSize!: number;
  fileType!: string;
  type!: 'uploaded' | 'temp';
  teamId?: string;
}
