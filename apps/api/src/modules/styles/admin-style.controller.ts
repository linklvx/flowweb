import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminStyleService } from './admin-style.service';
import { CreateStyleDto, UpdateStyleDto } from './dto/style.dto';

@Controller('api/admin/styles')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
export class AdminStyleController {
  constructor(@Inject(AdminStyleService) private readonly service: AdminStyleService) {}

  @Post('upload-cover')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.mimetype)) return cb(new BadRequestException('仅支持 jpg/png/webp'), false);
      cb(null, true);
    },
  }))
  async uploadCover(@UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string }) {
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadCover(file.buffer, file.mimetype);
  }

  @Get() list(@Query('categoryId') categoryId?: string, @Query('search') search?: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.listStyles({ categoryId, search, page: Number(page), pageSize: Number(pageSize) });
  }
  @Post() create(@Body() dto: CreateStyleDto) { return this.service.createStyle(dto); }
  @Put(':id') update(@Param('id') id: string, @Body() dto: UpdateStyleDto) { return this.service.updateStyle(id, dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.deleteStyle(id); }
}
