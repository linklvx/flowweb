// apps/api/src/modules/video-project/video-project.dto.ts
// Y4a T8（spec §0 条 9）：CreateVideoProjectDto/PatchVideoProjectDto 随 REST 工程面退场（表整删）。
import { IsString, IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator';

export class RegenerateDto {
  @IsString() sourceNodeId!: string; // 素材源节点（非剪辑节点）
  @IsString() workflowId!: string;   // 漏了它 whitelist 会剥离 → svc.assertEditor(undefined) 真机挂（服务层测试直传对象测不到）
  @IsIn(['video', 'audio']) kind!: 'video' | 'audio'; // @IsString 只验"是字符串"不验枚举——必须 @IsIn
  @IsString() retakeId!: string; // 批5-1 客户端生成幂等键（E0）——必填：服务端兜底=每次新 id=重放无幂等；透传 execute 作 intentId
}

export class RegisterGeneratedDto {
  @IsString() workflowId!: string;
  // Y4a T8（spec §3.5 导出注册链 re-key）：`videoProjectId`→`sourceNodeId`——doc 字符串非 PG 外键
  //（VideoProject 表已整删）；=剪辑节点自身 canvas nodeId。
  @IsString() sourceNodeId!: string;
  @IsIn(['480p', '720p', '1080p']) resolution!: string;
  @IsNumber() @Min(0) @Max(900) durationSec!: number; // 15min 上限服务端同步（spec 5.5）
  @IsOptional() @IsNumber() @Min(1) width?: number;  // 产物尺寸（metadata 存档——resolution 无法表达 9:16 的 1080×1920）；可选防老前端 400
  @IsOptional() @IsNumber() @Min(1) height?: number;
  @IsNumber() actualSize!: number; // 编码后真实字节（presigned POST ±1024 Conditions 要求）
  @IsOptional() @IsString() clientRequestId?: string; // 幂等键（同 id 重入返回同 Media——不显式声明会被 whitelist 静默剥离）
}
export class ConfirmGeneratedDto { @IsString() mediaId!: string; }
export class ExportPrecheckDto {
  @IsString() workflowId!: string;
  @IsNumber() @Min(0) estimatedSize!: number; // 前端估算字节（预检用——register 时才以真实大小终判）；负值无意义拒收
}
