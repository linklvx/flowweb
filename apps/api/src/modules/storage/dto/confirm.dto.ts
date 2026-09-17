export class ConfirmUploadDto {
  fileId!: string;
  /** @deprecated 服务端已改用 media.key/media.size（D1），此字段保留兼容、不被读取 */
  key!: string;
  /** @deprecated 同上 */
  fileSize!: number;
}
