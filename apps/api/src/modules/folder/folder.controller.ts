import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { FolderService } from './folder.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Controller('api/folders')
export class FolderController {
  constructor(@Inject(FolderService) private readonly folderService: FolderService) {}

  @Get()
  async list(@Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.list(userId, teamId);
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(@Body() dto: CreateFolderDto, @Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.create(dto, userId, teamId);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async rename(@Param('id') id: string, @Body() dto: UpdateFolderDto, @Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.rename(id, dto.name, userId, teamId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request, @Query('teamId') teamId?: string) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.remove(id, userId, teamId);
  }
}
