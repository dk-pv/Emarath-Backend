import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { UserRole } from '../src/generated/prisma/client';
import { createE2EApp, E2EAgent } from './e2e-app';

/**
 * Contract smoke test for the duplicate-lead endpoints (ADR-0092).
 *
 * Only guards and pipes are exercised — they reject before the service touches the
 * database, so they run under the Jest VM where the Prisma driver adapter does not (see
 * STATUS.md). The scoping of what each endpoint reveals, and the relationship itself, are
 * proven by the service specs and the live HTTP run.
 */
describe('Leads duplicates (e2e)', () => {
  const uuid = '11111111-1111-1111-1111-111111111111';

  describe('as a sales user', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.SALES_AGENT));
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects a duplicate check with a phone longer than a lead can hold', async () => {
      await api
        .get('/api/leads/duplicate-check')
        .query({ primaryPhone: '9'.repeat(40) })
        .expect(400);
    });

    it('rejects a duplicate check with an email longer than a lead can hold', async () => {
      await api
        .get('/api/leads/duplicate-check')
        .query({ email: 'a'.repeat(200) + '@example.com' })
        .expect(400);
    });

    it('rejects a duplicate check with an unknown parameter', async () => {
      await api
        .get('/api/leads/duplicate-check')
        .query({ primaryPhone: '1', name: 'Nope' })
        .expect(400);
    });

    it('rejects the related-leads read for a non-uuid lead id', async () => {
      await api.get('/api/leads/not-a-uuid/duplicates').expect(400);
    });

    it('does not take the static duplicate-check route for a lead id', async () => {
      // If `:id` captured it, the ParseUUIDPipe would answer "not a uuid" for this path.
      // It is the check route: an unknown parameter is what fails validation.
      const res = await api
        .get('/api/leads/duplicate-check')
        .query({ unknown: '1' })
        .expect(400);
      expect(JSON.stringify(res.body)).not.toContain('uuid');
    });
  });

  describe('as a post-sale user (QC)', () => {
    let app: INestApplication<App>;
    let api: E2EAgent;

    beforeAll(async () => {
      ({ app, api } = await createE2EApp(UserRole.QC));
    });

    afterAll(async () => {
      await app.close();
    });

    it('cannot run a duplicate check — the sales modules are closed to the role', async () => {
      await api
        .get('/api/leads/duplicate-check')
        .query({ primaryPhone: '1' })
        .expect(403);
    });

    it('cannot read a lead’s related leads', async () => {
      await api.get(`/api/leads/${uuid}/duplicates`).expect(403);
    });
  });
});
