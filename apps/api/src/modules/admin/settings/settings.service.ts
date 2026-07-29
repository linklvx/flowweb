import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SettingEntry {
  key: string;
  value: string;
}

export type SettingGroup = 'wechat_pay' | 'sms' | 'wechat_login';

const GROUP_PREFIXES: Record<SettingGroup, string> = {
  wechat_pay: 'wechat_pay.',
  sms: 'sms.',
  wechat_login: 'wechat_login.',
};

const logger = new Logger('SettingsService');

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取指定分组的全部配置 */
  async getByGroup(group: SettingGroup): Promise<SettingEntry[]> {
    const prefix = GROUP_PREFIXES[group];
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { key: 'asc' },
    });
    return rows.map(r => ({ key: r.key, value: r.value }));
  }

  /** 获取全部配置（按分组返回） */
  async getAll(): Promise<Record<SettingGroup, SettingEntry[]>> {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    const result: Record<SettingGroup, SettingEntry[]> = {
      wechat_pay: [],
      sms: [],
      wechat_login: [],
    };
    for (const row of rows) {
      for (const [group, prefix] of Object.entries(GROUP_PREFIXES)) {
        if (row.key.startsWith(prefix)) {
          result[group as SettingGroup].push({ key: row.key, value: row.value });
          break;
        }
      }
    }
    return result;
  }

  /** 批量写入配置（upsert） */
  async batchUpsert(entries: SettingEntry[]): Promise<void> {
    logger.log({ count: entries.length }, 'Batch upserting settings');
    await this.prisma.$transaction(
      entries.map(e =>
        this.prisma.systemSetting.upsert({
          where: { key: e.key },
          create: { key: e.key, value: e.value },
          update: { value: e.value },
        }),
      ),
    );
  }
}
