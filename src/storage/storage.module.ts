import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '../config/storage.config';
import { StorageService } from './storage.service';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';

/**
 * The shared file storage foundation (FND-05.2). Global so any feature — Documents
 * (DOC-02.1) and future lead attachments — can inject `StorageService` without importing
 * this module. The environment-selected adapter is bound once here (local in development,
 * S3 in staging/production, ADR — file storage), keeping every consumer provider-agnostic —
 * the same pattern the AuthModule uses for the mail transport.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService => {
        const { provider } = config.getOrThrow<StorageConfig>('storage');
        return provider === 's3'
          ? new S3StorageService(config)
          : new LocalStorageService(config);
      },
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
