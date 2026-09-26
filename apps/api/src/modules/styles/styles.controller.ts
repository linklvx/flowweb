import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { StylesService } from './styles.service';

@Controller('api/styles')
export class StylesController {
  constructor(@Inject(StylesService) private readonly service: StylesService) {}

  @Get('categories')
  listCategories() { return this.service.listCategories(); }

  @Get()
  list(@Req() req: any, @Query('tab') tab = 'all', @Query('categoryId') categoryId?: string,
       @Query('search') search?: string, @Query('commercialOnly') commercialOnly?: string,
       @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.service.list(req.user.id, {
      tab, categoryId, search,
      commercialOnly: commercialOnly === 'true',
      page: Number(page), pageSize: Number(pageSize),
    });
  }

  @Get(':id')
  getById(@Req() req: any, @Param('id') id: string) { return this.service.getById(req.user.id, id); }

  @Post(':id/favorite')
  favorite(@Req() req: any, @Param('id') id: string, @Body() dto: { favorited: boolean }) {
    return this.service.favorite(req.user.id, id, dto.favorited);
  }

  @Post(':id/use')
  use(@Req() req: any, @Param('id') id: string) { return this.service.use(req.user.id, id); }
}
