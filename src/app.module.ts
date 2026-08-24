import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/configuration';
import authConfig from './config/auth.config';
import mailConfig from './config/mail.config';
import storageConfig from './config/storage.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ActivitiesModule } from './activities/activities.module';
import { AuthModule } from './auth/auth.module';
import { CallsModule } from './calls/calls.module';
import { DocumentsModule } from './documents/documents.module';
import { GpsModule } from './gps/gps.module';
import { GpsExportModule } from './gps/export/gps-export.module';
import { HealthModule } from './health/health.module';
import { LeadCustomFieldsModule } from './lead-custom-fields/lead-custom-fields.module';
import { LeadsModule } from './leads/leads.module';
import { LeadsBoardModule } from './leads/board/leads-board.module';
import { LeadsBulkModule } from './leads/bulk/leads-bulk.module';
import { LeadsExportModule } from './leads/export/leads-export.module';
import { LeadsImportModule } from './leads/import/leads-import.module';
import { LeadsRowActionsModule } from './leads/row-actions/leads-row-actions.module';
import { LeadsTagsModule } from './leads/tags/leads-tags.module';
import { LookupsModule } from './lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { StagesModule } from './stages/stages.module';
import { StorageModule } from './storage/storage.module';
import { ViewPreferencesModule } from './view-preferences/view-preferences.module';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, authConfig, mailConfig, storageConfig],
      // Environment is selected via NODE_ENV, without code changes.
      // Files are optional; on hosted platforms (Render/Vercel) values come
      // from real environment variables. Load order: most specific wins.
      envFilePath: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
    }),
    PrismaModule,
    StorageModule,
    ActivitiesModule,
    AuthModule,
    CallsModule,
    DocumentsModule,
    GpsModule,
    GpsExportModule,
    HealthModule,
    // The sibling /leads/* modules (static paths) must register BEFORE LeadsModule:
    // its GET /leads/:id is a single-segment catch-all that would otherwise shadow a
    // static route like /leads/export and 400 it on the ParseUUIDPipe. Keep LeadsModule
    // last among the /leads/* group.
    LeadsBoardModule,
    LeadsBulkModule,
    LeadsExportModule,
    LeadsImportModule,
    LeadsRowActionsModule,
    LeadsTagsModule,
    LeadsModule,
    // Top-level /api/lead-custom-fields — not under /leads/, so route order is moot.
    LeadCustomFieldsModule,
    LookupsModule,
    ReportsModule,
    StagesModule,
    ViewPreferencesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
