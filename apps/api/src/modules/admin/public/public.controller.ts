import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('api')
export class PublicController {
  constructor(@Inject(PublicService) private readonly service: PublicService) {}

  @Get('node-types/:key/models')
  getModels(@Param('key') key: string) {
    return this.service.getModelsByNodeKey(key);
  }

  @Get('pricing/calculate')
  calculate(
    @Query('modelId') modelId: string,
    @Query('resolutionId') resolutionId?: string,
    @Query('durationId') durationId?: string,
  ) {
    return this.service.calculatePrice(modelId, resolutionId, durationId);
  }
}
