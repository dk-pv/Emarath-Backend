import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/configuration';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { LeadsBoardModule } from './leads/board/leads-board.module';
import { LeadsBulkModule } from './leads/bulk/leads-bulk.module';
import { LeadsExportModule } from './leads/export/leads-export.module';
import { LeadsImportModule } from './leads/import/leads-import.module';
import { LeadsRowActionsModule } from './leads/row-actions/leads-row-actions.module';
import { LeadsTagsModule } from './leads/tags/leads-tags.module';
import { LookupsModule } from './lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';
import { StagesModule } from './stages/stages.module';
import { ViewPreferencesModule } from './view-preferences/view-preferences.module';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig],
      // Environment is selected via NODE_ENV, without code changes.
      // Files are optional; on hosted platforms (Render/Vercel) values come
      // from real environment variables. Load order: most specific wins.
      envFilePath: [`.env.${nodeEnv}.local`, `.env.${nodeEnv}`, '.env'],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    LeadsModule,
    LeadsBoardModule,
    LeadsBulkModule,
    LeadsExportModule,
    LeadsImportModule,
    LeadsRowActionsModule,
    LeadsTagsModule,
    LookupsModule,
    StagesModule,
    ViewPreferencesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
