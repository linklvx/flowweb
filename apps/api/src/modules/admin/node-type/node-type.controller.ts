import { Controller, Get, Post, Put, Param, Body, Inject } from '@nestjs/common';
import { NodeTypeService } from './node-type.service';

@Controller('api/admin/node-types')
export class NodeTypeController {
  constructor(@Inject(NodeTypeService) private readonly service: NodeTypeService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  create(@Body() body: { name: string; key: string; description?: string }) {
    return this.service.create(body);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; active?: boolean }) {
    return this.service.update(id, body);
  }
}
