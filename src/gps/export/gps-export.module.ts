import { Module } from '@nestjs/common';
import { GpsExportController } from './gps-export.controller';
import { GpsExportService } from './gps-export.service';

/**
 * GPS activity export (GPS-08.1). PrismaModule and AuthModule are global, so the
 * service reaches the DB and resolves the caller without importing either. Kept a
 * separate module from GpsModule — the same shape the leads export uses — so no
 * completed GPS-04/05/06/07 wiring is touched.
 */
@Module({
  controllers: [GpsExportController],
  providers: [GpsExportService],
})
export class GpsExportModule {}
