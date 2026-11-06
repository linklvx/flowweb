// apps/api/src/modules/collab/project-erasing.filter.ts
// C4-b（R15 fence 接线·质量评审 Important#2）：ProjectErasingError→409 全局统一映射。fence 写点
// （updateName/VideoProject CRUD/成员 add·remove 等窄竞窗——resolve 读 ACTIVE→tombstone 落定→
// 服务事务 fence 拒）先前裸抛 500；team.service disbandTeam 与 admit 已各自折 409，本 filter 把
// 同语义统一到全部 fence 写点（窄 Catch——main.ts 注册序=宽 shell 后注册先求值）。
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ProjectErasingError } from './project-lock';

@Catch(ProjectErasingError)
export class ProjectErasingFilter implements ExceptionFilter {
  catch(exception: ProjectErasingError, _host: ArgumentsHost) {
    const res = _host.switchToHttp().getResponse<Response>();
    res.status(409).json({
      statusCode: 409,
      code: 'PROJECT_ERASING',
      message: exception.message,
      scopeType: exception.scopeType,
      scopeId: exception.scopeId,
    });
  }
}
