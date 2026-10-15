import { Module } from '@nestjs/common';
import { TagAccessModule } from '../tag-access/tag-access.module';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/**
 * The Tags catalogue. PrismaModule is global. Nothing is exported — `LookupsService`
 * reads the table directly, as it does for categories and lead sources. Tag Permissions
 * decide who besides an administrator may create a tag (ADR-0091).
 */
@Module({
  imports: [TagAccessModule],
  controllers: [TagsController],
  providers: [TagsService],
})
export class TagsModule {}
