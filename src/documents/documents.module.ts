import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * The Documents feature (DOC-02.1: upload). StorageService (global), PrismaService (global)
 * and CurrentUserService (global, from AuthModule) are injected, so no imports are needed.
 * This upload path is the shared foundation later modules' attachments reuse — no second
 * upload service is introduced.
 */
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
