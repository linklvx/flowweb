import { Controller, Get, Put, Post, Delete, Param, Body, Req, Query, Inject, UsePipes, ValidationPipe } from '@nestjs/common';
import { MaterialService } from '../services/material.service';
import { MoveFileDto } from '../dto/move-file.dto';
import { BatchMoveFilesDto } from '../dto/batch-move-files.dto';
import { BatchDeleteFilesDto } from '../dto/batch-delete-files.dto';

@Controller('api/material/files')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class FileController {
  constructor(@Inject(MaterialService) private readonly materialService: MaterialService) {}

  @Get()
  async getFiles(
    @Req() req: any,
    @Query('folderId') folderId?: string,
    @Query('type') type?: 'image' | 'video' | 'audio',
    @Query('teamId') teamId?: string,
  ) {
    const files = await this.materialService.getFilesByFolderId(
      req.user.id,
      folderId || null,
      type,
      teamId,
    );
    return { success: true, data: files };
  }

  @Get('count')
  async getFileCounts(@Req() req: any, @Query('teamId') teamId?: string) {
    const counts = await this.materialService.getFileCounts(req.user.id, teamId);
    return { success: true, data: counts };
  }

  @Put(':id/move')
  async moveFile(@Param('id') id: string, @Body() dto: MoveFileDto, @Req() req: any) {
    const file = await this.materialService.moveFile(req.user.id, id, dto.folderId, dto.teamId);
    return { success: true, data: file };
  }

  @Put(':id/toggle-favorite')
  async toggleFavorite(@Param('id') id: string, @Req() req: any, @Query('teamId') teamId?: string) {
    const file = await this.materialService.toggleFavorite(req.user.id, id, teamId);
    return { success: true, data: file };
  }

  @Delete(':id')
  async deleteFile(@Param('id') id: string, @Req() req: any, @Query('teamId') teamId?: string) {
    await this.materialService.deleteFile(req.user.id, id, teamId);
    return { success: true };
  }

  @Post('batch-delete')
  async batchDelete(@Body() body: BatchDeleteFilesDto, @Req() req: any) {
    const count = await this.materialService.deleteFiles(req.user.id, body.ids, body.teamId);
    return { success: true, count };
  }

  @Post('batch-move')
  async batchMove(@Body() body: BatchMoveFilesDto, @Req() req: any) {
    const count = await this.materialService.moveFiles(req.user.id, body.ids, body.folderId ?? null, body.teamId);
    return { success: true, count };
  }
}
