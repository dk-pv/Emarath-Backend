import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/**
 * The Tags catalogue. PrismaModule is global. Nothing is exported — `LookupsService`
 * reads the table directly, as it does for categories and lead sources.
 */
@Module({
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
