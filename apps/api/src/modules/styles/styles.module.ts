import { Module } from '@nestjs/common';
import { StylesController } from './styles.controller';
import { StylesService } from './styles.service';
import { AdminStyleCategoryController } from './admin-style-category.controller';
import { AdminStyleController } from './admin-style.controller';
import { AdminStyleService } from './admin-style.service';

@Module({
  controllers: [StylesController, AdminStyleCategoryController, AdminStyleController],
  providers: [StylesService, AdminStyleService],
})
export class StylesModule {}
