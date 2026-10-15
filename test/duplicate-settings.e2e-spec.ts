import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for Duplicate Settings (ADR-0092): there is no way to configure duplicate
 * handling to refuse a lead. Only guards and pipes are exercised — they reject before the service
 * touches the database, so they run under the Jest VM where the Prisma driver adapter does not
 * (see STATUS.md). That a stored legacy Block row cannot refuse a lead is proven by the service
 * specs and by the live run.
 */
describe('Duplicate Settings (e2e)', () => {
  const valid = { allowDuplicateSearch: true, checkArchivedLeads: false };

  describe('as an administrator', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.SUPERADMIN));
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(['BLOCK_HARD_STOP', 'WARN_ALLOW_SAVE'])(
      'rejects a body that names a mode (%s) — the Block option is gone',
      async (mode) => {
        const res = await api
          .put('/api/settings/sales-crm/duplicate')
          .send({ ...valid, mode })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain('mode');
      },
    );

    it('rejects the retired Block-only toggle', async () => {
      await api
        .put('/api/settings/sales-crm/duplicate')
        .send({ ...valid, displayAssigneeInfo: true })
        .expect(400);
    });

    it('rejects a body missing a toggle', async () => {
      await api
        .put('/api/settings/sales-crm/duplicate')
        .send({ allowDuplicateSearch: true })
        .expect(400);
    });

    it('rejects a non-boolean toggle', async () => {
      await api
        .put('/api/settings/sales-crm/duplicate')
        .send({ ...valid, checkArchivedLeads: 'yes' })
        .expect(400);
    });
  });

  describe('as a sales user', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.SALES_AGENT));
    });

    afterAll(async () => {
      await app.close();
    });

    it('cannot read or change Duplicate Settings (403)', async () => {
      await api.get('/api/settings/sales-crm/duplicate').expect(403);
      await api
        .put('/api/settings/sales-crm/duplicate')
        .send(valid)
        .expect(403);
    });
  });
});
