import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * The Category catalogue. PrismaModule is global; AuthModule supplies the
 * `CurrentUserService` binding used to stamp a new category's author. Nothing is
 * exported — `LookupsService` reads the table directly, as it does for stages and tags.
 */
@Module({
  imports: [AuthModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
