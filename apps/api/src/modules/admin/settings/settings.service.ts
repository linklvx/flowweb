import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SettingEntry {
  key: string;
  value: string;
}

export type SettingGroup = 'wechat_pay' | 'sms' | 'wechat_login';

/** 白名单：每个分组下允许通过 DB 管理的 key（非敏感配置） */
const GROUP_KEYS: Record<SettingGroup, string[]> = {
  wechat_pay: [
    'WECHAT_PAY_APP_ID',
    'WECHAT_PAY_MCH_ID',
    'WECHAT_PAY_MERCHANT_SERIAL_NO',
    'WECHAT_PAY_MERCHANT_CERT',
    'WECHAT_PAY_NOTIFY_URL',
    'WECHAT_PAY_PUBLIC_KEY_ID',
    'WECHAT_PAY_PUBLIC_KEY',
  ],
  sms: [
    'TENCENT_SMS_SDK_APP_ID',
    'TENCENT_SMS_TEMPLATE_ID',
    'TENCENT_SMS_SIGN_NAME',
  ],
  wechat_login: [
    'WECHAT_APP_ID',
  ],
};

/** 反向索引：key → group */
const KEY_TO_GROUP = new Map<string, SettingGroup>();
for (const [group, keys] of Object.entries(GROUP_KEYS)) {
  for (const key of keys) {
    KEY_TO_GROUP.set(key, group as SettingGroup);
  }
}

/** 白名单合集 */
const ALLOWED_KEYS = new Set(KEY_TO_GROUP.keys());

const logger = new Logger('SettingsService');

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取指定分组的全部配置（含从 .env 兜底的未入库 key） */
  async getByGroup(group: SettingGroup): Promise<SettingEntry[]> {
    const keys = GROUP_KEYS[group];
    const dbRows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const dbMap = new Map(dbRows.map(r => [r.key, r.value]));
    return keys.map(key => ({ key, value: dbMap.get(key) ?? process.env[key] ?? '' }));
  }

  /** 获取全部配置（按分组返回，含 .env 兜底） */
  async getAll(): Promise<Record<SettingGroup, SettingEntry[]>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...ALLOWED_KEYS] } },
    });
    const dbMap = new Map(rows.map(r => [r.key, r.value]));

    const result: Record<SettingGroup, SettingEntry[]> = {
      wechat_pay: [],
      sms: [],
      wechat_login: [],
    };
    for (const [group, keys] of Object.entries(GROUP_KEYS)) {
      result[group as SettingGroup] = keys.map(key => ({
        key,
        value: dbMap.get(key) ?? process.env[key] ?? '',
      }));
    }
    return result;
  }

  /** 批量写入配置（仅允许白名单内的 key） */
  async batchUpsert(entries: SettingEntry[]): Promise<void> {
    const valid = entries.filter(e => ALLOWED_KEYS.has(e.key));
    if (valid.length === 0) return;
    logger.log({ count: valid.length }, 'Batch upserting settings');
    await this.prisma.$transaction(
      valid.map(e =>
        this.prisma.systemSetting.upsert({
          where: { key: e.key },
          create: { key: e.key, value: e.value },
          update: { value: e.value },
        }),
      ),
    );
  }
}
