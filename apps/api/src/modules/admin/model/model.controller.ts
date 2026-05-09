import { Controller, Get, Post, Put, Delete, Param, Body, Inject } from '@nestjs/common';
import { ModelService } from './model.service';

@Controller('api/admin')
export class ModelController {
  constructor(@Inject(ModelService) private readonly service: ModelService) {}

  @Get('node-types/:id/models')
  findByNodeType(@Param('id') id: string) {
    return this.service.findByNodeType(id);
  }

  @Get('models/:id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post('node-types/:id/models')
  create(@Param('id') nodeTypeId: string, @Body() body: any) {
    return this.service.create({ ...body, nodeTypeId });
  }

  @Put('models/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Post('models/:id/toggle')
  toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  @Delete('models/:id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post('models/:id/resolutions')
  addResolution(@Param('id') id: string, @Body() body: { label: string; width: number; height: number }) {
    return this.service.addResolution(id, body);
  }

  @Delete('models/:mid/resolutions/:rid')
  removeResolution(@Param('rid') id: string) {
    return this.service.removeResolution(id);
  }

  @Post('models/:id/durations')
  addDuration(@Param('id') id: string, @Body() body: { label: string; seconds: number }) {
    return this.service.addDuration(id, body);
  }

  @Delete('models/:mid/durations/:did')
  removeDuration(@Param('did') id: string) {
    return this.service.removeDuration(id);
  }
}
