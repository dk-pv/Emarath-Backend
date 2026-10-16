import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { StorageConfig } from '../config/storage.config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * The Documents feature (DOC-02.1: upload). StorageService (global), PrismaService (global)
 * and CurrentUserService (global, from AuthModule) are injected, so no imports are needed.
 * This upload path is the shared foundation later modules' attachments reuse — no second
 * upload service is introduced.
 *
 * The upload's size limit is the storage policy's `STORAGE_MAX_BYTES`, applied by multer while
 * the body streams in: a larger file is a 413 before it is buffered or reaches the service
 * (ADR-0095). StorageService.put keeps its own check behind it.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<StorageConfig>('storage').maxBytes,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
