import { Controller, Get, Post, Body, Param, Delete, Put, Req, Inject } from '@nestjs/common';
import { FolderService } from '../services/folder.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';

@Controller('api/material/folders')
export class FolderController {
  constructor(@Inject(FolderService) private readonly folderService: FolderService) {}

  @Post()
  async create(@Body() dto: CreateFolderDto, @Req() req: any) {
    const folder = await this.folderService.create(dto, req.user.id);
    return { success: true, data: folder };
  }

  @Get()
  async findAll(@Req() req: any) {
    const folders = await this.folderService.findAllByUserId(req.user.id);
    return { success: true, data: folders };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateFolderDto, @Req() req: any) {
    const folder = await this.folderService.update(id, dto, req.user.id);
    return { success: true, data: folder };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.folderService.remove(id, req.user.id);
    return { success: true };
  }

  @Put(':id/move-up')
  async moveUp(@Param('id') id: string, @Req() req: any) {
    await this.folderService.moveUp(id, req.user.id);
    return { success: true };
  }

  @Put(':id/move')
  async move(
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
    @Req() req: any,
  ) {
    await this.folderService.moveFolder(id, dto, req.user.id);
    return { success: true };
  }
}
