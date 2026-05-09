import { Controller, Get, Post, Put, Delete, Param, Body, Query, Inject } from '@nestjs/common';
import { PricingService } from './pricing.service';

@Controller('api/admin/pricing-rules')
export class PricingController {
  constructor(@Inject(PricingService) private readonly service: PricingService) {}

  @Get()
  findAll(@Query('nodeTypeId') nodeTypeId?: string, @Query('modelId') modelId?: string) {
    return this.service.findAll({ nodeTypeId, modelId });
  }

  @Post()
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  delete(@Param('id') id: string) { return this.service.delete(id); }

  @Post('batch')
  batchCreate(@Body() body: { rules: any[] }) { return this.service.batchCreate(body.rules); }
}
