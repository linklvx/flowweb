import { Controller, Get, Put, Post, Delete, Param, Body, Req, Query, Inject } from '@nestjs/common';
import { MaterialService } from '../services/material.service';
import { MoveFileDto } from '../dto/move-file.dto';
import { BatchMoveFilesDto } from '../dto/batch-move-files.dto';

@Controller('api/material/files')
export class FileController {
  constructor(@Inject(MaterialService) private readonly materialService: MaterialService) {}

  @Get()
  async getFiles(@Req() req: any, @Query('folderId') folderId?: string) {
    const files = await this.materialService.getFilesByFolderId(
      req.user.id,
      folderId || null,
    );
    return { success: true, data: files };
  }

  @Put(':id/move')
  async moveFile(@Param('id') id: string, @Body() dto: MoveFileDto, @Req() req: any) {
    const file = await this.materialService.moveFile(req.user.id, id, dto.folderId);
    return { success: true, data: file };
  }

  @Put(':id/toggle-favorite')
  async toggleFavorite(@Param('id') id: string, @Req() req: any) {
    const file = await this.materialService.toggleFavorite(req.user.id, id);
    return { success: true, data: file };
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string, @Req() req: any) {
    await this.materialService.deleteFile(req.user.id, id);
    return { success: true };
  }

  @Post('batch-delete')
  async batchDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const count = await this.materialService.deleteFiles(req.user.id, body.ids);
    return { success: true, count };
  }

  @Post('batch-move')
  async batchMove(@Body() body: BatchMoveFilesDto, @Req() req: any) {
    const count = await this.materialService.moveFiles(req.user.id, body.ids, body.folderId ?? null);
    return { success: true, count };
  }
}
