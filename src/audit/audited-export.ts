import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { mergeMap, Observable } from 'rxjs';
import { Prisma } from '../generated/prisma/client';
import { CurrentUserService } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { recordAfterEffect, userActor } from './audit-events';

const EXPORT_SOURCE = 'audit:export-source';

/**
 * Query parameters that can carry a customer's details (free text, field conditions such as a
 * phone number). An export records that they were used, never their value.
 */
const REDACTED_PARAMS = new Set(['search', 'conditions']);

/**
 * Records a completed file export (AUD-01): who exported what, with which filters and how many
 * rows. The handler streams the file itself and resolves to the row count; the event is written
 * only after that, so an export that fails — a 400, a query error, a stream aborted midway — is
 * never recorded.
 */
export function AuditedExport(source: string) {
  return applyDecorators(
    SetMetadata(EXPORT_SOURCE, source),
    UseInterceptors(ExportAuditInterceptor),
  );
}

export function exportFilters(query: Request['query']): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        REDACTED_PARAMS.has(key) ? true : (value as Prisma.InputJsonValue),
      ]),
  );
}

@Injectable()
export class ExportAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ExportAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly currentUser: CurrentUserService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const source = this.reflector.get<string>(
      EXPORT_SOURCE,
      context.getHandler(),
    );
    const { query } = context.switchToHttp().getRequest<Request>();
    // Resolved before the file streams: nothing after the last byte may fail the request.
    const user = await this.currentUser.resolve();

    return next.handle().pipe(
      mergeMap(async (rows: unknown) => {
        await recordAfterEffect(this.prisma, this.logger, {
          entityType: 'EXPORT',
          entityId: randomUUID(),
          leadId: null,
          action: 'EXPORTED',
          actor: userActor(user),
          source,
          metadata: {
            rows: typeof rows === 'number' ? rows : null,
            filters: exportFilters(query),
          },
        });
        return rows;
      }),
    );
  }
}
