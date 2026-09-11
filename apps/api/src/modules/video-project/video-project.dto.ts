// apps/api/src/modules/video-project/video-project.dto.ts
import { IsString, IsObject, IsOptional, IsDateString, IsIn, IsNumber, Min, Max } from 'class-validator';

export class CreateVideoProjectDto {
  @IsString() workflowId!: string;
  @IsString() sourceNodeId!: string;
  @IsString() title!: string;
  @IsOptional() @IsObject() data?: object; // 可选——service.upsertByNode 缺省空工程（Plan 2 浏览器验收发现：DTO 必填与 service data? 语义脱节，首开编辑器 3 字段 upsert 被 400）
}
export class PatchVideoProjectDto {
  @IsObject() data!: object;
  @IsDateString() baseUpdatedAt!: string; // 乐观锁基准
}
export class RegenerateDto {
  @IsString() sourceNodeId!: string; // 素材源节点（非剪辑节点）
  @IsString() workflowId!: string;   // 漏了它 whitelist 会剥离 → svc.assertEditor(undefined) 真机挂（服务层测试直传对象测不到）
  @IsIn(['video', 'audio']) kind!: 'video' | 'audio'; // @IsString 只验"是字符串"不验枚举——必须 @IsIn
}

export class RegisterGeneratedDto {
  @IsString() workflowId!: string;
  @IsString() videoProjectId!: string;
  @IsIn(['480p', '720p', '1080p']) resolution!: string;
  @IsNumber() @Min(0) @Max(900) durationSec!: number; // 15min 上限服务端同步（spec 5.5）
  @IsOptional() @IsNumber() @Min(1) width?: number;  // 产物尺寸（metadata 存档——resolution 无法表达 9:16 的 1080×1920）；可选防老前端 400
  @IsOptional() @IsNumber() @Min(1) height?: number;
  @IsNumber() actualSize!: number; // 编码后真实字节（presigned POST ±1024 Conditions 要求）
}
export class ConfirmGeneratedDto { @IsString() mediaId!: string; }
export class RemoveShadowDto { @IsString() workflowId!: string; @IsString() shadowNodeId!: string; }
export class ExportPrecheckDto {
  @IsString() workflowId!: string;
  @IsNumber() @Min(0) estimatedSize!: number; // 前端估算字节（预检用——register 时才以真实大小终判）；负值无意义拒收
}
