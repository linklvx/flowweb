import { Controller, Get, Put, Body, Query } from '@nestjs/common';
import { SettingsService, type SettingEntry, type SettingGroup } from './settings.service';

@Controller('api/admin/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getAll() {
    return this.settingsService.getAll();
  }

  @Get('group')
  async getByGroup(@Query('name') group: SettingGroup) {
    return this.settingsService.getByGroup(group);
  }

  @Put()
  async update(@Body() entries: SettingEntry[]) {
    await this.settingsService.batchUpsert(entries);
    return { success: true };
  }
}
