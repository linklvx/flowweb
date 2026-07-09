import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit';

export interface AuditMetadata {
  action: string;
  targetType: string;
}

export const AuditLog = (action: string, targetType: string) =>
  SetMetadata(AUDIT_KEY, { action, targetType } as AuditMetadata);
