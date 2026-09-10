// apps/api/src/modules/video-project/video-project.dto.ts
import { IsString, IsObject, IsDateString, IsIn, IsNumber } from 'class-validator';

export class CreateVideoProjectDto {
  @IsString() workflowId!: string;
  @IsString() sourceNodeId!: string;
  @IsString() title!: string;
  @IsObject() data!: object; // ProjectData 结构由前端 shared 类型保证；服务端挡非对象
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
  @IsIn(['720p', '1080p']) resolution!: string;
  @IsNumber() durationSec!: number;
  @IsNumber() actualSize!: number; // 编码后真实字节（presigned POST ±1024 Conditions 要求）
}
export class ConfirmGeneratedDto { @IsString() mediaId!: string; }
export class RemoveShadowDto { @IsString() workflowId!: string; @IsString() shadowNodeId!: string; }
