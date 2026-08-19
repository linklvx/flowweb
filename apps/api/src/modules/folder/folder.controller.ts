import { Controller, Get, Post, Patch, Delete, Param, Body, Req, Inject, UnauthorizedException, UsePipes, ValidationPipe } from '@nestjs/common';
import { Request } from 'express';
import { FolderService } from './folder.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';

@Controller('api/folders')
export class FolderController {
  constructor(@Inject(FolderService) private readonly folderService: FolderService) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.list(userId);
  }

  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(@Body() dto: CreateFolderDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.create(dto.name, userId);
  }

  @Patch(':id')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async rename(@Param('id') id: string, @Body() dto: UpdateFolderDto, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.rename(id, dto.name, userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('未登录');
    return this.folderService.remove(id, userId);
  }
}
