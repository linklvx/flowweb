export class MoveFolderDto {
  parentId!: string | null;  // 目标父文件夹 ID (null = 根级)
  afterId!: string | null;   // 排在哪个文件夹之后 (null = 最前面)
}
